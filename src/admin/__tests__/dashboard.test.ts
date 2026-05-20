import { describe, it, expect, beforeEach } from 'vitest'

import { criarApp } from '../../routes/__tests__/helpers/criarApp.js'
import { adminDashboardRoutes } from '../dashboard.js'
import type { FastifyInstance } from 'fastify'
import type { PrismaMock } from '../../services/__tests__/helpers/prisma-mock.js'

describe('adminDashboardRoutes', () => {
  let app: FastifyInstance
  let prisma: PrismaMock

  beforeEach(async () => {
    ({ app, prisma } = await criarApp({
      registrar: adminDashboardRoutes,
      comView: true,
      simularAdmin: { sub: 'admin1', email: 'admin@exemplo.com' },
    }))
  })

  it('GET / renderiza dashboard com totais e listas recentes', async () => {
    prisma.sistema.count.mockResolvedValue(3)
    prisma.modulo.count.mockResolvedValue(7)
    prisma.usuario.count.mockResolvedValue(12)
    prisma.itemFuncionalidade.count.mockResolvedValue(42)
    prisma.relatorioFixo.count.mockResolvedValue(5)
    prisma.sistema.findMany.mockResolvedValue([
      { id: 's1', nome: 'Sistema A', criadoEm: new Date() },
    ])
    prisma.usuario.findMany.mockResolvedValue([
      { id: 'u1', nomeCompleto: 'Maria', emailPrincipal: 'maria@x.com', criadoEm: new Date() },
    ])
    prisma.relatorioFixo.findMany.mockResolvedValue([
      { id: 'r1', nome: 'Relatório X', criadoEm: new Date(), sistema: { nome: 'Sistema A' } },
    ])

    const res = await app.inject({ method: 'GET', url: '/' })

    expect(res.statusCode).toBe(200)
    expect(prisma.sistema.count).toHaveBeenCalled()
    expect(prisma.modulo.count).toHaveBeenCalled()
    expect(prisma.usuario.count).toHaveBeenCalled()
    expect(prisma.itemFuncionalidade.count).toHaveBeenCalled()
    expect(prisma.relatorioFixo.count).toHaveBeenCalled()

    expect(prisma.sistema.findMany).toHaveBeenCalledWith({
      take: 5,
      orderBy: { criadoEm: 'desc' },
    })
    expect(prisma.usuario.findMany).toHaveBeenCalledWith({
      take: 5,
      orderBy: { criadoEm: 'desc' },
    })
    expect(prisma.relatorioFixo.findMany).toHaveBeenCalledWith({
      take: 5,
      orderBy: { criadoEm: 'desc' },
      include: { sistema: { select: { nome: true } } },
    })
  })

  it('GET / repassa email do admin autenticado para a view', async () => {
    prisma.sistema.count.mockResolvedValue(0)
    prisma.modulo.count.mockResolvedValue(0)
    prisma.usuario.count.mockResolvedValue(0)
    prisma.itemFuncionalidade.count.mockResolvedValue(0)
    prisma.relatorioFixo.count.mockResolvedValue(0)
    prisma.sistema.findMany.mockResolvedValue([])
    prisma.usuario.findMany.mockResolvedValue([])
    prisma.relatorioFixo.findMany.mockResolvedValue([])

    const res = await app.inject({ method: 'GET', url: '/' })

    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('admin@exemplo.com')
  })
})
