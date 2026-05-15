import type { FastifyInstance } from 'fastify'

export async function adminFuncionandoRoutes(app: FastifyInstance) {
  app.get('/', async (req, reply) => {
    const sistemas = await app.prisma.sistema.findMany({
      where: { ativo: true },
      orderBy: { nome: 'asc' },
      include: {
        modulos: {
          where: { ativo: true },
          orderBy: [{ ordem: 'asc' }, { nome: 'asc' }],
        },
      },
    })
    return reply.view('funcionando/index', { userEmail: req.user.email, sistemas })
  })

  app.get<{ Params: { moduloId: string } }>('/modulo/:moduloId', async (req, reply) => {
    const modulo = await app.prisma.modulo.findUnique({
      where: { id: req.params.moduloId },
      include: {
        sistema: { select: { nome: true } },
        menus: {
          where: { ativo: true },
          orderBy: [{ ordem: 'asc' }, { nome: 'asc' }],
          include: {
            itens: {
              where: { ativo: true, parentId: null },
              orderBy: [{ ordem: 'asc' }, { nome: 'asc' }],
              include: {
                subItens: {
                  where: { ativo: true },
                  orderBy: [{ ordem: 'asc' }, { nome: 'asc' }],
                },
              },
            },
          },
        },
      },
    })
    if (!modulo) return reply.status(404).send('Módulo não encontrado.')

    const usuario = await app.prisma.usuario.findUnique({
      where: { emailPrincipal: req.user.email },
      select: { id: true },
    })

    const relFav = {
      relatorioFixo: { select: { nome: true } },
      relatorioPersonalizado: { select: { nome: true } },
    }

    const [pastas, favoritosRaiz] = await (usuario
      ? Promise.all([
          app.prisma.pastaFavorito.findMany({
            where: { usuarioId: usuario.id, parentId: null },
            orderBy: [{ ordem: 'asc' }, { nome: 'asc' }],
            include: {
              favoritos: { include: relFav, orderBy: { ordem: 'asc' } },
              subPastas: {
                orderBy: [{ ordem: 'asc' }, { nome: 'asc' }],
                include: { favoritos: { include: relFav, orderBy: { ordem: 'asc' } } },
              },
            },
          }),
          app.prisma.favoritoRelatorio.findMany({
            where: { usuarioId: usuario.id, pastaId: null },
            include: relFav,
            orderBy: { ordem: 'asc' },
          }),
        ])
      : Promise.resolve([[], []]))

    return reply.view('funcionando/popup-modulo', {
      modulo,
      pastas,
      favoritosRaiz,
      semUsuario: !usuario,
    })
  })
}
