import { describe, it, expect, beforeEach, vi } from 'vitest'

const { buscarPorIdMock, criarMock, atualizarMock, excluirMock } = vi.hoisted(() => ({
  buscarPorIdMock: vi.fn(),
  criarMock: vi.fn(),
  atualizarMock: vi.fn(),
  excluirMock: vi.fn(),
}))

vi.mock('../../services/modelos-contabeis.js', () => ({
  ModelosContabeisService: class {
    buscarPorId = buscarPorIdMock
    criar = criarMock
    atualizar = atualizarMock
    excluir = excluirMock
  },
}))

import { criarApp } from '../../routes/__tests__/helpers/criarApp.js'
import { adminModelosContabeisRoutes } from '../modelos-contabeis.js'
import type { FastifyInstance } from 'fastify'
import type { PrismaMock } from '../../services/__tests__/helpers/prisma-mock.js'

const MODELO = { id: 'm1', descricao: 'PCASP', ativo: true, criadoEm: new Date(), atualizadoEm: new Date() }

function form(obj: Record<string, string>) {
  return {
    payload: new URLSearchParams(obj).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  }
}

describe('adminModelosContabeisRoutes', () => {
  let app: FastifyInstance
  let prisma: PrismaMock

  beforeEach(async () => {
    [buscarPorIdMock, criarMock, atualizarMock, excluirMock].forEach((m) => m.mockReset())
    ;({ app, prisma } = await criarApp({
      registrar: adminModelosContabeisRoutes,
      comView: true,
      simularAdmin: { sub: 'admin1', email: 'admin@x.com' },
    }))
  })

  describe('GET /', () => {
    it('lista modelos com _count', async () => {
      prisma.modeloContabil.findMany.mockResolvedValue([
        { ...MODELO, _count: { estados: 1, municipios: 2, planos: 3 } },
      ])
      const res = await app.inject({ method: 'GET', url: '/' })
      expect(res.statusCode).toBe(200)
      expect(prisma.modeloContabil.findMany).toHaveBeenCalledWith({
        orderBy: { descricao: 'asc' },
        include: { _count: { select: { estados: true, municipios: true, planos: true } } },
      })
    })

    it('renderiza estado vazio quando não há modelos', async () => {
      prisma.modeloContabil.findMany.mockResolvedValue([])
      const res = await app.inject({ method: 'GET', url: '/' })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Nenhum modelo contábil cadastrado')
    })
  })

  describe('GET /form', () => {
    it('renderiza form vazio', async () => {
      const res = await app.inject({ method: 'GET', url: '/form' })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Novo Modelo Contábil')
    })
  })

  describe('GET /:id/form', () => {
    it('404 quando modelo não existe', async () => {
      buscarPorIdMock.mockResolvedValue(null)
      const res = await app.inject({ method: 'GET', url: '/xx/form' })
      expect(res.statusCode).toBe(404)
    })

    it('renderiza form com modelo existente', async () => {
      buscarPorIdMock.mockResolvedValue(MODELO)
      const res = await app.inject({ method: 'GET', url: '/m1/form' })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Editar Modelo Contábil')
      expect(res.body).toContain('PCASP')
    })
  })

  describe('POST /', () => {
    it('cria e redireciona via HX-Redirect', async () => {
      criarMock.mockResolvedValue(MODELO)
      const res = await app.inject({ method: 'POST', url: '/', ...form({ descricao: 'PCASP' }) })
      expect(res.statusCode).toBe(204)
      expect(res.headers['hx-redirect']).toBe('/admin/modelos-contabeis')
      expect(criarMock).toHaveBeenCalledWith({ descricao: 'PCASP', ativo: true })
    })

    it('re-renderiza form com erro quando descrição vazia', async () => {
      const res = await app.inject({ method: 'POST', url: '/', ...form({ descricao: '   ' }) })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('A descrição é obrigatória')
      expect(criarMock).not.toHaveBeenCalled()
    })

    it('re-renderiza com erro do service (descrição duplicada)', async () => {
      criarMock.mockRejectedValue(new Error('Já existe um modelo'))
      const res = await app.inject({ method: 'POST', url: '/', ...form({ descricao: 'PCASP' }) })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Já existe um modelo')
    })

    it('captura erro não-Error com mensagem padrão', async () => {
      criarMock.mockRejectedValue('string-error')
      const res = await app.inject({ method: 'POST', url: '/', ...form({ descricao: 'X' }) })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Erro ao criar modelo contábil')
    })
  })

  describe('PUT /:id', () => {
    it('atualiza e redireciona', async () => {
      atualizarMock.mockResolvedValue(MODELO)
      const res = await app.inject({
        method: 'PUT', url: '/m1', ...form({ descricao: 'PCASP v2', ativo: 'true' }),
      })
      expect(res.statusCode).toBe(204)
      expect(res.headers['hx-redirect']).toBe('/admin/modelos-contabeis')
      expect(atualizarMock).toHaveBeenCalledWith('m1', { descricao: 'PCASP v2', ativo: true })
    })

    it('omite ativo quando não informado', async () => {
      atualizarMock.mockResolvedValue(MODELO)
      await app.inject({ method: 'PUT', url: '/m1', ...form({ descricao: 'X' }) })
      expect(atualizarMock).toHaveBeenCalledWith('m1', { descricao: 'X' })
    })

    it('re-renderiza form com erro quando descrição vazia', async () => {
      buscarPorIdMock.mockResolvedValue(MODELO)
      const res = await app.inject({ method: 'PUT', url: '/m1', ...form({ descricao: '' }) })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('A descrição é obrigatória')
      expect(atualizarMock).not.toHaveBeenCalled()
    })

    it('re-renderiza com erro do service', async () => {
      atualizarMock.mockRejectedValue(new Error('Conflito'))
      buscarPorIdMock.mockResolvedValue(MODELO)
      const res = await app.inject({ method: 'PUT', url: '/m1', ...form({ descricao: 'X' }) })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Conflito')
    })

    it('captura erro não-Error com mensagem padrão', async () => {
      atualizarMock.mockRejectedValue('string')
      buscarPorIdMock.mockResolvedValue(MODELO)
      const res = await app.inject({ method: 'PUT', url: '/m1', ...form({ descricao: 'X' }) })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Erro ao atualizar modelo contábil')
    })
  })

  describe('DELETE /:id', () => {
    it('exclui com 200', async () => {
      excluirMock.mockResolvedValue(undefined)
      const res = await app.inject({ method: 'DELETE', url: '/m1' })
      expect(res.statusCode).toBe(200)
      expect(excluirMock).toHaveBeenCalledWith('m1')
    })

    it('400 quando service rejeita (em uso)', async () => {
      excluirMock.mockRejectedValue(new Error('Em uso'))
      const res = await app.inject({ method: 'DELETE', url: '/m1' })
      expect(res.statusCode).toBe(400)
      expect(res.body).toBe('Em uso')
    })

    it('400 com mensagem padrão para erro não-Error', async () => {
      excluirMock.mockRejectedValue('boom')
      const res = await app.inject({ method: 'DELETE', url: '/m1' })
      expect(res.statusCode).toBe(400)
      expect(res.body).toBe('Erro ao excluir.')
    })
  })
})
