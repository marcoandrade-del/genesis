import { describe, it, expect, beforeEach } from 'vitest'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'
import { FavoritosAppService } from '../favoritos-app.js'

describe('FavoritosAppService', () => {
  let prisma: PrismaMock
  let service: FavoritosAppService

  beforeEach(() => {
    prisma = criarPrismaMock()
    service = new FavoritosAppService(prisma as never)
  })

  describe('idsFavoritos', () => {
    it('devolve um Set com os itemIds favoritados do usuário', async () => {
      prisma.favoritoItem.findMany.mockResolvedValue([{ itemId: 'a' }, { itemId: 'b' }])
      const ids = await service.idsFavoritos('u1')
      expect(ids).toBeInstanceOf(Set)
      expect([...ids]).toEqual(['a', 'b'])
      expect(prisma.favoritoItem.findMany).toHaveBeenCalledWith({
        where: { usuarioId: 'u1' },
        select: { itemId: true },
      })
    })

    it('devolve Set vazio quando não há favoritos', async () => {
      prisma.favoritoItem.findMany.mockResolvedValue([])
      expect((await service.idsFavoritos('u1')).size).toBe(0)
    })
  })

  describe('toggle', () => {
    it('cria o favorito quando não existe e devolve true', async () => {
      prisma.favoritoItem.findUnique.mockResolvedValue(null)
      const r = await service.toggle('u1', 'it1')
      expect(r).toBe(true)
      expect(prisma.favoritoItem.create).toHaveBeenCalledWith({
        data: { usuarioId: 'u1', itemId: 'it1' },
      })
      expect(prisma.favoritoItem.delete).not.toHaveBeenCalled()
    })

    it('remove o favorito quando já existe e devolve false', async () => {
      prisma.favoritoItem.findUnique.mockResolvedValue({ id: 'f1' })
      const r = await service.toggle('u1', 'it1')
      expect(r).toBe(false)
      expect(prisma.favoritoItem.delete).toHaveBeenCalledWith({
        where: { usuarioId_itemId: { usuarioId: 'u1', itemId: 'it1' } },
      })
      expect(prisma.favoritoItem.create).not.toHaveBeenCalled()
    })
  })
})
