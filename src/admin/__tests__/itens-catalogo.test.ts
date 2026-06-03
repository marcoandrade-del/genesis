import { describe, it, expect, beforeEach, vi } from 'vitest'

const { listarMock, buscarMock, criarMock, atualizarMock, excluirMock } = vi.hoisted(() => ({
  listarMock: vi.fn(),
  buscarMock: vi.fn(),
  criarMock: vi.fn(),
  atualizarMock: vi.fn(),
  excluirMock: vi.fn(),
}))

vi.mock('../../services/itens-catalogo.js', () => ({
  ItensCatalogoService: class {
    listar = listarMock
    buscarPorId = buscarMock
    criar = criarMock
    atualizar = atualizarMock
    excluir = excluirMock
  },
}))

import { criarApp } from '../../routes/__tests__/helpers/criarApp.js'
import { adminItensCatalogoRoutes } from '../itens-catalogo.js'
import type { FastifyInstance } from 'fastify'

const ITEM = { id: 'i1', tipo: 'MATERIAL', codigo: '123456', descricao: 'Caneta azul', unidadeMedida: 'UN', ativo: true }

function form(obj: Record<string, string>) {
  return { payload: new URLSearchParams(obj).toString(), headers: { 'content-type': 'application/x-www-form-urlencoded' } }
}

describe('adminItensCatalogoRoutes', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    ;[listarMock, buscarMock, criarMock, atualizarMock, excluirMock].forEach((m) => m.mockReset())
    ;({ app } = await criarApp({
      registrar: adminItensCatalogoRoutes,
      comView: true,
      simularAdmin: { sub: 'a1', email: 'a@x.com' },
    }))
  })

  describe('GET /', () => {
    it('lista sem filtro', async () => {
      listarMock.mockResolvedValue([ITEM])
      const res = await app.inject({ method: 'GET', url: '/' })
      expect(res.statusCode).toBe(200)
      expect(listarMock).toHaveBeenCalledWith({})
      expect(res.body).toContain('Caneta azul')
    })

    it('filtra por tipo válido', async () => {
      listarMock.mockResolvedValue([])
      await app.inject({ method: 'GET', url: '/?tipo=SERVICO' })
      expect(listarMock).toHaveBeenCalledWith({ tipo: 'SERVICO' })
    })

    it('ignora tipo inválido', async () => {
      listarMock.mockResolvedValue([])
      await app.inject({ method: 'GET', url: '/?tipo=XX' })
      expect(listarMock).toHaveBeenCalledWith({})
    })
  })

  describe('GET form', () => {
    it('GET /form renderiza novo', async () => {
      const res = await app.inject({ method: 'GET', url: '/form' })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Novo Item')
    })

    it('GET /:id/form 404 quando não existe', async () => {
      buscarMock.mockResolvedValue(null)
      const res = await app.inject({ method: 'GET', url: '/i1/form' })
      expect(res.statusCode).toBe(404)
    })

    it('GET /:id/form renderiza edição', async () => {
      buscarMock.mockResolvedValue(ITEM)
      const res = await app.inject({ method: 'GET', url: '/i1/form' })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Editar Item')
    })
  })

  describe('POST /', () => {
    it('cria e devolve HX-Redirect', async () => {
      criarMock.mockResolvedValue(ITEM)
      const res = await app.inject({
        method: 'POST',
        url: '/',
        ...form({ tipo: 'MATERIAL', codigo: '123', descricao: 'X', unidadeMedida: 'UN' }),
      })
      expect(res.statusCode).toBe(204)
      expect(res.headers['hx-redirect']).toBe('/admin/itens-catalogo')
      expect(criarMock).toHaveBeenCalledWith({ tipo: 'MATERIAL', codigo: '123', descricao: 'X', unidadeMedida: 'UN' })
    })

    it('erro do service re-renderiza form com mensagem', async () => {
      criarMock.mockRejectedValue(new Error('Já existe um item MATERIAL com o código "123".'))
      const res = await app.inject({
        method: 'POST',
        url: '/',
        ...form({ tipo: 'MATERIAL', codigo: '123', descricao: 'X', unidadeMedida: 'UN' }),
      })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Já existe um item')
    })
  })

  describe('PUT /:id', () => {
    it('atualiza com ativo do checkbox', async () => {
      atualizarMock.mockResolvedValue(ITEM)
      const res = await app.inject({
        method: 'PUT',
        url: '/i1',
        ...form({ tipo: 'SERVICO', codigo: '9', descricao: 'Y', unidadeMedida: 'HORA', ativo: 'true' }),
      })
      expect(res.statusCode).toBe(204)
      expect(atualizarMock).toHaveBeenCalledWith('i1', {
        tipo: 'SERVICO',
        codigo: '9',
        descricao: 'Y',
        unidadeMedida: 'HORA',
        ativo: true,
      })
    })

    it('sem checkbox ativo → ativo=false', async () => {
      atualizarMock.mockResolvedValue(ITEM)
      await app.inject({ method: 'PUT', url: '/i1', ...form({ tipo: 'MATERIAL', codigo: '9', descricao: 'Y', unidadeMedida: 'UN' }) })
      expect(atualizarMock.mock.calls[0][1].ativo).toBe(false)
    })
  })

  describe('DELETE /:id', () => {
    it('exclui com 200', async () => {
      excluirMock.mockResolvedValue(undefined)
      const res = await app.inject({ method: 'DELETE', url: '/i1' })
      expect(res.statusCode).toBe(200)
    })

    it('erro vira 400 com mensagem', async () => {
      excluirMock.mockRejectedValue(new Error('Item em uso'))
      const res = await app.inject({ method: 'DELETE', url: '/i1' })
      expect(res.statusCode).toBe(400)
      expect(res.body).toContain('Item em uso')
    })
  })
})
