import type { FastifyInstance } from 'fastify'
import { Prisma } from '@prisma/client'
import { OrdensPagamentoService } from '../services/ordens-pagamento.js'
import { rotuloConta } from '../services/contas-bancarias.js'

async function carregarLiquidacoes(app: FastifyInstance, entidadeId: string) {
  const liqs = await app.prisma.liquidacao.findMany({
    where: { entidadeId, status: 'ATIVA' },
    orderBy: { data: 'desc' },
    select: {
      id: true,
      numero: true,
      valor: true,
      valorPago: true,
      empenho: {
        select: {
          numero: true,
          dotacaoDespesa: { select: { fonteRecurso: { select: { codigo: true, nomenclatura: true } } } },
        },
      },
    },
  })
  return liqs.map((l) => ({
    id: l.id,
    rotulo: `${l.numero} (emp. ${l.empenho.numero})`,
    disponivel: new Prisma.Decimal(l.valor).minus(l.valorPago).toFixed(2),
    fonteCodigo: l.empenho.dotacaoDespesa.fonteRecurso.codigo,
    fonteNomenclatura: l.empenho.dotacaoDespesa.fonteRecurso.nomenclatura,
  }))
}

// Contas ativas da entidade p/ o select da OP (filtrado no cliente pela fonte
// da liquidação escolhida — regra: pagamento só por conta da fonte).
async function carregarContas(app: FastifyInstance, entidadeId: string) {
  const contas = await app.prisma.contaBancaria.findMany({
    where: { entidadeId, ativa: true },
    orderBy: [{ fonteCodigo: 'asc' }, { bancoCodigo: 'asc' }, { agencia: 'asc' }, { numero: 'asc' }],
  })
  return contas.map((c) => ({ id: c.id, fonteCodigo: c.fonteCodigo, rotulo: rotuloConta(c) }))
}

/**
 * Admin de Ordens de Pagamento (3º estágio). Picker cascata; lista por entidade;
 * form com seleção de liquidação ATIVA (saldo); confirmar pagamento e cancelar.
 */
export async function adminOrdensPagamentoRoutes(app: FastifyInstance) {
  const service = new OrdensPagamentoService(app.prisma)

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
    const ordens = entidade ? await service.listar(entidade.id) : []
    return reply.view(
      'ordens-pagamento/index',
      { title: 'Ordens de Pagamento — Gênesis Admin', active: 'ordens-pagamento', userEmail: req.user.email, estados, municipios, entidades, estadoSelecionadoId: estadoId, municipioSelecionadoId: municipioId, entidade, ordens },
      { layout: 'layouts/main' },
    )
  })

  app.get<{ Querystring: { entidadeId?: string } }>('/form', async (req, reply) => {
    const entidadeId = req.query.entidadeId?.trim() || ''
    if (!entidadeId) return reply.status(400).send('Entidade não informada.')
    const [liquidacoes, contas] = await Promise.all([carregarLiquidacoes(app, entidadeId), carregarContas(app, entidadeId)])
    return reply.view('ordens-pagamento/form', { entidadeId, op: null, liquidacoes, contas, erro: null })
  })

  app.post<{
    Body: { entidadeId: string; liquidacaoId: string; numero: string; data?: string; valor: string; contaBancariaId: string; comprovante?: string }
  }>('/', async (req, reply) => {
    const b = req.body
    if (!b.entidadeId?.trim()) return reply.status(400).send('Entidade não informada.')
    try {
      await service.criar(b.entidadeId, {
        liquidacaoId: b.liquidacaoId, numero: b.numero, valor: b.valor, contaBancariaId: b.contaBancariaId,
        ...(b.data ? { data: b.data } : {}),
        ...(b.comprovante ? { comprovante: b.comprovante } : {}),
      }, req.user.sub)
      return reply.header('HX-Redirect', `/admin/ordens-pagamento?${new URLSearchParams({ entidadeId: b.entidadeId })}`).status(204).send()
    } catch (e: unknown) {
      const [liquidacoes, contas] = await Promise.all([carregarLiquidacoes(app, b.entidadeId), carregarContas(app, b.entidadeId)])
      return reply.view('ordens-pagamento/form', { entidadeId: b.entidadeId, op: b, liquidacoes, contas, erro: e instanceof Error ? e.message : 'Erro ao emitir OP.' })
    }
  })

  app.post<{ Params: { id: string }; Body: { comprovante?: string } }>('/:id/confirmar', async (req, reply) => {
    const op = await app.prisma.ordemPagamento.findUnique({ where: { id: req.params.id }, select: { entidadeId: true } })
    if (!op) return reply.status(404).send('OP não encontrada.')
    try {
      await service.confirmarPagamento(req.params.id, req.body.comprovante)
      return reply.header('HX-Redirect', `/admin/ordens-pagamento?${new URLSearchParams({ entidadeId: op.entidadeId })}`).status(204).send()
    } catch (e: unknown) {
      return reply.status(400).send(e instanceof Error ? e.message : 'Erro ao confirmar.')
    }
  })

  app.post<{ Params: { id: string } }>('/:id/cancelar', async (req, reply) => {
    const op = await app.prisma.ordemPagamento.findUnique({ where: { id: req.params.id }, select: { entidadeId: true } })
    if (!op) return reply.status(404).send('OP não encontrada.')
    try {
      await service.cancelar(req.params.id, req.user.sub)
      return reply.header('HX-Redirect', `/admin/ordens-pagamento?${new URLSearchParams({ entidadeId: op.entidadeId })}`).status(204).send()
    } catch (e: unknown) {
      return reply.status(400).send(e instanceof Error ? e.message : 'Erro ao cancelar.')
    }
  })
}
