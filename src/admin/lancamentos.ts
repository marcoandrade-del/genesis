import type { FastifyInstance } from 'fastify'
import { LancamentosService, extrairAnoMes } from '../services/lancamentos.js'

const LIMITE_LISTAGEM = 500

/** Aceita escalar, array ou ausente — normaliza para array.
 * Necessário porque formbody devolve string para um único campo
 * repetido e array para múltiplos. */
function asArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined || v === null) return []
  return Array.isArray(v) ? v : [v]
}

/** Resolve o plano vigente para o município no ano da data, considerando
 * herança modelo município → estado. Retorna null se não houver plano
 * (município sem modelo, ou nenhum plano cadastrado para o ano). */
async function resolverPlanoVigente(
  app: FastifyInstance,
  municipioId: string,
  data: string,
): Promise<{ id: string; ano: number; descricao: string } | null> {
  let ano: number
  try {
    ano = extrairAnoMes(data).ano
  } catch {
    return null
  }
  const municipio = await app.prisma.municipio.findUnique({
    where: { id: municipioId },
    include: { estado: { select: { modeloContabilId: true } } },
  })
  if (!municipio) return null
  const modeloEfetivoId = municipio.modeloContabilId ?? municipio.estado.modeloContabilId
  if (!modeloEfetivoId) return null
  const plano = await app.prisma.planoDeContas.findFirst({
    where: { modeloContabilId: modeloEfetivoId, ano },
    select: { id: true, ano: true, descricao: true },
  })
  return plano
}

/**
 * Admin de lançamentos contábeis.
 *
 * Listagem/detalhe/exclusão usam cascata Estado→Município via querystring,
 * igual ao admin de Municípios. Criação tem página própria com lista
 * dinâmica de itens; plano vigente é resolvido por HTMX quando o usuário
 * altera a data (precisamos do planoId para filtrar contas no picker).
 */
export async function adminLancamentosRoutes(app: FastifyInstance) {
  const service = new LancamentosService(app.prisma)

  // ── LIST ────────────────────────────────────────────────────────────────────
  app.get<{ Querystring: { estadoId?: string; municipioId?: string; dataInicio?: string; dataFim?: string } }>(
    '/',
    async (req, reply) => {
      const estadoId = req.query.estadoId?.trim() || ''
      const municipioId = req.query.municipioId?.trim() || ''
      const dataInicio = req.query.dataInicio?.trim() || ''
      const dataFim = req.query.dataFim?.trim() || ''

      const [estados, municipios] = await Promise.all([
        app.prisma.estado.findMany({ orderBy: { sigla: 'asc' }, select: { id: true, sigla: true, nome: true } }),
        estadoId
          ? app.prisma.municipio.findMany({
              where: { estadoId },
              orderBy: { nome: 'asc' },
              select: { id: true, nome: true },
            })
          : Promise.resolve([]),
      ])

      const municipio = municipioId
        ? await app.prisma.municipio.findUnique({
            where: { id: municipioId },
            include: { estado: { select: { id: true, sigla: true, nome: true } } },
          })
        : null

      const lancamentos = municipio
        ? await service.listar(municipio.id, {
            ...(dataInicio ? { dataInicio } : {}),
            ...(dataFim ? { dataFim } : {}),
          })
        : []

      return reply.view(
        'lancamentos/index',
        {
          title: 'Lançamentos — Gênesis Admin',
          active: 'lancamentos',
          userEmail: req.user.email,
          estados,
          municipios,
          estadoSelecionadoId: estadoId,
          municipio,
          dataInicio,
          dataFim,
          lancamentos,
          limite: LIMITE_LISTAGEM,
        },
        { layout: 'layouts/main' },
      )
    },
  )

  // ── PLANO VIGENTE (fragmento HTMX) ──────────────────────────────────────────
  // Disparado quando o usuário troca a data no form; devolve badge + hidden
  // input atualizado. Fora-do-form, o picker de contas usa o hidden #planoId.
  app.get<{ Querystring: { municipioId?: string; data?: string } }>(
    '/plano-vigente',
    async (req, reply) => {
      const municipioId = req.query.municipioId?.trim() || ''
      const data = req.query.data?.trim() || ''
      if (!municipioId || !data) {
        return reply.view('lancamentos/_plano_vigente', { plano: null, ano: null })
      }
      const plano = await resolverPlanoVigente(app, municipioId, data)
      const ano = data.match(/^(\d{4})-/)?.[1]
      return reply.view('lancamentos/_plano_vigente', { plano, ano: ano ? Number(ano) : null })
    },
  )

  // ── FORM (novo) ─────────────────────────────────────────────────────────────
  app.get<{ Querystring: { municipioId?: string } }>('/novo', async (req, reply) => {
    const municipioId = req.query.municipioId?.trim() || ''
    if (!municipioId) {
      return reply.redirect('/admin/lancamentos')
    }
    const municipio = await app.prisma.municipio.findUnique({
      where: { id: municipioId },
      include: { estado: { select: { sigla: true, nome: true } } },
    })
    if (!municipio) return reply.status(404).send('Município não encontrado.')

    // Default = hoje em UTC (consistente com extrairAnoMes que evita timezone).
    const hoje = new Date().toISOString().slice(0, 10)
    const plano = await resolverPlanoVigente(app, municipioId, hoje)

    return reply.view(
      'lancamentos/novo',
      {
        title: 'Novo Lançamento — Gênesis Admin',
        active: 'lancamentos',
        userEmail: req.user.email,
        municipio,
        dataPadrao: hoje,
        plano,
        ano: Number(hoje.slice(0, 4)),
        erro: null,
        itensPreenchidos: null,
        historicoPreenchido: '',
      },
      { layout: 'layouts/main' },
    )
  })

  // ── CREATE ──────────────────────────────────────────────────────────────────
  // Body usa nomes paralelos (tipo, contaId, valor) em vez de bracket notation
  // porque fast-querystring não decompõe `itens[0][tipo]` — duplicatas viram
  // arrays naturalmente. Front-end garante a ordem entre as três listas.
  app.post<{
    Body: {
      municipioId: string
      data: string
      historico: string
      tipo?: string | string[]
      contaId?: string | string[]
      valor?: string | string[]
    }
  }>('/', async (req, reply) => {
    const { municipioId, data, historico } = req.body
    const tipos = asArray(req.body.tipo)
    const contaIds = asArray(req.body.contaId)
    const valores = asArray(req.body.valor)

    const reRenderErro = async (erro: string) => {
      const municipio = await app.prisma.municipio.findUnique({
        where: { id: municipioId },
        include: { estado: { select: { sigla: true, nome: true } } },
      })
      const plano = data ? await resolverPlanoVigente(app, municipioId, data) : null
      const anoMatch = (data ?? '').match(/^(\d{4})-/)?.[1]
      return reply.view(
        'lancamentos/novo',
        {
          title: 'Novo Lançamento — Gênesis Admin',
          active: 'lancamentos',
          userEmail: req.user.email,
          municipio,
          dataPadrao: data || new Date().toISOString().slice(0, 10),
          plano,
          ano: anoMatch ? Number(anoMatch) : null,
          erro,
          // Devolve os itens preenchidos para o usuário corrigir.
          itensPreenchidos: tipos.map((t, i) => ({
            tipo: t,
            contaId: contaIds[i] ?? '',
            valor: valores[i] ?? '',
          })),
          historicoPreenchido: historico ?? '',
        },
        { layout: 'layouts/main' },
      )
    }

    if (!municipioId?.trim()) return reRenderErro('Município não informado.')
    if (!data?.trim()) return reRenderErro('Data é obrigatória.')
    if (!historico?.trim()) return reRenderErro('Histórico é obrigatório.')
    if (tipos.length === 0) return reRenderErro('Adicione ao menos 1 débito e 1 crédito.')
    if (tipos.length !== contaIds.length || tipos.length !== valores.length) {
      return reRenderErro('Dados de itens inconsistentes — recarregue a página.')
    }

    const itens = tipos.map((t, i) => ({ tipo: t, contaId: contaIds[i], valor: valores[i] }))
    for (const it of itens) {
      if (it.tipo !== 'DEBITO' && it.tipo !== 'CREDITO') return reRenderErro(`Tipo inválido: "${it.tipo}".`)
      if (!it.contaId?.trim()) return reRenderErro('Todos os itens precisam ter conta selecionada.')
      if (!it.valor?.trim() || Number.isNaN(Number(it.valor)) || Number(it.valor) <= 0) {
        return reRenderErro('Todos os itens precisam ter valor positivo.')
      }
    }

    try {
      await service.criar({
        municipioId,
        data,
        historico: historico.trim(),
        itens: itens as { tipo: 'DEBITO' | 'CREDITO'; contaId: string; valor: string }[],
        criadoPorId: req.user.sub,
      })
      const qs = new URLSearchParams({ municipioId }).toString()
      return reply.header('HX-Redirect', `/admin/lancamentos?${qs}`).status(204).send()
    } catch (e: unknown) {
      return reRenderErro(e instanceof Error ? e.message : 'Erro ao criar lançamento.')
    }
  })

  // ── DETAIL (modal) ──────────────────────────────────────────────────────────
  app.get<{ Params: { id: string } }>('/:id/detalhe', async (req, reply) => {
    const lanc = await service.buscarPorId(req.params.id)
    if (!lanc) return reply.status(404).send('Lançamento não encontrado.')

    const [municipio, contas] = await Promise.all([
      app.prisma.municipio.findUnique({
        where: { id: lanc.municipioId },
        include: { estado: { select: { sigla: true, nome: true } } },
      }),
      app.prisma.conta.findMany({
        where: { id: { in: lanc.itens.map((i) => i.contaId) } },
        select: { id: true, codigo: true, descricao: true },
      }),
    ])
    const contasPorId = new Map(contas.map((c) => [c.id, c]))

    return reply.view('lancamentos/detalhe', { lanc, municipio, contasPorId })
  })

  // ── DELETE ──────────────────────────────────────────────────────────────────
  // Service.excluir reverte os incrementos em ResumoMensalConta na mesma tx.
  app.delete<{ Params: { id: string } }>('/:id', async (req, reply) => {
    try {
      await service.excluir(req.params.id)
      return reply.status(200).send('')
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Erro ao excluir.'
      return reply.status(400).send(msg)
    }
  })
}
