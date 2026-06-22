import type { FastifyInstance } from 'fastify'
import { Prisma } from '@prisma/client'
import { LiquidacoesService } from '../services/liquidacoes.js'

async function carregarEmpenhos(app: FastifyInstance, entidadeId: string) {
  const empenhos = await app.prisma.empenho.findMany({
    where: { entidadeId, status: 'ATIVO' },
    orderBy: { data: 'desc' },
    select: { id: true, numero: true, valor: true, valorLiquidado: true, fornecedor: { select: { razaoSocial: true } } },
  })
  return empenhos.map((e) => ({
    id: e.id,
    rotulo: `${e.numero} — ${e.fornecedor.razaoSocial}`,
    disponivel: new Prisma.Decimal(e.valor).minus(e.valorLiquidado).toFixed(2),
  }))
}

/**
 * Admin de Liquidações (2º estágio). Picker cascata; lista por entidade; form
 * com seleção de empenho ATIVO (saldo disponível); cancelamento com estorno.
 */
export async function adminLiquidacoesRoutes(app: FastifyInstance) {
  const service = new LiquidacoesService(app.prisma)

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
    const liquidacoes = entidade ? await service.listar(entidade.id) : []
    return reply.view(
      'liquidacoes/index',
      { title: 'Liquidações — Gênesis Admin', active: 'liquidacoes', userEmail: req.user.email, estados, municipios, entidades, estadoSelecionadoId: estadoId, municipioSelecionadoId: municipioId, entidade, liquidacoes },
      { layout: 'layouts/main' },
    )
  })

  app.get<{ Querystring: { entidadeId?: string } }>('/form', async (req, reply) => {
    const entidadeId = req.query.entidadeId?.trim() || ''
    if (!entidadeId) return reply.status(400).send('Entidade não informada.')
    const empenhos = await carregarEmpenhos(app, entidadeId)
    return reply.view('liquidacoes/form', { entidadeId, liquidacao: null, empenhos, erro: null })
  })

  app.post<{
    Body: { entidadeId: string; empenhoId: string; numero: string; data?: string; valor: string; notaFiscal?: string; atesteResponsavel?: string }
  }>('/', async (req, reply) => {
    const b = req.body
    if (!b.entidadeId?.trim()) return reply.status(400).send('Entidade não informada.')
    try {
      await service.criar(b.entidadeId, {
        empenhoId: b.empenhoId, numero: b.numero, valor: b.valor,
        ...(b.data ? { data: b.data } : {}),
        ...(b.notaFiscal ? { notaFiscal: b.notaFiscal } : {}),
        ...(b.atesteResponsavel ? { atesteResponsavel: b.atesteResponsavel } : {}),
      }, req.user.sub)
      return reply.header('HX-Redirect', `/admin/liquidacoes?${new URLSearchParams({ entidadeId: b.entidadeId })}`).status(204).send()
    } catch (e: unknown) {
      const empenhos = await carregarEmpenhos(app, b.entidadeId)
      return reply.view('liquidacoes/form', { entidadeId: b.entidadeId, liquidacao: b, empenhos, erro: e instanceof Error ? e.message : 'Erro ao liquidar.' })
    }
  })

  app.post<{ Params: { id: string } }>('/:id/cancelar', async (req, reply) => {
    const liq = await app.prisma.liquidacao.findUnique({ where: { id: req.params.id }, select: { entidadeId: true } })
    if (!liq) return reply.status(404).send('Liquidação não encontrada.')
    try {
      await service.cancelar(req.params.id, req.user.sub)
      return reply.header('HX-Redirect', `/admin/liquidacoes?${new URLSearchParams({ entidadeId: liq.entidadeId })}`).status(204).send()
    } catch (e: unknown) {
      return reply.status(400).send(e instanceof Error ? e.message : 'Erro ao cancelar.')
    }
  })
}
