import type { FastifyInstance } from 'fastify'
import { LancamentosService } from '../services/lancamentos.js'

/**
 * Área "Lançamentos" do operador. Escopo (entidade + ano) vem de `req.contexto`;
 * a listagem filtra pelo exercício corrente (1º-jan a 31-dez do ano). Read-only.
 */
export async function appLancamentosRoutes(app: FastifyInstance) {
  const lancamentos = new LancamentosService(app.prisma)

  app.get('/lancamentos', async (req, reply) => {
    const { entidadeId, ano, nivel } = req.contexto
    const entidade = await app.prisma.entidade.findUnique({
      where: { id: entidadeId },
      include: { municipio: { include: { estado: { select: { sigla: true, nome: true } } } } },
    })
    if (!entidade) {
      return reply.clearCookie('genesis_exercicio', { path: '/' }).redirect('/app/contexto')
    }

    const lista = await lancamentos.listar(entidadeId, {
      dataInicio: `${ano}-01-01`,
      dataFim: `${ano}-12-31`,
    })
    const total = lista.reduce((acc, l) => acc + Number(l.valor), 0)

    return reply.view('app/lancamentos', { entidade, ano, nivel, lancamentos: lista, total, layout: null })
  })
}
