import type { FastifyInstance } from 'fastify'
import { ContasContabilEntidadeService } from '../services/contas-contabil-entidade.js'
import { registrarRotasPlano } from './plano-entidade.js'

/**
 * Plano de Contas (contábil/patrimonial) do operador. Lista o plano da entidade
 * no exercício corrente (escopo via `req.contexto`, sem picker) e permite
 * desdobrar conta analítica / excluir desdobramento — mesmas regras do /admin.
 */
export async function appContasRoutes(app: FastifyInstance) {
  const servico = new ContasContabilEntidadeService(app.prisma)
  registrarRotasPlano(app, {
    rota: '/contas',
    titulo: 'Plano de Contas (contábil)',
    descricao: 'Contas contábeis do exercício',
    servico,
    listarFlat: (entidadeId, ano) =>
      app.prisma.contaContabilEntidade.findMany({
        where: { entidadeId, ano },
        orderBy: { codigo: 'asc' },
        select: { id: true, codigo: true, descricao: true, nivel: true, admiteMovimento: true, origem: true, parentId: true },
      }),
  })
}
