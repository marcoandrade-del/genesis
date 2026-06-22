import type { FastifyInstance } from 'fastify'
import { FavoritosAppService } from '../services/favoritos-app.js'

/**
 * Toggle de favorito da barra do `/app`. Só permite favoritar itens aos quais o
 * usuário tem `PermissaoAcesso` ativa — mantém a barra coerente com o menu.
 */
export async function appFavoritosRoutes(app: FastifyInstance) {
  app.post<{ Params: { itemId: string } }>('/favoritos/:itemId/toggle', async (req, reply) => {
    const { itemId } = req.params

    const permitido = await app.prisma.permissaoAcesso.findFirst({
      where: { usuarioId: req.user.sub, itemId, ativo: true },
      select: { id: true },
    })
    if (!permitido) return reply.status(403).send({ erro: 'Sem permissão para este item.' })

    const favoritos = new FavoritosAppService(app.prisma)
    const favoritado = await favoritos.toggle(req.user.sub, itemId)
    return reply.send({ favoritado, itemId })
  })
}
