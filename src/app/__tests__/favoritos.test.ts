import { describe, it, expect, beforeEach, vi } from 'vitest'

const m = vi.hoisted(() => ({ toggle: vi.fn() }))
vi.mock('../../services/favoritos-app.js', () => ({
  FavoritosAppService: class {
    toggle = m.toggle
  },
}))

import { criarApp } from '../../routes/__tests__/helpers/criarApp.js'
import { appFavoritosRoutes } from '../favoritos.js'
import type { FastifyInstance } from 'fastify'
import type { PrismaMock } from '../../services/__tests__/helpers/prisma-mock.js'

async function montar() {
  return criarApp({
    registrar: appFavoritosRoutes,
    simularUsuario: { sub: 'u1', email: 'u@x.com' },
    simularContexto: { entidadeId: 'ent1', ano: 2026, nivel: 'ESCRITA' as const },
  })
}

describe('appFavoritosRoutes', () => {
  let app: FastifyInstance
  let prisma: PrismaMock
  beforeEach(async () => {
    m.toggle.mockReset().mockResolvedValue(true)
    ;({ app, prisma } = await montar())
  })

  it('favorita um item permitido e devolve o novo estado', async () => {
    prisma.permissaoAcesso.findFirst.mockResolvedValue({ id: 'p1' })
    const res = await app.inject({ method: 'POST', url: '/favoritos/it1/toggle' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ favoritado: true, itemId: 'it1' })
    expect(m.toggle).toHaveBeenCalledWith('u1', 'it1')
  })

  it('reflete a remoção quando o toggle devolve false', async () => {
    prisma.permissaoAcesso.findFirst.mockResolvedValue({ id: 'p1' })
    m.toggle.mockResolvedValue(false)
    const res = await app.inject({ method: 'POST', url: '/favoritos/it1/toggle' })
    expect(res.json()).toEqual({ favoritado: false, itemId: 'it1' })
  })

  it('recusa item sem permissão ativa (403) e não chama o toggle', async () => {
    prisma.permissaoAcesso.findFirst.mockResolvedValue(null)
    const res = await app.inject({ method: 'POST', url: '/favoritos/it1/toggle' })
    expect(res.statusCode).toBe(403)
    expect(m.toggle).not.toHaveBeenCalled()
  })
})
