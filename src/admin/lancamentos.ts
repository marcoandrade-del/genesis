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

/** Conta as contas-folha disponíveis na entidade para o ano da data.
 * `entidadeId` válido + ano válido → número >= 0. Demais casos → null. */
async function contasDisponiveisNoAno(
  app: FastifyInstance,
  entidadeId: string,
  data: string,
): Promise<{ ano: number; total: number } | null> {
  let ano: number
  try {
    ano = extrairAnoMes(data).ano
  } catch {
    return null
  }
  const total = await app.prisma.contaContabilEntidade.count({
    where: { entidadeId, ano, admiteMovimento: true },
  })
  return { ano, total }
}

/**
 * Admin de lançamentos contábeis.
 *
 * Listagem/detalhe/exclusão usam cascata Estado→Município→Entidade via
 * querystring (lançamento é por entidade, não por município). Criação tem
 * página própria com lista dinâmica de itens. Ao trocar a data, HTMX recarrega
 * o badge de "ano vigente" (que confere se a entidade tem contas no ano).
 */
export async function adminLancamentosRoutes(app: FastifyInstance) {
  const service = new LancamentosService(app.prisma)

  // ── LIST ────────────────────────────────────────────────────────────────────
  app.get<{
    Querystring: {
      estadoId?: string
      municipioId?: string
      entidadeId?: string
      dataInicio?: string
      dataFim?: string
    }
  }>('/', async (req, reply) => {
    const estadoId = req.query.estadoId?.trim() || ''
    const municipioId = req.query.municipioId?.trim() || ''
    const entidadeId = req.query.entidadeId?.trim() || ''
    const dataInicio = req.query.dataInicio?.trim() || ''
    const dataFim = req.query.dataFim?.trim() || ''

    const [estados, municipios, entidades] = await Promise.all([
      app.prisma.estado.findMany({ orderBy: { sigla: 'asc' }, select: { id: true, sigla: true, nome: true } }),
      estadoId
        ? app.prisma.municipio.findMany({
            where: { estadoId },
            orderBy: { nome: 'asc' },
            select: { id: true, nome: true },
          })
        : Promise.resolve([]),
      municipioId
        ? app.prisma.entidade.findMany({
            where: { municipioId, ativo: true },
            orderBy: { nome: 'asc' },
            select: { id: true, nome: true, tipo: true },
          })
        : Promise.resolve([]),
    ])

    const entidade = entidadeId
      ? await app.prisma.entidade.findUnique({
          where: { id: entidadeId },
          include: { municipio: { include: { estado: { select: { id: true, sigla: true, nome: true } } } } },
        })
      : null

    const lancamentos = entidade
      ? await service.listar(entidade.id, {
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
        entidades,
        estadoSelecionadoId: estadoId,
        municipioSelecionadoId: municipioId,
        entidade,
        dataInicio,
        dataFim,
        lancamentos,
        limite: LIMITE_LISTAGEM,
      },
      { layout: 'layouts/main' },
    )
  })

  // ── ANO VIGENTE (fragmento HTMX) ────────────────────────────────────────────
  // Disparado quando o usuário troca a data no form; devolve badge + hidden
  // input atualizado. Fora-do-form, o picker de contas usa o hidden #ano.
  app.get<{ Querystring: { entidadeId?: string; data?: string } }>('/ano-vigente', async (req, reply) => {
    const entidadeId = req.query.entidadeId?.trim() || ''
    const data = req.query.data?.trim() || ''
    if (!entidadeId || !data) {
      return reply.view('lancamentos/_ano_vigente', { info: null, ano: null })
    }
    const info = await contasDisponiveisNoAno(app, entidadeId, data)
    return reply.view('lancamentos/_ano_vigente', { info, ano: info?.ano ?? null })
  })

  // ── FORM (novo) ─────────────────────────────────────────────────────────────
  app.get<{ Querystring: { entidadeId?: string } }>('/novo', async (req, reply) => {
    const entidadeId = req.query.entidadeId?.trim() || ''
    if (!entidadeId) {
      return reply.redirect('/admin/lancamentos')
    }
    const entidade = await app.prisma.entidade.findUnique({
      where: { id: entidadeId },
      include: { municipio: { include: { estado: { select: { sigla: true, nome: true } } } } },
    })
    if (!entidade) return reply.status(404).send('Entidade não encontrada.')

    // Default = hoje em UTC (consistente com extrairAnoMes que evita timezone).
    const hoje = new Date().toISOString().slice(0, 10)
    const info = await contasDisponiveisNoAno(app, entidadeId, hoje)

    return reply.view(
      'lancamentos/novo',
      {
        title: 'Novo Lançamento — Gênesis Admin',
        active: 'lancamentos',
        userEmail: req.user.email,
        entidade,
        dataPadrao: hoje,
        info,
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
      entidadeId: string
      data: string
      historico: string
      tipo?: string | string[]
      contaId?: string | string[]
      valor?: string | string[]
    }
  }>('/', async (req, reply) => {
    const { entidadeId, data, historico } = req.body
    const tipos = asArray(req.body.tipo)
    const contaIds = asArray(req.body.contaId)
    const valores = asArray(req.body.valor)

    const reRenderErro = async (erro: string) => {
      const entidade = await app.prisma.entidade.findUnique({
        where: { id: entidadeId },
        include: { municipio: { include: { estado: { select: { sigla: true, nome: true } } } } },
      })
      const info = data ? await contasDisponiveisNoAno(app, entidadeId, data) : null
      const anoMatch = (data ?? '').match(/^(\d{4})-/)?.[1]
      return reply.view(
        'lancamentos/novo',
        {
          title: 'Novo Lançamento — Gênesis Admin',
          active: 'lancamentos',
          userEmail: req.user.email,
          entidade,
          dataPadrao: data || new Date().toISOString().slice(0, 10),
          info,
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

    if (!entidadeId?.trim()) {
      // Sem entidade não conseguimos renderizar o form novamente.
      return reply.status(400).send('Entidade não informada.')
    }
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
        entidadeId,
        data,
        historico: historico.trim(),
        itens: itens as { tipo: 'DEBITO' | 'CREDITO'; contaId: string; valor: string }[],
        criadoPorId: req.user.sub,
      })
      const qs = new URLSearchParams({ entidadeId }).toString()
      return reply.header('HX-Redirect', `/admin/lancamentos?${qs}`).status(204).send()
    } catch (e: unknown) {
      return reRenderErro(e instanceof Error ? e.message : 'Erro ao criar lançamento.')
    }
  })

  // ── DETAIL (modal) ──────────────────────────────────────────────────────────
  app.get<{ Params: { id: string } }>('/:id/detalhe', async (req, reply) => {
    const lanc = await service.buscarPorId(req.params.id)
    if (!lanc) return reply.status(404).send('Lançamento não encontrado.')

    const [entidade, contas] = await Promise.all([
      app.prisma.entidade.findUnique({
        where: { id: lanc.entidadeId },
        include: { municipio: { include: { estado: { select: { sigla: true, nome: true } } } } },
      }),
      app.prisma.contaContabilEntidade.findMany({
        where: { id: { in: lanc.itens.map((i) => i.contaId) } },
        select: { id: true, codigo: true, descricao: true },
      }),
    ])
    const contasPorId = new Map(contas.map((c) => [c.id, c]))

    return reply.view('lancamentos/detalhe', { lanc, entidade, contasPorId })
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
