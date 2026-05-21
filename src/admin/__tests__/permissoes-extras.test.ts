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
import type { FastifyInstance } from 'fastify'

function form(obj: Record<string, string>) {
  return {
    payload: new URLSearchParams(obj).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  }
}

describe('adminPermissoesRoutes — branches restantes', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    [listarPorUsuarioMock, concederMock, atualizarMock, revogarMock].forEach(m => m.mockReset())
    ;({ app } = await criarApp({
      registrar: adminPermissoesRoutes,
      comView: true,
      simularAdmin: { sub: 'admin1', email: 'admin@x.com' },
    }))
  })

  // Line 98 — PUT /perm/:id com erro não-Error
  it('PUT /perm/:id usa mensagem fallback quando atualizar lança valor não-Error', async () => {
    atualizarMock.mockRejectedValue('string crua')
    const res = await app.inject({
      method: 'PUT', url: '/perm/p1',
      ...form({ nivel: 'EDITOR', usuarioId: 'u1' }),
    })
    expect(res.statusCode).toBe(400)
    expect(res.body).toBe('Erro ao atualizar permissão.')
  })

  // Line 114 — DELETE /perm/:id com erro não-Error
  it('DELETE /perm/:id usa mensagem fallback quando revogar lança valor não-Error', async () => {
    revogarMock.mockRejectedValue('string crua')
    const res = await app.inject({ method: 'DELETE', url: '/perm/p1?usuarioId=u1' })
    expect(res.statusCode).toBe(400)
    expect(res.body).toBe('Erro ao revogar permissão.')
  })
})
