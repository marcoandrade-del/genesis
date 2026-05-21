import { describe, it, expect, beforeEach } from 'vitest'
import { FavoritosService } from '../favoritos.js'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'

const USUARIO = { id: 'u1', ativo: true }
const PASTA = { id: 'p1', nome: 'Trabalho', usuarioId: 'u1', parentId: null }
const REL_PERS = { id: 'rp1', nome: 'Meu Rel', usuarioId: 'u1' }

describe('FavoritosService — branches restantes', () => {
  let prisma: PrismaMock
  let service: FavoritosService

  beforeEach(() => {
    prisma = criarPrismaMock()
    service = new FavoritosService(prisma as never)
  })

  // Line 68 — listarFavoritos lança quando usuário não existe
  it('listarFavoritos lança RECURSO_NAO_ENCONTRADO quando usuário não existe', async () => {
    prisma.usuario.findUnique.mockResolvedValue(null)
    await expect(service.listarFavoritos('u-inexistente'))
      .rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
  })

  // Line 113 — adicionarFavorito com relatorioPersonalizado novo (jaExiste null)
  it('adicionarFavorito cria favorito de relatório personalizado quando ainda não existe', async () => {
    prisma.usuario.findUnique.mockResolvedValue(USUARIO)
    prisma.relatorioPersonalizado.findUnique.mockResolvedValue(REL_PERS)
    prisma.favoritoRelatorio.findFirst.mockResolvedValue(null)
    prisma.favoritoRelatorio.create.mockResolvedValue({
      id: 'fav2', usuarioId: 'u1', relatorioPersonalizadoId: 'rp1', pastaId: null, ordem: 0,
    })

    const resultado = await service.adicionarFavorito('u1', { relatorioPersonalizadoId: 'rp1' })

    expect(resultado.relatorioPersonalizadoId).toBe('rp1')
    expect(prisma.favoritoRelatorio.create).toHaveBeenCalled()
  })

  // Line 119 — adicionarFavorito com pastaId do mesmo usuário (passa na validação)
  it('adicionarFavorito aceita pastaId quando pasta pertence ao mesmo usuário', async () => {
    prisma.usuario.findUnique.mockResolvedValue(USUARIO)
    prisma.relatorioPersonalizado.findUnique.mockResolvedValue(REL_PERS)
    prisma.favoritoRelatorio.findFirst.mockResolvedValue(null)
    prisma.pastaFavorito.findUnique.mockResolvedValue(PASTA)
    prisma.favoritoRelatorio.create.mockResolvedValue({
      id: 'fav3', usuarioId: 'u1', relatorioPersonalizadoId: 'rp1', pastaId: 'p1', ordem: 0,
    })

    const resultado = await service.adicionarFavorito('u1', {
      relatorioPersonalizadoId: 'rp1',
      pastaId: 'p1',
    })

    expect(resultado.pastaId).toBe('p1')
  })
})
