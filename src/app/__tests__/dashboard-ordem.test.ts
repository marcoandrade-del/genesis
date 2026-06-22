import { describe, it, expect, beforeEach, vi } from 'vitest'

const m = vi.hoisted(() => ({ definir: vi.fn(), restaurar: vi.fn(), ordemDe: vi.fn(), arvore: vi.fn() }))
vi.mock('../../services/ordem-dashboard.js', () => ({
  OrdemDashboardService: class {
    definir = m.definir
    restaurar = m.restaurar
    ordemDe = m.ordemDe
  },
  aplicarOrdemRaizes: (r: unknown) => r,
}))
vi.mock('../../services/menu-app.js', () => ({
  MenuAppService: class {
    arvorePermitida = m.arvore
  },
}))

import { criarApp } from '../../routes/__tests__/helpers/criarApp.js'
import { appDashboardRoutes } from '../dashboard.js'
import type { FastifyInstance } from 'fastify'

const POST = (body: unknown) => ({
  method: 'POST' as const,
  url: '/dashboard/ordem',
  payload: JSON.stringify(body),
  headers: { 'content-type': 'application/json' },
})

async function montar() {
  return criarApp({
    registrar: appDashboardRoutes,
    simularUsuario: { sub: 'u1', email: 'u@x.com' },
    simularContexto: { entidadeId: 'ent1', ano: 2026, nivel: 'ESCRITA' as const },
  })
}

describe('POST /dashboard/ordem', () => {
  let app: FastifyInstance
  beforeEach(async () => {
    m.definir.mockReset().mockResolvedValue(undefined)
    m.restaurar.mockReset().mockResolvedValue(undefined)
    m.arvore.mockReset().mockResolvedValue([{ id: 'a' }, { id: 'b' }, { id: 'c' }])
    ;({ app } = await montar())
  })

  it('salva apenas os ids que o usuário enxerga, na ordem enviada', async () => {
    const res = await app.inject(POST({ itens: ['c', 'a', 'INTRUSO', 'b'] }))
    expect(res.statusCode).toBe(200)
    expect(m.definir).toHaveBeenCalledWith('u1', ['c', 'a', 'b']) // INTRUSO filtrado
    expect(res.json()).toEqual({ ok: true, itens: ['c', 'a', 'b'] })
  })

  it('reset apaga a preferência e não chama definir', async () => {
    const res = await app.inject(POST({ reset: true }))
    expect(res.statusCode).toBe(200)
    expect(m.restaurar).toHaveBeenCalledWith('u1')
    expect(m.definir).not.toHaveBeenCalled()
    expect(res.json()).toEqual({ ok: true, restaurado: true })
  })

  it('corpo sem itens salva lista vazia (limpa a ordem)', async () => {
    const res = await app.inject(POST({}))
    expect(res.statusCode).toBe(200)
    expect(m.definir).toHaveBeenCalledWith('u1', [])
  })
})
