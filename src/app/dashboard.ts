import type { FastifyInstance } from 'fastify'

/**
 * Dashboard inicial do /app — assume que `req.contexto` já foi injetado pelo
 * middleware (entidade + ano escolhidos). Mostra o contexto ativo e atalhos
 * para as áreas de trabalho.
 */
export async function appDashboardRoutes(app: FastifyInstance) {
  app.get('/', async (req, reply) => {
    const { entidadeId, ano, nivel } = req.contexto
    const entidade = await app.prisma.entidade.findUnique({
      where: { id: entidadeId },
      include: { municipio: { include: { estado: { select: { sigla: true, nome: true } } } } },
    })
    if (!entidade) {
      // Cookie obsoleto (entidade removida): força nova escolha.
      return reply.clearCookie('genesis_exercicio', { path: '/' }).redirect('/app/contexto')
    }
    return reply.view('app/dashboard', { entidade, ano, nivel, layout: null })
  })
}
