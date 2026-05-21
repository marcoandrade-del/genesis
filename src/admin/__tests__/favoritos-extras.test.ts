import { describe, it, expect, beforeEach, vi } from 'vitest'

const { criarPastaMock, adicionarFavoritoMock, moverFavoritoMock, removerFavoritoMock, excluirPastaMock } = vi.hoisted(() => ({
  criarPastaMock: vi.fn(),
  adicionarFavoritoMock: vi.fn(),
  moverFavoritoMock: vi.fn(),
  removerFavoritoMock: vi.fn(),
  excluirPastaMock: vi.fn(),
}))

vi.mock('../../services/favoritos.js', () => ({
  FavoritosService: class {
    criarPasta = criarPastaMock
    adicionarFavorito = adicionarFavoritoMock
    moverFavorito = moverFavoritoMock
    removerFavorito = removerFavoritoMock
    excluirPasta = excluirPastaMock
  },
}))

import { criarApp } from '../../routes/__tests__/helpers/criarApp.js'
import { adminFavoritosRoutes } from '../favoritos.js'
import type { FastifyInstance } from 'fastify'
import type { PrismaMock } from '../../services/__tests__/helpers/prisma-mock.js'

const USUARIO = { id: 'u1', nomeCompleto: 'Maria', emailPrincipal: 'maria@x.com' }

function form(obj: Record<string, string>) {
  return {
    payload: new URLSearchParams(obj).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  }
}

describe('adminFavoritosRoutes — branches restantes', () => {
  let app: FastifyInstance
  let prisma: PrismaMock

  beforeEach(async () => {
    [criarPastaMock, adicionarFavoritoMock, moverFavoritoMock, removerFavoritoMock, excluirPastaMock]
      .forEach(m => m.mockReset())
    ;({ app, prisma } = await criarApp({
      registrar: adminFavoritosRoutes,
      comView: true,
      simularAdmin: { sub: 'admin1', email: 'admin@x.com' },
    }))
  })

  // Lines 9-11 + linha 10 if: aplanarPastas com pastas e subpastas
  it('POST /:usuarioId/pasta com sucesso aplana árvore com subpastas aninhadas', async () => {
    criarPastaMock.mockResolvedValue(undefined)
    prisma.usuario.findUnique.mockResolvedValue(USUARIO)
    prisma.pastaFavorito.findMany.mockResolvedValue([
      {
        id: 'p1', nome: 'Vendas',
        favoritos: [],
        subPastas: [
          { id: 'p1a', nome: 'Mensal', favoritos: [] },
        ],
      },
      {
        id: 'p2', nome: 'Estoque',
        favoritos: [],
        subPastas: [],
      },
    ])
    prisma.favoritoRelatorio.findMany.mockResolvedValue([])

    const res = await app.inject({
      method: 'POST', url: '/u1/pasta',
      ...form({ nome: 'Nova', parentId: '' }),
    })

    expect(res.statusCode).toBe(200)
    expect(criarPastaMock).toHaveBeenCalledWith('u1', { nome: 'Nova' })
  })

  // Line 146 — POST /pasta com erro não-Error
  it('POST /:usuarioId/pasta usa mensagem fallback quando criar lança valor não-Error', async () => {
    criarPastaMock.mockRejectedValue('string crua')
    prisma.usuario.findUnique.mockResolvedValue(USUARIO)
    prisma.pastaFavorito.findMany.mockResolvedValue([])

    const res = await app.inject({
      method: 'POST', url: '/u1/pasta',
      ...form({ nome: 'X' }),
    })

    expect(res.body).toContain('Erro ao criar pasta.')
  })

  // Line 179 — POST /add com erro não-Error
  it('POST /:usuarioId/add usa mensagem fallback quando adicionar lança valor não-Error', async () => {
    adicionarFavoritoMock.mockRejectedValue('string crua')
    prisma.usuario.findUnique.mockResolvedValue(USUARIO)
    prisma.relatorioFixo.findMany.mockResolvedValue([])
    prisma.relatorioPersonalizado.findMany.mockResolvedValue([])
    prisma.pastaFavorito.findMany.mockResolvedValue([])

    const res = await app.inject({
      method: 'POST', url: '/u1/add',
      ...form({ relatorioFixoId: 'rf1' }),
    })

    expect(res.body).toContain('Erro ao adicionar favorito.')
  })

  // Line 200 — PUT /fav/:id/mover com erro não-Error
  it('PUT /fav/:id/mover usa mensagem fallback quando mover lança valor não-Error', async () => {
    moverFavoritoMock.mockRejectedValue('string crua')
    const res = await app.inject({
      method: 'PUT', url: '/fav/f1/mover',
      ...form({ pastaId: '', usuarioId: 'u1' }),
    })
    expect(res.statusCode).toBe(400)
    expect(res.body).toBe('Erro ao mover favorito.')
  })

  // Line 217 — DELETE /fav/:id com erro não-Error
  it('DELETE /fav/:id usa mensagem fallback quando remover lança valor não-Error', async () => {
    removerFavoritoMock.mockRejectedValue('string crua')
    const res = await app.inject({ method: 'DELETE', url: '/fav/f1?usuarioId=u1' })
    expect(res.statusCode).toBe(400)
    expect(res.body).toBe('Erro ao remover favorito.')
  })

  // Line 234 — DELETE /pasta/:id com erro não-Error
  it('DELETE /pasta/:id usa mensagem fallback quando excluir lança valor não-Error', async () => {
    excluirPastaMock.mockRejectedValue('string crua')
    const res = await app.inject({ method: 'DELETE', url: '/pasta/p1?usuarioId=u1' })
    expect(res.statusCode).toBe(400)
    expect(res.body).toBe('Erro ao excluir pasta.')
  })
})
