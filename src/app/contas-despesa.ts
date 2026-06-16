import type { FastifyInstance } from 'fastify'
import { ContasDespesaEntidadeService } from '../services/contas-despesa-entidade.js'
import { registrarRotasPlano } from './plano-entidade.js'

/**
 * Plano de Despesa (orçamentário) do operador. Mesmo desenho do plano contábil:
 * lista do exercício corrente + desdobrar/excluir desdobramento, reusando as
 * regras do service (modelo TCE imutável, só folha analítica desdobra).
 */
export async function appContasDespesaRoutes(app: FastifyInstance) {
  const servico = new ContasDespesaEntidadeService(app.prisma)
  registrarRotasPlano(app, {
    rota: '/contas-despesa',
    titulo: 'Plano de Despesa',
    descricao: 'Contas de despesa do exercício',
    servico,
    listarFlat: (entidadeId, ano) =>
      app.prisma.contaDespesaEntidade.findMany({
        where: { entidadeId, ano },
        orderBy: { codigo: 'asc' },
        select: { id: true, codigo: true, descricao: true, nivel: true, admiteMovimento: true, origem: true, parentId: true },
      }),
  })
}
