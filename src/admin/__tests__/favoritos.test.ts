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

function mockArvoreVazia(prisma: PrismaMock) {
  prisma.pastaFavorito.findMany.mockResolvedValue([])
  prisma.favoritoRelatorio.findMany.mockResolvedValue([])
}

describe('adminFavoritosRoutes', () => {
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

  describe('GET /', () => {
    it('lista usuários sem filtro quando sem busca', async () => {
      prisma.usuario.findMany.mockResolvedValue([])
      prisma.usuario.count.mockResolvedValue(0)

      const res = await app.inject({ method: 'GET', url: '/' })

      expect(res.statusCode).toBe(200)
      expect(prisma.usuario.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }))
    })

    it('aplica filtro OR quando há busca', async () => {
      prisma.usuario.findMany.mockResolvedValue([])
      prisma.usuario.count.mockResolvedValue(0)

      await app.inject({ method: 'GET', url: '/?busca=joao' })

      expect(prisma.usuario.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: {
          OR: [
            { nomeCompleto: { contains: 'joao', mode: 'insensitive' } },
            { emailPrincipal: { contains: 'joao', mode: 'insensitive' } },
          ],
        },
      }))
    })
  })

  describe('GET /:usuarioId/modal', () => {
    it('retorna 404 se usuário não existe', async () => {
      prisma.usuario.findUnique.mockResolvedValue(null)
      const res = await app.inject({ method: 'GET', url: '/u1/modal' })
      expect(res.statusCode).toBe(404)
    })

    it('renderiza árvore quando usuário existe', async () => {
      prisma.usuario.findUnique.mockResolvedValue(USUARIO)
      mockArvoreVazia(prisma)
      const res = await app.inject({ method: 'GET', url: '/u1/modal' })
      expect(res.statusCode).toBe(200)
    })
  })

  describe('GET /:usuarioId/form-pasta', () => {
    it('retorna 404 se usuário não existe', async () => {
      prisma.usuario.findUnique.mockResolvedValue(null)
      const res = await app.inject({ method: 'GET', url: '/u1/form-pasta' })
      expect(res.statusCode).toBe(404)
    })

    it('renderiza form com pastas disponíveis', async () => {
      prisma.usuario.findUnique.mockResolvedValue(USUARIO)
      prisma.pastaFavorito.findMany.mockResolvedValue([])
      const res = await app.inject({ method: 'GET', url: '/u1/form-pasta' })
      expect(res.statusCode).toBe(200)
    })
  })

  describe('GET /:usuarioId/form-favorito', () => {
    it('retorna 404 se usuário não existe', async () => {
      prisma.usuario.findUnique.mockResolvedValue(null)
      const res = await app.inject({ method: 'GET', url: '/u1/form-favorito' })
      expect(res.statusCode).toBe(404)
    })

    it('renderiza form com relatórios e pastas', async () => {
      prisma.usuario.findUnique.mockResolvedValue(USUARIO)
      prisma.relatorioFixo.findMany.mockResolvedValue([])
      prisma.relatorioPersonalizado.findMany.mockResolvedValue([])
      prisma.pastaFavorito.findMany.mockResolvedValue([])
      const res = await app.inject({ method: 'GET', url: '/u1/form-favorito' })
      expect(res.statusCode).toBe(200)
    })
  })

  describe('POST /:usuarioId/pasta', () => {
    it('retorna 404 se usuário não existe', async () => {
      prisma.usuario.findUnique.mockResolvedValue(null)
      const res = await app.inject({ method: 'POST', url: '/u1/pasta', ...form({ nome: 'Minha' }) })
      expect(res.statusCode).toBe(404)
    })

    it('re-renderiza form com erro quando nome vazio', async () => {
      prisma.usuario.findUnique.mockResolvedValue(USUARIO)
      prisma.pastaFavorito.findMany.mockResolvedValue([])

      const res = await app.inject({ method: 'POST', url: '/u1/pasta', ...form({ nome: '   ' }) })

      expect(res.statusCode).toBe(200)
      expect(res.body).toMatch(/obrigatóri/i)
      expect(criarPastaMock).not.toHaveBeenCalled()
    })

    it('cria pasta e re-renderiza modal em caso de sucesso', async () => {
      prisma.usuario.findUnique.mockResolvedValue(USUARIO)
      criarPastaMock.mockResolvedValue(undefined)
      mockArvoreVazia(prisma)

      const res = await app.inject({ method: 'POST', url: '/u1/pasta', ...form({ nome: 'Minha pasta', parentId: 'p1' }) })

      expect(res.statusCode).toBe(200)
      expect(criarPastaMock).toHaveBeenCalledWith('u1', { nome: 'Minha pasta', parentId: 'p1' })
    })

    it('omite parentId quando não fornecido', async () => {
      prisma.usuario.findUnique.mockResolvedValue(USUARIO)
      criarPastaMock.mockResolvedValue(undefined)
      mockArvoreVazia(prisma)

      await app.inject({ method: 'POST', url: '/u1/pasta', ...form({ nome: 'Raiz' }) })

      expect(criarPastaMock).toHaveBeenCalledWith('u1', { nome: 'Raiz' })
    })

    it('renderiza form com erro quando service falha', async () => {
      prisma.usuario.findUnique.mockResolvedValue(USUARIO)
      prisma.pastaFavorito.findMany.mockResolvedValue([])
      criarPastaMock.mockRejectedValue(new Error('Nome duplicado.'))

      const res = await app.inject({ method: 'POST', url: '/u1/pasta', ...form({ nome: 'X' }) })

      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Nome duplicado.')
    })
  })

  describe('POST /:usuarioId/add', () => {
    it('retorna 404 se usuário não existe', async () => {
      prisma.usuario.findUnique.mockResolvedValue(null)
      const res = await app.inject({ method: 'POST', url: '/u1/add', ...form({ relatorioFixoId: 'r1' }) })
      expect(res.statusCode).toBe(404)
    })

    it('re-renderiza form com erro quando nenhum relatório selecionado', async () => {
      prisma.usuario.findUnique.mockResolvedValue(USUARIO)
      prisma.relatorioFixo.findMany.mockResolvedValue([])
      prisma.relatorioPersonalizado.findMany.mockResolvedValue([])
      prisma.pastaFavorito.findMany.mockResolvedValue([])

      const res = await app.inject({ method: 'POST', url: '/u1/add', ...form({}) })

      expect(res.statusCode).toBe(200)
      expect(res.body).toMatch(/Selecione/i)
      expect(adicionarFavoritoMock).not.toHaveBeenCalled()
    })

    it('adiciona favorito fixo e re-renderiza modal', async () => {
      prisma.usuario.findUnique.mockResolvedValue(USUARIO)
      adicionarFavoritoMock.mockResolvedValue(undefined)
      mockArvoreVazia(prisma)

      await app.inject({ method: 'POST', url: '/u1/add', ...form({ relatorioFixoId: 'r1', pastaId: 'p1' }) })

      expect(adicionarFavoritoMock).toHaveBeenCalledWith('u1', { relatorioFixoId: 'r1', pastaId: 'p1' })
    })

    it('adiciona favorito personalizado sem pasta', async () => {
      prisma.usuario.findUnique.mockResolvedValue(USUARIO)
      adicionarFavoritoMock.mockResolvedValue(undefined)
      mockArvoreVazia(prisma)

      await app.inject({ method: 'POST', url: '/u1/add', ...form({ relatorioPersonalizadoId: 'rp1' }) })

      expect(adicionarFavoritoMock).toHaveBeenCalledWith('u1', { relatorioPersonalizadoId: 'rp1' })
    })

    it('renderiza form com erro quando service falha', async () => {
      prisma.usuario.findUnique.mockResolvedValue(USUARIO)
      prisma.relatorioFixo.findMany.mockResolvedValue([])
      prisma.relatorioPersonalizado.findMany.mockResolvedValue([])
      prisma.pastaFavorito.findMany.mockResolvedValue([])
      adicionarFavoritoMock.mockRejectedValue(new Error('Já existe.'))

      const res = await app.inject({ method: 'POST', url: '/u1/add', ...form({ relatorioFixoId: 'r1' }) })

      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Já existe.')
    })
  })

  describe('PUT /fav/:id/mover', () => {
    it('move favorito e re-renderiza modal', async () => {
      moverFavoritoMock.mockResolvedValue(undefined)
      prisma.usuario.findUnique.mockResolvedValue(USUARIO)
      mockArvoreVazia(prisma)

      const res = await app.inject({ method: 'PUT', url: '/fav/f1/mover', ...form({ pastaId: 'p1', usuarioId: 'u1' }) })

      expect(res.statusCode).toBe(200)
      expect(moverFavoritoMock).toHaveBeenCalledWith('f1', { pastaId: 'p1' })
    })

    it('move para raiz (pastaId vazio → null)', async () => {
      moverFavoritoMock.mockResolvedValue(undefined)
      prisma.usuario.findUnique.mockResolvedValue(USUARIO)
      mockArvoreVazia(prisma)

      await app.inject({ method: 'PUT', url: '/fav/f1/mover', ...form({ pastaId: '', usuarioId: 'u1' }) })

      expect(moverFavoritoMock).toHaveBeenCalledWith('f1', { pastaId: null })
    })

    it('retorna 400 quando service falha', async () => {
      moverFavoritoMock.mockRejectedValue(new Error('Pasta inexistente.'))
      const res = await app.inject({ method: 'PUT', url: '/fav/f1/mover', ...form({ pastaId: 'p1', usuarioId: 'u1' }) })
      expect(res.statusCode).toBe(400)
      expect(res.body).toBe('Pasta inexistente.')
    })
  })

  describe('DELETE /fav/:id', () => {
    it('remove favorito e re-renderiza modal', async () => {
      removerFavoritoMock.mockResolvedValue(undefined)
      prisma.usuario.findUnique.mockResolvedValue(USUARIO)
      mockArvoreVazia(prisma)

      const res = await app.inject({ method: 'DELETE', url: '/fav/f1?usuarioId=u1' })

      expect(res.statusCode).toBe(200)
      expect(removerFavoritoMock).toHaveBeenCalledWith('f1')
    })

    it('retorna 400 quando service falha', async () => {
      removerFavoritoMock.mockRejectedValue(new Error('Não encontrado.'))
      const res = await app.inject({ method: 'DELETE', url: '/fav/f1?usuarioId=u1' })
      expect(res.statusCode).toBe(400)
      expect(res.body).toBe('Não encontrado.')
    })
  })

  describe('DELETE /pasta/:id', () => {
    it('exclui pasta e re-renderiza modal', async () => {
      excluirPastaMock.mockResolvedValue(undefined)
      prisma.usuario.findUnique.mockResolvedValue(USUARIO)
      mockArvoreVazia(prisma)

      const res = await app.inject({ method: 'DELETE', url: '/pasta/p1?usuarioId=u1' })

      expect(res.statusCode).toBe(200)
      expect(excluirPastaMock).toHaveBeenCalledWith('p1')
    })

    it('retorna 400 quando service falha', async () => {
      excluirPastaMock.mockRejectedValue(new Error('Pasta tem subitens.'))
      const res = await app.inject({ method: 'DELETE', url: '/pasta/p1?usuarioId=u1' })
      expect(res.statusCode).toBe(400)
      expect(res.body).toBe('Pasta tem subitens.')
    })
  })
})
