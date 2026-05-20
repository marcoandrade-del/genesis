import { describe, it, expect, beforeEach } from 'vitest'

import { criarApp } from '../../routes/__tests__/helpers/criarApp.js'
import { adminFuncionandoRoutes } from '../funcionando.js'
import type { FastifyInstance } from 'fastify'
import type { PrismaMock } from '../../services/__tests__/helpers/prisma-mock.js'

const ADMIN_EMAIL = 'admin@x.com'

const MODULO = {
  id: 'm1',
  nome: 'Financeiro',
  sistemaId: 's1',
  sistema: { nome: 'ERP' },
  menus: [],
}

describe('adminFuncionandoRoutes', () => {
  let app: FastifyInstance
  let prisma: PrismaMock

  beforeEach(async () => {
    ({ app, prisma } = await criarApp({
      registrar: adminFuncionandoRoutes,
      comView: true,
      simularAdmin: { sub: 'admin1', email: ADMIN_EMAIL },
    }))
  })

  describe('GET /', () => {
    it('lista sistemas ativos com seus módulos ativos', async () => {
      prisma.sistema.findMany.mockResolvedValue([])

      const res = await app.inject({ method: 'GET', url: '/' })

      expect(res.statusCode).toBe(200)
      expect(prisma.sistema.findMany).toHaveBeenCalledWith({
        where: { ativo: true },
        orderBy: { nome: 'asc' },
        include: {
          modulos: {
            where: { ativo: true },
            orderBy: [{ ordem: 'asc' }, { nome: 'asc' }],
          },
        },
      })
    })
  })

  describe('GET /modulo/:moduloId', () => {
    it('retorna 404 quando módulo não existe', async () => {
      prisma.modulo.findUnique.mockResolvedValue(null)
      const res = await app.inject({ method: 'GET', url: '/modulo/m1' })
      expect(res.statusCode).toBe(404)
      expect(res.body).toBe('Módulo não encontrado.')
    })

    it('renderiza popup com favoritos quando usuário existe', async () => {
      prisma.modulo.findUnique.mockResolvedValue(MODULO)
      prisma.usuario.findUnique.mockResolvedValue({ id: 'u1' })
      prisma.pastaFavorito.findMany.mockResolvedValue([])
      prisma.favoritoRelatorio.findMany.mockResolvedValue([])
      prisma.favoritoItem.findMany.mockResolvedValue([
        {
          itemId: 'i1',
          item: {
            id: 'i1', nome: 'Item A', icone: null,
            menu: { nome: 'M', modulo: { nome: 'Mod' } },
          },
        },
      ])

      const res = await app.inject({ method: 'GET', url: '/modulo/m1' })

      expect(res.statusCode).toBe(200)
      expect(prisma.favoritoItem.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({
          usuarioId: 'u1',
          item: { menu: { modulo: { sistemaId: 's1' } } },
        }),
      }))
    })

    it('renderiza popup com semUsuario=true quando admin não tem registro de Usuario', async () => {
      prisma.modulo.findUnique.mockResolvedValue(MODULO)
      prisma.usuario.findUnique.mockResolvedValue(null)

      const res = await app.inject({ method: 'GET', url: '/modulo/m1' })

      expect(res.statusCode).toBe(200)
      // não chama findMany de favoritos quando não há usuário
      expect(prisma.pastaFavorito.findMany).not.toHaveBeenCalled()
      expect(prisma.favoritoRelatorio.findMany).not.toHaveBeenCalled()
      expect(prisma.favoritoItem.findMany).not.toHaveBeenCalled()
    })
  })

  describe('POST /favorito/:itemId/toggle', () => {
    it('retorna 403 quando usuário não existe', async () => {
      prisma.usuario.findUnique.mockResolvedValue(null)
      const res = await app.inject({ method: 'POST', url: '/favorito/i1/toggle' })
      expect(res.statusCode).toBe(403)
      expect(res.json()).toEqual({ erro: 'Usuário não vinculado a este sistema.' })
    })

    it('cria favorito quando não existe (toggle on)', async () => {
      prisma.usuario.findUnique.mockResolvedValue({ id: 'u1' })
      prisma.favoritoItem.findUnique.mockResolvedValue(null)
      prisma.favoritoItem.create.mockResolvedValue({ id: 'f1' })

      const res = await app.inject({ method: 'POST', url: '/favorito/i1/toggle' })

      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({ favoritado: true, itemId: 'i1' })
      expect(prisma.favoritoItem.create).toHaveBeenCalledWith({
        data: { usuarioId: 'u1', itemId: 'i1' },
      })
      expect(prisma.favoritoItem.delete).not.toHaveBeenCalled()
    })

    it('remove favorito quando já existe (toggle off)', async () => {
      prisma.usuario.findUnique.mockResolvedValue({ id: 'u1' })
      prisma.favoritoItem.findUnique.mockResolvedValue({ id: 'f1' })
      prisma.favoritoItem.delete.mockResolvedValue({ id: 'f1' })

      const res = await app.inject({ method: 'POST', url: '/favorito/i1/toggle' })

      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({ favoritado: false, itemId: 'i1' })
      expect(prisma.favoritoItem.delete).toHaveBeenCalledWith({
        where: { usuarioId_itemId: { usuarioId: 'u1', itemId: 'i1' } },
      })
      expect(prisma.favoritoItem.create).not.toHaveBeenCalled()
    })
  })
})
