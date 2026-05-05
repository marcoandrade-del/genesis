import type { FastifyInstance } from 'fastify'

export async function adminDashboardRoutes(app: FastifyInstance) {
  app.get('/', async (req, reply) => {
    const [sistemas, modulos, usuarios, itens, relatoriosFixos, recentSistemas, recentUsuarios, recentRelatorios] = await Promise.all([
      app.prisma.sistema.count(),
      app.prisma.modulo.count(),
      app.prisma.usuario.count(),
      app.prisma.itemFuncionalidade.count(),
      app.prisma.relatorioFixo.count(),
      app.prisma.sistema.findMany({ take: 5, orderBy: { criadoEm: 'desc' } }),
      app.prisma.usuario.findMany({ take: 5, orderBy: { criadoEm: 'desc' } }),
      app.prisma.relatorioFixo.findMany({
        take: 5,
        orderBy: { criadoEm: 'desc' },
        include: { sistema: { select: { nome: true } } },
      }),
    ])

    return reply.view(
      'dashboard',
      {
        title: 'Dashboard — Gênesis Admin',
        active: 'dashboard',
        userEmail: req.user.email,
        totais: { sistemas, modulos, usuarios, itens, relatoriosFixos },
        sistemas: recentSistemas,
        usuarios: recentUsuarios,
        relatorios: recentRelatorios,
      },
      { layout: 'layouts/main' },
    )
  })
}
