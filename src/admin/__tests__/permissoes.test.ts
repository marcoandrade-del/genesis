import { describe, it, expect, beforeEach, vi } from 'vitest'

const { listarPorUsuarioMock, concederMock, atualizarMock, revogarMock } = vi.hoisted(() => ({
  listarPorUsuarioMock: vi.fn(),
  concederMock: vi.fn(),
  atualizarMock: vi.fn(),
  revogarMock: vi.fn(),
}))

vi.mock('../../services/permissoes.js', () => ({
  PermissoesService: class {
    listarPorUsuario = listarPorUsuarioMock
    conceder = concederMock
    atualizar = atualizarMock
    revogar = revogarMock
  },
}))

import { criarApp } from '../../routes/__tests__/helpers/criarApp.js'
import { adminPermissoesRoutes } from '../permissoes.js'
import { ErroNegocio } from '../../errors.js'
import type { FastifyInstance } from 'fastify'
import type { PrismaMock } from '../../services/__tests__/helpers/prisma-mock.js'

const USUARIO = { id: 'u1', nomeCompleto: 'Maria', emailPrincipal: 'maria@x.com' }

function form(obj: Record<string, string>) {
  return {
    payload: new URLSearchParams(obj).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  }
}

describe('adminPermissoesRoutes', () => {
  let app: FastifyInstance
  let prisma: PrismaMock

  beforeEach(async () => {
    [listarPorUsuarioMock, concederMock, atualizarMock, revogarMock].forEach(m => m.mockReset())
    ;({ app, prisma } = await criarApp({
      registrar: adminPermissoesRoutes,
      comView: true,
      simularAdmin: { sub: 'admin1', email: 'admin@x.com' },
    }))
  })

  describe('GET /', () => {
    it('lista sem filtro quando sem busca', async () => {
      prisma.usuario.findMany.mockResolvedValue([])
      prisma.usuario.count.mockResolvedValue(0)
      const res = await app.inject({ method: 'GET', url: '/' })
      expect(res.statusCode).toBe(200)
      expect(prisma.usuario.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }))
    })

    it('aplica filtro OR quando há busca', async () => {
      prisma.usuario.findMany.mockResolvedValue([])
      prisma.usuario.count.mockResolvedValue(0)
      await app.inject({ method: 'GET', url: '/?busca=maria' })
      expect(prisma.usuario.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: {
          OR: [
            { nomeCompleto: { contains: 'maria', mode: 'insensitive' } },
            { emailPrincipal: { contains: 'maria', mode: 'insensitive' } },
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

    it('renderiza permissões do usuário', async () => {
      prisma.usuario.findUnique.mockResolvedValue(USUARIO)
      listarPorUsuarioMock.mockResolvedValue([])
      const res = await app.inject({ method: 'GET', url: '/u1/modal' })
      expect(res.statusCode).toBe(200)
      expect(listarPorUsuarioMock).toHaveBeenCalledWith('u1')
    })
  })

  describe('GET /:usuarioId/linhas', () => {
    it('renderiza apenas a partial de linhas', async () => {
      listarPorUsuarioMock.mockResolvedValue([])
      const res = await app.inject({ method: 'GET', url: '/u1/linhas' })
      expect(res.statusCode).toBe(200)
      expect(listarPorUsuarioMock).toHaveBeenCalledWith('u1')
    })
  })

  describe('GET /:usuarioId/form', () => {
    it('retorna 404 se usuário não existe', async () => {
      prisma.usuario.findUnique.mockResolvedValue(null)
      const res = await app.inject({ method: 'GET', url: '/u1/form' })
      expect(res.statusCode).toBe(404)
    })

    it('renderiza form de adição', async () => {
      prisma.usuario.findUnique.mockResolvedValue(USUARIO)
      const res = await app.inject({ method: 'GET', url: '/u1/form' })
      expect(res.statusCode).toBe(200)
    })
  })

  describe('POST /:usuarioId', () => {
    it('retorna 404 se usuário não existe', async () => {
      prisma.usuario.findUnique.mockResolvedValue(null)
      const res = await app.inject({
        method: 'POST', url: '/u1', ...form({ itemId: 'i1', nivel: 'VISUALIZAR' }),
      })
      expect(res.statusCode).toBe(404)
    })

    it('re-renderiza form com erro quando itemId vazio', async () => {
      prisma.usuario.findUnique.mockResolvedValue(USUARIO)
      const res = await app.inject({
        method: 'POST', url: '/u1', ...form({ itemId: '', nivel: 'VISUALIZAR' }),
      })
      expect(res.statusCode).toBe(200)
      expect(res.body).toMatch(/Selecione um item/)
      expect(concederMock).not.toHaveBeenCalled()
    })

    it('re-renderiza form com erro quando nivel vazio', async () => {
      prisma.usuario.findUnique.mockResolvedValue(USUARIO)
      const res = await app.inject({
        method: 'POST', url: '/u1', ...form({ itemId: 'i1', nivel: '' }),
      })
      expect(res.statusCode).toBe(200)
      expect(res.body).toMatch(/Selecione um nível/)
      expect(concederMock).not.toHaveBeenCalled()
    })

    it('concede permissão e re-renderiza modal', async () => {
      prisma.usuario.findUnique.mockResolvedValue(USUARIO)
      concederMock.mockResolvedValue(undefined)
      listarPorUsuarioMock.mockResolvedValue([])

      const res = await app.inject({
        method: 'POST', url: '/u1', ...form({ itemId: 'i1', nivel: 'EDITAR' }),
      })

      expect(res.statusCode).toBe(200)
      expect(concederMock).toHaveBeenCalledWith('u1', { itemId: 'i1', nivel: 'EDITAR' })
    })

    it('exibe mensagem de ErroNegocio quando service rejeita', async () => {
      prisma.usuario.findUnique.mockResolvedValue(USUARIO)
      concederMock.mockRejectedValue(new ErroNegocio('CONFLITO', 'Permissão já existe.'))

      const res = await app.inject({
        method: 'POST', url: '/u1', ...form({ itemId: 'i1', nivel: 'EDITAR' }),
      })

      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Permissão já existe.')
    })

    it('usa mensagem genérica para erro não-ErroNegocio', async () => {
      prisma.usuario.findUnique.mockResolvedValue(USUARIO)
      concederMock.mockRejectedValue(new Error('Falha interna.'))

      const res = await app.inject({
        method: 'POST', url: '/u1', ...form({ itemId: 'i1', nivel: 'EDITAR' }),
      })

      expect(res.body).toContain('Erro ao conceder permissão.')
    })
  })

  describe('PUT /perm/:id', () => {
    it('atualiza nível e re-renderiza linhas', async () => {
      atualizarMock.mockResolvedValue(undefined)
      listarPorUsuarioMock.mockResolvedValue([])

      const res = await app.inject({
        method: 'PUT', url: '/perm/p1', ...form({ nivel: 'TOTAL', usuarioId: 'u1' }),
      })

      expect(res.statusCode).toBe(200)
      expect(atualizarMock).toHaveBeenCalledWith('p1', 'TOTAL')
      expect(listarPorUsuarioMock).toHaveBeenCalledWith('u1')
    })

    it('retorna 400 quando falha', async () => {
      atualizarMock.mockRejectedValue(new Error('Inválido.'))
      const res = await app.inject({
        method: 'PUT', url: '/perm/p1', ...form({ nivel: 'X', usuarioId: 'u1' }),
      })
      expect(res.statusCode).toBe(400)
      expect(res.body).toBe('Inválido.')
    })
  })

  describe('DELETE /perm/:id', () => {
    it('revoga e re-renderiza linhas', async () => {
      revogarMock.mockResolvedValue(undefined)
      listarPorUsuarioMock.mockResolvedValue([])

      const res = await app.inject({ method: 'DELETE', url: '/perm/p1?usuarioId=u1' })

      expect(res.statusCode).toBe(200)
      expect(revogarMock).toHaveBeenCalledWith('p1')
    })

    it('retorna 400 quando falha', async () => {
      revogarMock.mockRejectedValue(new Error('Não pode revogar.'))
      const res = await app.inject({ method: 'DELETE', url: '/perm/p1?usuarioId=u1' })
      expect(res.statusCode).toBe(400)
      expect(res.body).toBe('Não pode revogar.')
    })
  })
})
