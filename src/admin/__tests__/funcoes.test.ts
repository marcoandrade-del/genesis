import { describe, it, expect, beforeEach, vi } from 'vitest'

const { listarMock } = vi.hoisted(() => ({ listarMock: vi.fn() }))

vi.mock('../../services/funcoes.js', () => ({
  FuncoesService: class {
    listar = listarMock
  },
}))

import { criarApp } from '../../routes/__tests__/helpers/criarApp.js'
import { adminFuncoesRoutes } from '../funcoes.js'
import type { FastifyInstance } from 'fastify'

describe('adminFuncoesRoutes', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    listarMock.mockReset()
    ;({ app } = await criarApp({
      registrar: adminFuncoesRoutes,
      comView: true,
      simularAdmin: { sub: 'a1', email: 'a@x.com' },
    }))
  })

  it('GET / renderiza com lista de funções e contagem de subfunções', async () => {
    listarMock.mockResolvedValue([
      { id: 'f1', codigo: '01', nome: 'LEGISLATIVA', subfuncoes: [
        { id: 's1', codigo: '031', nome: 'AÇÃO LEGISLATIVA' },
        { id: 's2', codigo: '032', nome: 'CONTROLE EXTERNO' },
      ] },
      { id: 'f2', codigo: '04', nome: 'ADMINISTRAÇÃO', subfuncoes: [] },
    ])
    const res = await app.inject({ method: 'GET', url: '/' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('LEGISLATIVA')
    expect(res.body).toContain('AÇÃO LEGISLATIVA')
    expect(res.body).toContain('Sem subfunções')
    expect(res.body).toContain('Portaria MOG nº 42/1999')
  })

  it('lista vazia ainda renderiza ok (cabeçalho com 0 funções)', async () => {
    listarMock.mockResolvedValue([])
    const res = await app.inject({ method: 'GET', url: '/' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('<strong>0</strong>')
  })
})
