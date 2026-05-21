import { describe, it, expect, beforeEach, vi } from 'vitest'

const { buscarPorIdMock, criarMock, atualizarMock, excluirMock } = vi.hoisted(() => ({
  buscarPorIdMock: vi.fn(),
  criarMock: vi.fn(),
  atualizarMock: vi.fn(),
  excluirMock: vi.fn(),
}))

vi.mock('../../services/modulos.js', () => ({
  ModulosService: class {
    buscarPorId = buscarPorIdMock
    criar = criarMock
    atualizar = atualizarMock
    excluir = excluirMock
  },
}))
vi.mock('../../services/lixeira.js', () => ({
  LixeiraService: class {},
}))

import { criarApp } from '../../routes/__tests__/helpers/criarApp.js'
import { adminModulosRoutes } from '../modulos.js'
import type { FastifyInstance } from 'fastify'
import type { PrismaMock } from '../../services/__tests__/helpers/prisma-mock.js'

function form(obj: Record<string, string>) {
  return {
    payload: new URLSearchParams(obj).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  }
}

describe('adminModulosRoutes — branches restantes', () => {
  let app: FastifyInstance
  let prisma: PrismaMock

  beforeEach(async () => {
    [buscarPorIdMock, criarMock, atualizarMock, excluirMock].forEach(m => m.mockReset())
    ;({ app, prisma } = await criarApp({
      registrar: adminModulosRoutes,
      comView: true,
      simularAdmin: { sub: 'admin1', email: 'admin@x.com' },
    }))
  })

  it('GET /:id/form renderiza com sistemaNome=null quando sistema não existe', async () => {
    buscarPorIdMock.mockResolvedValue({ id: 'm1', sistemaId: 's1', nome: 'Mod' })
    prisma.sistema.findUnique.mockResolvedValue(null)

    const res = await app.inject({ method: 'GET', url: '/m1/form' })

    expect(res.statusCode).toBe(200)
    expect(prisma.sistema.findUnique).toHaveBeenCalledWith({
      where: { id: 's1' },
      select: { nome: true },
    })
  })

  it('POST / usa mensagem fallback quando criar lança valor não-Error', async () => {
    prisma.usuario.findUnique.mockResolvedValue({ id: 'admin1', nomeCompleto: 'Admin' })
    criarMock.mockRejectedValue('string crua')

    const res = await app.inject({
      method: 'POST', url: '/',
      ...form({ nome: 'X', descricao: '', sistemaId: 's1', adminUsuarioId: 'u1' }),
    })

    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('Erro ao criar módulo.')
  })

  it('PUT /:id no catch deixa sistemaNome=null quando buscarPorId retorna null', async () => {
    atualizarMock.mockRejectedValue(new Error('Falha.'))
    buscarPorIdMock.mockResolvedValue(null)

    const res = await app.inject({
      method: 'PUT', url: '/m1',
      ...form({ nome: 'N', descricao: '' }),
    })

    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('Falha.')
    expect(prisma.sistema.findUnique).not.toHaveBeenCalled()
  })

  it('PUT /:id usa mensagem fallback quando atualizar lança valor não-Error', async () => {
    atualizarMock.mockRejectedValue('falha crua')
    buscarPorIdMock.mockResolvedValue(null)

    const res = await app.inject({
      method: 'PUT', url: '/m1',
      ...form({ nome: 'N', descricao: '' }),
    })

    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('Erro ao atualizar módulo.')
  })

  it('PUT /:id omite nome do payload quando vazio', async () => {
    atualizarMock.mockResolvedValue(undefined)

    await app.inject({
      method: 'PUT', url: '/m1',
      ...form({ nome: '', descricao: 'd', ativo: 'true' }),
    })

    expect(atualizarMock).toHaveBeenCalledWith('m1', { descricao: 'd', ativo: true })
  })

  it('DELETE /:id usa mensagem fallback quando excluir lança valor não-Error', async () => {
    excluirMock.mockRejectedValue('falha crua')

    const res = await app.inject({ method: 'DELETE', url: '/m1' })

    expect(res.statusCode).toBe(400)
    expect(res.body).toBe('Erro ao excluir.')
  })
})
