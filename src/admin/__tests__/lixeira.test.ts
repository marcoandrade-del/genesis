import { describe, it, expect, beforeEach, vi } from 'vitest'

const { listarMock, excluirPermanenteMock, restaurarMock } = vi.hoisted(() => ({
  listarMock: vi.fn(),
  excluirPermanenteMock: vi.fn(),
  restaurarMock: vi.fn(),
}))

vi.mock('../../services/lixeira.js', () => ({
  LixeiraService: class {
    listar = listarMock
    excluirPermanente = excluirPermanenteMock
    restaurar = restaurarMock
  },
}))

import { criarApp } from '../../routes/__tests__/helpers/criarApp.js'
import { adminLixeiraRoutes } from '../lixeira.js'
import type { FastifyInstance } from 'fastify'

describe('adminLixeiraRoutes', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    listarMock.mockReset()
    excluirPermanenteMock.mockReset()
    restaurarMock.mockReset()
    ;({ app } = await criarApp({
      registrar: adminLixeiraRoutes,
      comView: true,
      simularAdmin: { sub: 'admin1', email: 'admin@x.com' },
    }))
  })

  it('GET / renderiza lista da lixeira (lista vazia)', async () => {
    listarMock.mockResolvedValue([])
    const res = await app.inject({ method: 'GET', url: '/' })
    expect(res.statusCode).toBe(200)
    expect(listarMock).toHaveBeenCalled()
    expect(res.body).toMatch(/Lixeira/)
  })

  it('DELETE /:id chama excluirPermanente e re-renderiza tabela', async () => {
    excluirPermanenteMock.mockResolvedValue(undefined)
    listarMock.mockResolvedValue([])

    const res = await app.inject({ method: 'DELETE', url: '/l1' })

    expect(res.statusCode).toBe(200)
    expect(excluirPermanenteMock).toHaveBeenCalledWith('l1')
    expect(listarMock).toHaveBeenCalled()
  })

  it('DELETE /:id retorna 400 quando excluirPermanente falha', async () => {
    excluirPermanenteMock.mockRejectedValue(new Error('Item não encontrado.'))

    const res = await app.inject({ method: 'DELETE', url: '/l1' })

    expect(res.statusCode).toBe(400)
    expect(res.body).toBe('Item não encontrado.')
    expect(listarMock).not.toHaveBeenCalled()
  })

  it('DELETE /:id retorna 400 com mensagem default quando erro não é Error', async () => {
    excluirPermanenteMock.mockRejectedValue('falha não-Error')

    const res = await app.inject({ method: 'DELETE', url: '/l1' })

    expect(res.statusCode).toBe(400)
    expect(res.body).toBe('Erro ao excluir permanentemente.')
  })

  it('POST /:id/restaurar chama restaurar e re-renderiza tabela', async () => {
    restaurarMock.mockResolvedValue(undefined)
    listarMock.mockResolvedValue([])

    const res = await app.inject({ method: 'POST', url: '/l1/restaurar' })

    expect(res.statusCode).toBe(200)
    expect(restaurarMock).toHaveBeenCalledWith('l1')
    expect(listarMock).toHaveBeenCalled()
  })

  it('POST /:id/restaurar retorna 400 quando restaurar falha', async () => {
    restaurarMock.mockRejectedValue(new Error('Conflito de nome.'))

    const res = await app.inject({ method: 'POST', url: '/l1/restaurar' })

    expect(res.statusCode).toBe(400)
    expect(res.body).toBe('Conflito de nome.')
  })

  it('POST /:id/restaurar retorna 400 com mensagem default quando erro não é Error', async () => {
    restaurarMock.mockRejectedValue('boom')

    const res = await app.inject({ method: 'POST', url: '/l1/restaurar' })

    expect(res.statusCode).toBe(400)
    expect(res.body).toBe('Erro ao restaurar item.')
  })
})
