import type { FastifyInstance } from 'fastify'
import { FuncoesService } from '../services/funcoes.js'

/**
 * Página somente-leitura das funções e subfunções da Portaria MOG nº 42/1999.
 * A lista é fixa por lei federal — sem CRUD.
 */
export async function adminFuncoesRoutes(app: FastifyInstance) {
  const service = new FuncoesService(app.prisma)

  app.get('/', async (req, reply) => {
    const funcoes = await service.listar()
    return reply.view(
      'funcoes/index',
      {
        title: 'Classificação Funcional — Gênesis Admin',
        active: 'funcoes',
        userEmail: req.user.email,
        funcoes,
      },
      { layout: 'layouts/main' },
    )
  })
}
