import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { OrcamentosService } from '../services/orcamentos.js'
import { DotacoesDespesaService } from '../services/dotacoes-despesa.js'
import { PrevisoesReceitaService } from '../services/previsoes-receita.js'
import { SaldoOrcamentarioService } from '../services/saldo-orcamentario.js'
import { ConfiguracaoDashboardService, aplicarGranularidade } from '../services/configuracao-dashboard.js'

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
  const cfgDash = new ConfiguracaoDashboardService(app.prisma)

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

  app.get('/orcamento', async (req, reply) => {
    const { entidadeId, ano, nivel } = req.contexto
    const entidade = await carregarEntidade(req, reply)
    if (!entidade) return

    const orcamento = await orcamentos.buscarPorEntidadeAno(entidadeId, ano)
    const [dotacoes, previsoes] = orcamento
      ? await Promise.all([dotacoesSvc.listar(orcamento.id), previsoesSvc.listar(orcamento.id)])
      : [[], []]
    const totalDespesa = dotacoes.reduce((acc, d) => acc + Number(d.valorAutorizado), 0)
    const totalReceita = previsoes.reduce((acc, p) => acc + Number(p.valorPrevisto), 0)

    return reply.view('app/orcamento', {
      entidade,
      ano,
      nivel,
      orcamento,
      dotacoes,
      previsoes,
      totalDespesa,
      totalReceita,
      layout: null,
    })
  })

  // Saldo orçamentário da despesa do exercício: resumo + agregações (UO, fonte,
  // função e conta com roll-up). Read-only.
  app.get('/orcamento/saldo', async (req, reply) => {
    const { entidadeId, ano, nivel } = req.contexto
    const entidade = await carregarEntidade(req, reply)
    if (!entidade) return
    const saldo = await saldoSvc.calcular(entidadeId, ano)
    const granularidade = await cfgDash.granularidade(entidadeId)
    saldo.porConta = aplicarGranularidade(saldo.porConta, granularidade)
    return reply.view('app/orcamento-saldo', { entidade, ano, nivel, saldo, granularidade, layout: null })
  })
}
