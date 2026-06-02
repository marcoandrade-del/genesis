import { describe, it, expect, beforeEach, vi } from 'vitest'

const { listarMock, buscarMock, criarMock, atualizarMock, excluirMock } = vi.hoisted(() => ({
  listarMock: vi.fn(),
  buscarMock: vi.fn(),
  criarMock: vi.fn(),
  atualizarMock: vi.fn(),
  excluirMock: vi.fn(),
}))

vi.mock('../../services/fornecedores.js', () => ({
  FornecedoresService: class {
    listar = listarMock
    buscarPorId = buscarMock
    criar = criarMock
    atualizar = atualizarMock
    excluir = excluirMock
  },
}))

import { criarApp } from '../../routes/__tests__/helpers/criarApp.js'
import { adminFornecedoresRoutes } from '../fornecedores.js'
import type { FastifyInstance } from 'fastify'

const FORN = { id: 'f1', tipoPessoa: 'PJ', cnpj: '12.345.678/0001-90', cpf: null, razaoSocial: 'ACME LTDA', nomeFantasia: 'ACME', ativo: true }

function form(obj: Record<string, string>) {
  return { payload: new URLSearchParams(obj).toString(), headers: { 'content-type': 'application/x-www-form-urlencoded' } }
}

describe('adminFornecedoresRoutes', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    ;[listarMock, buscarMock, criarMock, atualizarMock, excluirMock].forEach((m) => m.mockReset())
    ;({ app } = await criarApp({ registrar: adminFornecedoresRoutes, comView: true, simularAdmin: { sub: 'a1', email: 'a@x.com' } }))
  })

  it('GET / lista e filtra por tipo', async () => {
    listarMock.mockResolvedValue([FORN])
    const res = await app.inject({ method: 'GET', url: '/?tipo=PJ' })
    expect(res.statusCode).toBe(200)
    expect(listarMock).toHaveBeenCalledWith({ tipoPessoa: 'PJ' })
    expect(res.body).toContain('ACME LTDA')
  })

  it('GET / ignora tipo inválido', async () => {
    listarMock.mockResolvedValue([])
    await app.inject({ method: 'GET', url: '/?tipo=ZZ' })
    expect(listarMock).toHaveBeenCalledWith({})
  })

  it('GET /form renderiza novo', async () => {
    const res = await app.inject({ method: 'GET', url: '/form' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('Novo Fornecedor')
  })

  it('GET /:id/form 404', async () => {
    buscarMock.mockResolvedValue(null)
    const res = await app.inject({ method: 'GET', url: '/f1/form' })
    expect(res.statusCode).toBe(404)
  })

  it('POST / cria PJ', async () => {
    criarMock.mockResolvedValue(FORN)
    const res = await app.inject({ method: 'POST', url: '/', ...form({ tipoPessoa: 'PJ', cnpj: '12345', razaoSocial: 'ACME' }) })
    expect(res.statusCode).toBe(204)
    expect(res.headers['hx-redirect']).toBe('/admin/fornecedores')
    expect(criarMock.mock.calls[0][0]).toMatchObject({ tipoPessoa: 'PJ', cnpj: '12345', razaoSocial: 'ACME' })
  })

  it('POST / erro re-renderiza', async () => {
    criarMock.mockRejectedValue(new Error('CNPJ é obrigatório'))
    const res = await app.inject({ method: 'POST', url: '/', ...form({ tipoPessoa: 'PJ', razaoSocial: 'X' }) })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('CNPJ é obrigatório')
  })

  it('PUT /:id atualiza com ativo', async () => {
    atualizarMock.mockResolvedValue(FORN)
    const res = await app.inject({ method: 'PUT', url: '/f1', ...form({ tipoPessoa: 'PF', cpf: '111', razaoSocial: 'João', ativo: 'true' }) })
    expect(res.statusCode).toBe(204)
    expect(atualizarMock.mock.calls[0][1]).toMatchObject({ tipoPessoa: 'PF', cpf: '111', ativo: true })
  })

  it('DELETE /:id erro vira 400', async () => {
    excluirMock.mockRejectedValue(new Error('Fornecedor em uso'))
    const res = await app.inject({ method: 'DELETE', url: '/f1' })
    expect(res.statusCode).toBe(400)
    expect(res.body).toContain('em uso')
  })
})
