import type { FastifyInstance } from 'fastify'
import { EmpenhosService } from '../services/empenhos.js'
import { saldoDisponivel } from '../services/reservas-dotacao.js'

async function carregarLookups(app: FastifyInstance, entidadeId: string) {
  const [dotacoesRaw, fornecedores, reservasRaw, contratos, atas] = await Promise.all([
    app.prisma.dotacaoDespesa.findMany({
      where: { orcamento: { entidadeId, status: { not: 'RASCUNHO' } } },
      include: { unidadeOrcamentaria: { select: { codigo: true } }, contaDespesa: { select: { codigo: true } }, fonteRecurso: { select: { codigo: true } }, orcamento: { select: { ano: true } } },
      orderBy: { criadoEm: 'asc' },
    }),
    app.prisma.fornecedor.findMany({ where: { ativo: true }, orderBy: { razaoSocial: 'asc' }, select: { id: true, razaoSocial: true } }),
    app.prisma.reservaDotacao.findMany({ where: { entidadeId, status: 'ATIVA' }, orderBy: { data: 'desc' }, select: { id: true, numero: true, valor: true, dotacaoDespesaId: true } }),
    app.prisma.contrato.findMany({ where: { entidadeId }, orderBy: { criadoEm: 'desc' }, select: { id: true, numero: true } }),
    app.prisma.ataRegistroPreco.findMany({ where: { entidadeId }, orderBy: { criadoEm: 'desc' }, select: { id: true, numero: true } }),
  ])
  const dotacoes = dotacoesRaw.map((d) => ({
    id: d.id, ano: d.orcamento.ano,
    rotulo: `${d.unidadeOrcamentaria.codigo} · ${d.contaDespesa.codigo} · Fonte ${d.fonteRecurso.codigo}`,
    disponivel: saldoDisponivel(d).toFixed(2),
  }))
  const reservas = reservasRaw.map((r) => ({ id: r.id, numero: r.numero, valor: Number(r.valor).toFixed(2), dotacaoDespesaId: r.dotacaoDespesaId }))
  return { dotacoes, fornecedores, reservas, contratos, atas }
}

/**
 * Admin de Empenhos (1º estágio). Picker cascata; lista por entidade; form com
 * seleção de dotação (saldo), fornecedor e reserva a converter (REGRA 2);
 * anulação com estorno.
 */
export async function adminEmpenhosRoutes(app: FastifyInstance) {
  const service = new EmpenhosService(app.prisma)

  app.get<{ Querystring: { estadoId?: string; municipioId?: string; entidadeId?: string } }>('/', async (req, reply) => {
    const estadoId = req.query.estadoId?.trim() || ''
    const municipioId = req.query.municipioId?.trim() || ''
    const entidadeId = req.query.entidadeId?.trim() || ''
    const [estados, municipios, entidades] = await Promise.all([
      app.prisma.estado.findMany({ orderBy: { sigla: 'asc' }, select: { id: true, sigla: true, nome: true } }),
      estadoId ? app.prisma.municipio.findMany({ where: { estadoId }, orderBy: { nome: 'asc' }, select: { id: true, nome: true } }) : Promise.resolve([]),
      municipioId ? app.prisma.entidade.findMany({ where: { municipioId, ativo: true }, orderBy: { nome: 'asc' }, select: { id: true, nome: true } }) : Promise.resolve([]),
    ])
    const entidade = entidadeId
      ? await app.prisma.entidade.findUnique({ where: { id: entidadeId }, include: { municipio: { include: { estado: { select: { sigla: true, nome: true } } } } } })
      : null
    const empenhos = entidade ? await service.listar(entidade.id) : []
    return reply.view(
      'empenhos/index',
      { title: 'Empenhos — Gênesis Admin', active: 'empenhos', userEmail: req.user.email, estados, municipios, entidades, estadoSelecionadoId: estadoId, municipioSelecionadoId: municipioId, entidade, empenhos },
      { layout: 'layouts/main' },
    )
  })

  app.get<{ Querystring: { entidadeId?: string } }>('/form', async (req, reply) => {
    const entidadeId = req.query.entidadeId?.trim() || ''
    if (!entidadeId) return reply.status(400).send('Entidade não informada.')
    const lookups = await carregarLookups(app, entidadeId)
    return reply.view('empenhos/form', { entidadeId, empenho: null, erro: null, ...lookups })
  })

  // Ficha de empenho: razão imutável + as 6 colunas/saldos (Specs 22-06-2026 §8).
  app.get<{ Params: { id: string } }>('/:id/ficha', async (req, reply) => {
    const ficha = await service.ficha(req.params.id).catch(() => null)
    if (!ficha) return reply.status(404).send('Empenho não encontrado.')
    return reply.view(
      'empenhos/ficha',
      { title: `Ficha ${ficha.empenho.numero} — Gênesis Admin`, active: 'empenhos', userEmail: req.user.email, ...ficha },
      { layout: 'layouts/main' },
    )
  })

  app.post<{
    Body: { entidadeId: string; dotacaoDespesaId: string; fornecedorId: string; reservaDotacaoId?: string; contratoId?: string; ataRegistroPrecoId?: string; numero: string; tipo: string; data?: string; valor: string; historico?: string }
  }>('/', async (req, reply) => {
    const b = req.body
    if (!b.entidadeId?.trim()) return reply.status(400).send('Entidade não informada.')
    try {
      await service.criar(b.entidadeId, {
        dotacaoDespesaId: b.dotacaoDespesaId, fornecedorId: b.fornecedorId, numero: b.numero, tipo: b.tipo as never, valor: b.valor,
        ...(b.reservaDotacaoId ? { reservaDotacaoId: b.reservaDotacaoId } : {}),
        ...(b.contratoId ? { contratoId: b.contratoId } : {}),
        ...(b.ataRegistroPrecoId ? { ataRegistroPrecoId: b.ataRegistroPrecoId } : {}),
        ...(b.data ? { data: b.data } : {}),
        ...(b.historico ? { historico: b.historico } : {}),
      }, req.user.sub)
      return reply.header('HX-Redirect', `/admin/empenhos?${new URLSearchParams({ entidadeId: b.entidadeId })}`).status(204).send()
    } catch (e: unknown) {
      const lookups = await carregarLookups(app, b.entidadeId)
      return reply.view('empenhos/form', { entidadeId: b.entidadeId, empenho: b, erro: e instanceof Error ? e.message : 'Erro ao criar empenho.', ...lookups })
    }
  })

  app.post<{ Params: { id: string }; Body: { valor: string; data?: string } }>('/:id/estornar', async (req, reply) => {
    const empenho = await app.prisma.empenho.findUnique({ where: { id: req.params.id }, select: { entidadeId: true } })
    if (!empenho) return reply.status(404).send('Empenho não encontrado.')
    try {
      await service.estornar(req.params.id, req.body.valor, req.user.sub, req.body.data ? new Date(req.body.data) : undefined)
      return reply.header('HX-Redirect', `/admin/empenhos/${req.params.id}/ficha`).status(204).send()
    } catch (e: unknown) {
      return reply.status(400).send(e instanceof Error ? e.message : 'Erro ao estornar.')
    }
  })
}
