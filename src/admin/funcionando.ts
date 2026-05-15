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

    const [pastas, favoritosRaiz, favItemRows] = await (usuario
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
          app.prisma.favoritoItem.findMany({
            where: {
              usuarioId: usuario.id,
              item: { menu: { moduloId: modulo.id } },
            },
            select: {
              itemId: true,
              item: {
                select: {
                  id: true,
                  nome: true,
                  icone: true,
                  menu: { select: { nome: true } },
                },
              },
            },
            orderBy: { criadoEm: 'asc' },
          }),
        ])
      : Promise.resolve([[], [], []]))

    const favItemIds = favItemRows.map((f) => f.itemId)
    const favItens = favItemRows.map((f) => ({
      id: f.item.id,
      nome: f.item.nome,
      icone: f.item.icone,
      menuNome: f.item.menu.nome,
    }))

    return reply.view('funcionando/popup-modulo', {
      modulo,
      pastas,
      favoritosRaiz,
      favItemIds,
      favItens,
      semUsuario: !usuario,
    })
  })

  // Toggle favorito de item — retorna JSON { favoritado, itemId }
  app.post<{ Params: { itemId: string } }>('/favorito/:itemId/toggle', async (req, reply) => {
    const usuario = await app.prisma.usuario.findUnique({
      where: { emailPrincipal: req.user.email },
      select: { id: true },
    })
    if (!usuario) return reply.status(403).send({ erro: 'Usuário não vinculado a este sistema.' })

    const where = { usuarioId_itemId: { usuarioId: usuario.id, itemId: req.params.itemId } }
    const existing = await app.prisma.favoritoItem.findUnique({ where })

    if (existing) {
      await app.prisma.favoritoItem.delete({ where })
      return reply.send({ favoritado: false, itemId: req.params.itemId })
    }

    await app.prisma.favoritoItem.create({
      data: { usuarioId: usuario.id, itemId: req.params.itemId },
    })
    return reply.send({ favoritado: true, itemId: req.params.itemId })
  })
}
