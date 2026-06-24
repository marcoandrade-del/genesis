import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { OrcamentosService } from '../services/orcamentos.js'
import { DotacoesDespesaService } from '../services/dotacoes-despesa.js'
import { PrevisoesReceitaService } from '../services/previsoes-receita.js'
import { SaldoOrcamentarioService } from '../services/saldo-orcamentario.js'
import { DespesaDiariaService } from '../services/despesa-diaria.js'
import { ConfiguracaoDashboardService, aplicarGranularidade } from '../services/configuracao-dashboard.js'
import { AberturaContabilService } from '../services/abertura-contabil.js'
import { ErroNegocio, statusDeErro } from '../errors.js'

const ERRO_LEITURA = 'Acesso somente leitura nesta entidade.'

/**
 * Área de trabalho "Orçamento" do operador. Diferente do /admin, NÃO há picker
 * de entidade/ano: o escopo vem de `req.contexto` (entidade + exercício
 * escolhidos na sessão). Visão read-only da LOA do exercício corrente.
 */
export async function appOrcamentoRoutes(app: FastifyInstance) {
  const orcamentos = new OrcamentosService(app.prisma)
  const dotacoesSvc = new DotacoesDespesaService(app.prisma)
  const previsoesSvc = new PrevisoesReceitaService(app.prisma)
  const saldoSvc = new SaldoOrcamentarioService(app.prisma)
  const despesaDiariaSvc = new DespesaDiariaService(app.prisma)
  const cfgDash = new ConfiguracaoDashboardService(app.prisma)
  const aberturaSvc = new AberturaContabilService(app.prisma)

  /** Carrega a entidade do contexto; se sumiu, limpa cookie e manda escolher. */
  async function carregarEntidade(req: FastifyRequest, reply: FastifyReply) {
    const entidade = await app.prisma.entidade.findUnique({
      where: { id: req.contexto.entidadeId },
      include: { municipio: { include: { estado: { select: { sigla: true, nome: true } } } } },
    })
    if (!entidade) {
      reply.clearCookie('genesis_exercicio', { path: '/' }).redirect('/app/contexto')
      return null
    }
    return entidade
  }

  /** Renderiza a tela do orçamento, recarregando todos os dados (+ status da abertura). */
  async function renderOrcamento(
    req: FastifyRequest,
    reply: FastifyReply,
    entidade: { id: string },
    opts: { erro?: string; ok?: string; status?: number } = {},
  ) {
    const { entidadeId, ano, nivel } = req.contexto
    const orcamento = await orcamentos.buscarPorEntidadeAno(entidadeId, ano)
    const [dotacoes, previsoes] = orcamento
      ? await Promise.all([dotacoesSvc.listar(orcamento.id), previsoesSvc.listar(orcamento.id)])
      : [[], []]
    const totalDespesa = dotacoes.reduce((acc, d) => acc + Number(d.valorAutorizado), 0)
    const totalReceita = previsoes.reduce((acc, p) => acc + Number(p.valorPrevisto), 0)
    const abertura = await aberturaSvc.status(entidadeId, ano)

    if (opts.status) reply.code(opts.status)
    return reply.view('app/orcamento', {
      entidade, ano, nivel, orcamento, dotacoes, previsoes, totalDespesa, totalReceita, abertura,
      podeEscrever: nivel === 'ESCRITA' || nivel === 'ADMIN',
      erro: opts.erro ?? null, ok: opts.ok ?? null, layout: null,
    })
  }

  app.get('/orcamento', async (req, reply) => {
    const entidade = await carregarEntidade(req, reply)
    if (!entidade) return
    return renderOrcamento(req, reply, entidade)
  })

  // Contabiliza a abertura do exercício (PCASP): gera os lançamentos de abertura
  // do orçamentário + transporta os saldos patrimoniais; LOA APROVADO → EM_EXECUCAO.
  app.post('/orcamento/abertura/contabilizar', async (req, reply) => {
    const { entidadeId, ano, nivel } = req.contexto
    const entidade = await carregarEntidade(req, reply)
    if (!entidade) return
    if (nivel !== 'ESCRITA' && nivel !== 'ADMIN') {
      return renderOrcamento(req, reply, entidade, { erro: ERRO_LEITURA, status: 403 })
    }
    try {
      const r = await aberturaSvc.contabilizar(entidadeId, ano, req.user.sub)
      return renderOrcamento(req, reply, entidade, {
        ok: `Abertura contabilizada: ${r.previsoes} previsão(ões), ${r.dotacoes} dotação(ões), ${r.contasTransportadas} conta(s) transportada(s).`,
      })
    } catch (e) {
      if (e instanceof ErroNegocio) return renderOrcamento(req, reply, entidade, { erro: e.message, status: statusDeErro(e.code) })
      throw e
    }
  })

  // Estorna a abertura (reverte os lançamentos + transporte; EM_EXECUCAO → APROVADO).
  app.post('/orcamento/abertura/estornar', async (req, reply) => {
    const { entidadeId, ano, nivel } = req.contexto
    const entidade = await carregarEntidade(req, reply)
    if (!entidade) return
    if (nivel !== 'ESCRITA' && nivel !== 'ADMIN') {
      return renderOrcamento(req, reply, entidade, { erro: ERRO_LEITURA, status: 403 })
    }
    try {
      await aberturaSvc.estornar(entidadeId, ano, req.user.sub)
      return renderOrcamento(req, reply, entidade, { ok: 'Abertura estornada — o orçamento voltou a Publicado.' })
    } catch (e) {
      if (e instanceof ErroNegocio) return renderOrcamento(req, reply, entidade, { erro: e.message, status: statusDeErro(e.code) })
      throw e
    }
  })

  // Saldo orçamentário da despesa do exercício: resumo + agregações (UO, fonte,
  // função e conta com roll-up). Read-only.
  app.get<{ Querystring: { g?: string } }>('/orcamento/saldo', async (req, reply) => {
    const { entidadeId, ano, nivel } = req.contexto
    const entidade = await carregarEntidade(req, reply)
    if (!entidade) return
    const saldo = await saldoSvc.calcular(entidadeId, ano)
    const temDesdobramento = saldo.porConta.some((l) => l.origem === 'DESDOBRAMENTO')
    const g = req.query.g
    let granularidade: 'PADRAO' | 'DESDOBRADO'
    if (g === 'PADRAO' || g === 'DESDOBRADO') {
      await cfgDash.definirRelatorio(entidadeId, '/orcamento/saldo', g)
      granularidade = g
    } else {
      granularidade = await cfgDash.granularidadeRelatorio(entidadeId, '/orcamento/saldo')
    }
    saldo.porConta = aplicarGranularidade(saldo.porConta, granularidade)
    return reply.view('app/orcamento-saldo', { entidade, ano, nivel, saldo, granularidade, temDesdobramento, layout: null })
  })

  // Acumulado diário da despesa: evolução do empenhado/liquidado/pago dia a dia
  // vs o fixado, lida do ledger MovimentoEmpenho. Read-only. Espelha a receita (#113).
  app.get('/orcamento/despesa/diario', async (req, reply) => {
    const entidade = await carregarEntidade(req, reply)
    if (!entidade) return
    const { entidadeId, ano } = req.contexto
    const serie = await despesaDiariaSvc.serie(entidadeId, ano)
    const n = (d: { toNumber(): number }) => d.toNumber()
    const dataBR = (d: Date) => d.toLocaleDateString('pt-BR', { timeZone: 'UTC' })
    return reply.view('app/despesa-diario', {
      entidade,
      ano,
      temOrcamento: serie.temOrcamento,
      fixadoTotal: n(serie.fixadoTotal),
      empenhadoTotal: n(serie.empenhadoTotal),
      liquidadoTotal: n(serie.liquidadoTotal),
      pagoTotal: n(serie.pagoTotal),
      dias: serie.dias.map((d) => ({
        data: dataBR(d.data),
        empenhadoDia: n(d.empenhadoDia),
        empenhado: n(d.empenhadoAcumulado),
        liquidado: n(d.liquidadoAcumulado),
        pago: n(d.pagoAcumulado),
      })),
      layout: null,
    })
  })
}
