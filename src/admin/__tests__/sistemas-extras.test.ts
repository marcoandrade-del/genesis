import { describe, it, expect, beforeEach, vi } from 'vitest'

const { buscarComAdminsMock, criarMock, atualizarMock, trocarAdminMock, excluirMock } = vi.hoisted(() => ({
  buscarComAdminsMock: vi.fn(),
  criarMock: vi.fn(),
  atualizarMock: vi.fn(),
  trocarAdminMock: vi.fn(),
  excluirMock: vi.fn(),
}))

vi.mock('../../services/sistemas.js', () => ({
  SistemasService: class {
    buscarComAdmins = buscarComAdminsMock
    criar = criarMock
    atualizar = atualizarMock
    trocarAdmin = trocarAdminMock
    excluir = excluirMock
  },
}))
vi.mock('../../services/lixeira.js', () => ({ LixeiraService: class {} }))

import { criarApp } from '../../routes/__tests__/helpers/criarApp.js'
import { adminSistemasRoutes } from '../sistemas.js'
import type { FastifyInstance } from 'fastify'
import type { PrismaMock } from '../../services/__tests__/helpers/prisma-mock.js'

const SISTEMA_SEM_ADMINS = {
  id: 's1', nome: 'ERP', descricao: '', ativo: true, admins: [],
}

function form(obj: Record<string, string>) {
  return {
    payload: new URLSearchParams(obj).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  }
}

describe('adminSistemasRoutes — branches restantes', () => {
  let app: FastifyInstance
  let prisma: PrismaMock

  beforeEach(async () => {
    [buscarComAdminsMock, criarMock, atualizarMock, trocarAdminMock, excluirMock].forEach(m => m.mockReset())
    ;({ app, prisma } = await criarApp({
      registrar: adminSistemasRoutes,
      comView: true,
      simularAdmin: { sub: 'admin1', email: 'admin@x.com' },
    }))
  })

  // Line 64 — POST / com erro não-Error
  it('POST / usa mensagem fallback quando criar lança valor não-Error', async () => {
    prisma.usuario.findUnique.mockResolvedValue({ id: 'admin1', nomeCompleto: 'Admin' })
    criarMock.mockRejectedValue('string crua')
    const res = await app.inject({
      method: 'POST', url: '/',
      ...form({ nome: 'X', descricao: '', adminUsuarioId: 'u1' }),
    })
    expect(res.body).toContain('Erro ao criar sistema.')
  })

  // Line 77 — PUT com nome vazio e sistema sem admins
  it('PUT /:id com nome vazio renderiza form mesmo sem admins no sistema', async () => {
    buscarComAdminsMock.mockResolvedValue(SISTEMA_SEM_ADMINS)
    const res = await app.inject({
      method: 'PUT', url: '/s1',
      ...form({ nome: '', descricao: '', ativo: 'true' }),
    })
    expect(res.statusCode).toBe(200)
    expect(res.body).toMatch(/nome é obrigatório/i)
  })

  // Line 92 — PUT catch quando sistema retornado tem admins vazio
  it('PUT /:id no catch lida com sistema sem admins', async () => {
    atualizarMock.mockRejectedValue(new Error('Falhou.'))
    buscarComAdminsMock.mockResolvedValue(SISTEMA_SEM_ADMINS)
    const res = await app.inject({
      method: 'PUT', url: '/s1',
      ...form({ nome: 'N', descricao: '', ativo: 'true' }),
    })
    expect(res.body).toContain('Falhou.')
  })

  // Line 93 — PUT com erro não-Error
  it('PUT /:id usa mensagem fallback quando atualizar lança valor não-Error', async () => {
    atualizarMock.mockRejectedValue('string crua')
    buscarComAdminsMock.mockResolvedValue(SISTEMA_SEM_ADMINS)
    const res = await app.inject({
      method: 'PUT', url: '/s1',
      ...form({ nome: 'N', descricao: '', ativo: 'true' }),
    })
    expect(res.body).toContain('Erro ao atualizar sistema.')
  })

  // Line 103 — DELETE com erro não-Error
  it('DELETE /:id usa mensagem fallback quando excluir lança valor não-Error', async () => {
    excluirMock.mockRejectedValue('string crua')
    const res = await app.inject({ method: 'DELETE', url: '/s1' })
    expect(res.statusCode).toBe(400)
    expect(res.body).toBe('Erro ao excluir.')
  })
})
