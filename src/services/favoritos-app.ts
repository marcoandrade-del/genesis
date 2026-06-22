import type { PrismaClient } from '@prisma/client'

/**
 * Favoritos do operador no `/app`: cada usuário marca itens de funcionalidade
 * (telas do menu dinâmico) como favoritos, que aparecem numa barra fixa no topo
 * — estilo "barra de favoritos" do navegador. Reusa o modelo `FavoritoItem`.
 */
export class FavoritosAppService {
  constructor(private prisma: PrismaClient) {}

  /** Ids dos `ItemFuncionalidade` favoritados pelo usuário. */
  async idsFavoritos(usuarioId: string): Promise<Set<string>> {
    const favs = await this.prisma.favoritoItem.findMany({
      where: { usuarioId },
      select: { itemId: true },
    })
    return new Set(favs.map((f) => f.itemId))
  }

  /**
   * Alterna o favorito (cria/remove) e devolve o novo estado.
   * O chamador é responsável por validar que o usuário enxerga o item.
   */
  async toggle(usuarioId: string, itemId: string): Promise<boolean> {
    const where = { usuarioId_itemId: { usuarioId, itemId } }
    const existente = await this.prisma.favoritoItem.findUnique({ where })
    if (existente) {
      await this.prisma.favoritoItem.delete({ where })
      return false
    }
    await this.prisma.favoritoItem.create({ data: { usuarioId, itemId } })
    return true
  }
}
