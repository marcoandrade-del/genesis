import { describe, it, expect, beforeEach } from 'vitest'

import { criarApp } from '../../routes/__tests__/helpers/criarApp.js'
import { adminLookupRoutes } from '../lookup.js'
import type { FastifyInstance } from 'fastify'
import type { PrismaMock } from '../../services/__tests__/helpers/prisma-mock.js'

describe('adminLookupRoutes', () => {
  let app: FastifyInstance
  let prisma: PrismaMock

  beforeEach(async () => {
    ({ app, prisma } = await criarApp({
      registrar: adminLookupRoutes,
      comView: true,
      simularAdmin: { sub: 'admin1', email: 'admin@x.com' },
    }))
  })

  describe('GET /usuarios', () => {
    it('sem query renderiza view completa, sem filtro where', async () => {
      prisma.usuario.findMany.mockResolvedValue([])

      const res = await app.inject({ method: 'GET', url: '/usuarios' })

      expect(res.statusCode).toBe(200)
      expect(prisma.usuario.findMany).toHaveBeenCalledWith(
        expect.not.objectContaining({ where: expect.anything() }),
      )
    })

    it('com q aplica filtro OR em nomeCompleto e emailPrincipal', async () => {
      prisma.usuario.findMany.mockResolvedValue([])

      await app.inject({ method: 'GET', url: '/usuarios?q=joao' })

      expect(prisma.usuario.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            OR: [
              { nomeCompleto: { contains: 'joao', mode: 'insensitive' } },
              { emailPrincipal: { contains: 'joao', mode: 'insensitive' } },
            ],
          },
          take: 50,
        }),
      )
    })

    it('HX-Target=lookup-rows-usuarios renderiza apenas a partial de linhas', async () => {
      prisma.usuario.findMany.mockResolvedValue([])

      const res = await app.inject({
        method: 'GET',
        url: '/usuarios?q=x',
        headers: { 'hx-target': 'lookup-rows-usuarios' },
      })

      expect(res.statusCode).toBe(200)
    })
  })

  describe('GET /sistemas', () => {
    it('sem query lista sem filtro', async () => {
      prisma.sistema.findMany.mockResolvedValue([])
      const res = await app.inject({ method: 'GET', url: '/sistemas' })
      expect(res.statusCode).toBe(200)
      expect(prisma.sistema.findMany).toHaveBeenCalledWith(
        expect.not.objectContaining({ where: expect.anything() }),
      )
    })

    it('com q filtra por nome', async () => {
      prisma.sistema.findMany.mockResolvedValue([])
      await app.inject({ method: 'GET', url: '/sistemas?q=erp' })
      expect(prisma.sistema.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { nome: { contains: 'erp', mode: 'insensitive' } },
        }),
      )
    })

    it('HX-Target renderiza partial', async () => {
      prisma.sistema.findMany.mockResolvedValue([])
      const res = await app.inject({
        method: 'GET',
        url: '/sistemas',
        headers: { 'hx-target': 'lookup-rows-sistemas' },
      })
      expect(res.statusCode).toBe(200)
    })
  })

  describe('GET /modulos', () => {
    it('com sistemaId filtra por sistema', async () => {
      prisma.modulo.findMany.mockResolvedValue([])
      await app.inject({ method: 'GET', url: '/modulos?sistemaId=s1' })
      expect(prisma.modulo.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { sistemaId: 's1' },
          include: { sistema: { select: { nome: true } } },
        }),
      )
    })

    it('com q e sistemaId combina ambos filtros', async () => {
      prisma.modulo.findMany.mockResolvedValue([])
      await app.inject({ method: 'GET', url: '/modulos?q=fin&sistemaId=s1' })
      expect(prisma.modulo.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { sistemaId: 's1', nome: { contains: 'fin', mode: 'insensitive' } },
        }),
      )
    })

    it('HX-Target renderiza partial', async () => {
      prisma.modulo.findMany.mockResolvedValue([])
      const res = await app.inject({
        method: 'GET',
        url: '/modulos',
        headers: { 'hx-target': 'lookup-rows-modulos' },
      })
      expect(res.statusCode).toBe(200)
    })
  })

  describe('GET /itens', () => {
    it('filtra por tipo=FUNCIONALIDADE e ativo=true', async () => {
      prisma.itemFuncionalidade.findMany.mockResolvedValue([])
      await app.inject({ method: 'GET', url: '/itens' })
      expect(prisma.itemFuncionalidade.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tipo: 'FUNCIONALIDADE', ativo: true },
        }),
      )
    })

    it('com q adiciona filtro de nome', async () => {
      prisma.itemFuncionalidade.findMany.mockResolvedValue([])
      await app.inject({ method: 'GET', url: '/itens?q=rel' })
      expect(prisma.itemFuncionalidade.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            tipo: 'FUNCIONALIDADE',
            ativo: true,
            nome: { contains: 'rel', mode: 'insensitive' },
          },
        }),
      )
    })

    it('HX-Target renderiza partial', async () => {
      prisma.itemFuncionalidade.findMany.mockResolvedValue([])
      const res = await app.inject({
        method: 'GET',
        url: '/itens',
        headers: { 'hx-target': 'lookup-rows-itens' },
      })
      expect(res.statusCode).toBe(200)
    })
  })
})
