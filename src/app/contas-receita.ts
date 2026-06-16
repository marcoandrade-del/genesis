import type { FastifyInstance } from 'fastify'
import { ContasReceitaEntidadeService } from '../services/contas-receita-entidade.js'
import { registrarRotasPlano } from './plano-entidade.js'

/**
 * Plano de Receita (orçamentário) do operador. Mesmo desenho do plano contábil:
 * lista do exercício corrente + desdobrar/excluir desdobramento, reusando as
 * regras do service (modelo TCE imutável, só folha analítica desdobra).
 */
export async function appContasReceitaRoutes(app: FastifyInstance) {
  const servico = new ContasReceitaEntidadeService(app.prisma)
  registrarRotasPlano(app, {
    rota: '/contas-receita',
    titulo: 'Plano de Receita',
    descricao: 'Contas de receita do exercício',
    servico,
    listarFlat: (entidadeId, ano) =>
      app.prisma.contaReceitaEntidade.findMany({
        where: { entidadeId, ano },
        orderBy: { codigo: 'asc' },
        select: { id: true, codigo: true, descricao: true, nivel: true, admiteMovimento: true, origem: true, parentId: true },
      }),
  })
}
