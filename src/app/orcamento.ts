import type { FastifyInstance } from 'fastify'
import { OrcamentosService } from '../services/orcamentos.js'
import { DotacoesDespesaService } from '../services/dotacoes-despesa.js'
import { PrevisoesReceitaService } from '../services/previsoes-receita.js'

/**
 * Área de trabalho "Orçamento" do operador. Diferente do /admin, NÃO há picker
 * de entidade/ano: o escopo vem de `req.contexto` (entidade + exercício
 * escolhidos na sessão). Visão read-only da LOA do exercício corrente.
 */
export async function appOrcamentoRoutes(app: FastifyInstance) {
  const orcamentos = new OrcamentosService(app.prisma)
  const dotacoesSvc = new DotacoesDespesaService(app.prisma)
  const previsoesSvc = new PrevisoesReceitaService(app.prisma)

  app.get('/orcamento', async (req, reply) => {
    const { entidadeId, ano, nivel } = req.contexto
    const entidade = await app.prisma.entidade.findUnique({
      where: { id: entidadeId },
      include: { municipio: { include: { estado: { select: { sigla: true, nome: true } } } } },
    })
    if (!entidade) {
      return reply.clearCookie('genesis_exercicio', { path: '/' }).redirect('/app/contexto')
    }

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
}
