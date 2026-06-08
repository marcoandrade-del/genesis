import { describe, it, expect, beforeEach, vi } from 'vitest'

const { listarRaizesMock, listarFilhosMock, buscarMock, sugerirMock, desdobrarMock, excluirMock } = vi.hoisted(() => ({
  listarRaizesMock: vi.fn(),
  listarFilhosMock: vi.fn(),
  buscarMock: vi.fn(),
  sugerirMock: vi.fn(),
  desdobrarMock: vi.fn(),
  excluirMock: vi.fn(),
}))

vi.mock('../../services/contas-despesa-entidade.js', () => ({
  ContasDespesaEntidadeService: class {
    listarRaizes = listarRaizesMock
    listarFilhos = listarFilhosMock
    buscarPorId = buscarMock
    sugerirCodigo = sugerirMock
    desdobrar = desdobrarMock
    excluir = excluirMock
  },
}))

import { criarApp } from '../../routes/__tests__/helpers/criarApp.js'
import { adminContasDespesaEntidadeRoutes } from '../contas-despesa-entidade.js'
import type { FastifyInstance } from 'fastify'
import type { PrismaMock } from '../../services/__tests__/helpers/prisma-mock.js'

const ENTIDADE = { id: 'e1', nome: 'Prefeitura', municipio: { nome: 'Curitiba', estado: { sigla: 'PR' } } }
const CONTA = { id: 'c1', entidadeId: 'e1', ano: 2026, codigo: '3.1', descricao: 'Pessoal', nivel: 2, admiteMovimento: true, origem: 'MODELO', parentId: null }

function form(obj: Record<string, string>) {
  return { payload: new URLSearchParams(obj).toString(), headers: { 'content-type': 'application/x-www-form-urlencoded' } }
}

describe('adminContasDespesaEntidadeRoutes', () => {
  let app: FastifyInstance
  let prisma: PrismaMock

  beforeEach(async () => {
    ;[listarRaizesMock, listarFilhosMock, buscarMock, sugerirMock, desdobrarMock, excluirMock].forEach((m) => m.mockReset())
    listarRaizesMock.mockResolvedValue([])
    listarFilhosMock.mockResolvedValue([])
    ;({ app, prisma } = await criarApp({
      registrar: adminContasDespesaEntidadeRoutes,
      comView: true,
      simularAdmin: { sub: 'a1', email: 'a@x.com' },
    }))
    prisma.entidade.findMany.mockResolvedValue([ENTIDADE])
  })

  describe('GET /', () => {
    it('sem entidade mostra picker', async () => {
      const res = await app.inject({ method: 'GET', url: '/' })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Selecione uma entidade')
      expect(listarRaizesMock).not.toHaveBeenCalled()
    })

    it('404 quando entidade não existe', async () => {
      prisma.entidade.findUnique.mockResolvedValue(null)
      const res = await app.inject({ method: 'GET', url: '/?entidadeId=x' })
      expect(res.statusCode).toBe(404)
    })

    it('renderiza árvore com raizes (temFilhos via groupBy)', async () => {
      prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
      listarRaizesMock.mockResolvedValue([CONTA])
      prisma.contaDespesaEntidade.groupBy.mockResolvedValue([{ parentId: 'c1', _count: { _all: 1 } }])
      const res = await app.inject({ method: 'GET', url: '/?entidadeId=e1&ano=2026' })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Pessoal')
      expect(res.body).toContain('Desdobrar')
      expect(listarRaizesMock).toHaveBeenCalledWith('e1', 2026)
    })

    it('ano inválido cai no ano corrente', async () => {
      prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
      listarRaizesMock.mockResolvedValue([])
      await app.inject({ method: 'GET', url: '/?entidadeId=e1&ano=abc' })
      expect(listarRaizesMock).toHaveBeenCalledWith('e1', new Date().getFullYear())
    })
  })

  describe('GET /:id/filhos', () => {
    it('404 quando pai não existe', async () => {
      buscarMock.mockResolvedValue(null)
      const res = await app.inject({ method: 'GET', url: '/x/filhos' })
      expect(res.statusCode).toBe(404)
    })

    it('renderiza filhos', async () => {
      buscarMock.mockResolvedValue(CONTA)
      listarFilhosMock.mockResolvedValue([{ ...CONTA, id: 'c2', codigo: '3.1.01', origem: 'DESDOBRAMENTO', nivel: 3, parentId: 'c1', admiteMovimento: true }])
      prisma.contaDespesaEntidade.groupBy.mockResolvedValue([])
      const res = await app.inject({ method: 'GET', url: '/c1/filhos' })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('3.1.01')
      expect(res.body).toContain('Desdobr.')
    })
  })

  describe('GET /:id/desdobrar', () => {
    it('404 quando conta não existe', async () => {
      buscarMock.mockResolvedValue(null)
      const res = await app.inject({ method: 'GET', url: '/x/desdobrar' })
      expect(res.statusCode).toBe(404)
    })

    it('409 quando conta é sintética', async () => {
      buscarMock.mockResolvedValue({ ...CONTA, admiteMovimento: false })
      const res = await app.inject({ method: 'GET', url: '/c1/desdobrar' })
      expect(res.statusCode).toBe(409)
    })

    it('renderiza form com sugestão', async () => {
      buscarMock.mockResolvedValue(CONTA)
      sugerirMock.mockResolvedValue('3.1.01')
      const res = await app.inject({ method: 'GET', url: '/c1/desdobrar' })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Desdobrar Conta')
      expect(res.body).toContain('3.1.01')
    })
  })

  describe('POST /:id/desdobrar', () => {
    it('desdobra e redireciona para a árvore', async () => {
      desdobrarMock.mockResolvedValue({ id: 'f1', entidadeId: 'e1', ano: 2026 })
      const res = await app.inject({ method: 'POST', url: '/c1/desdobrar', ...form({ codigo: '3.1.01', descricao: 'Sal' }) })
      expect(res.statusCode).toBe(204)
      expect(res.headers['hx-redirect']).toBe('/admin/contas-despesa-entidade?entidadeId=e1&ano=2026')
      expect(desdobrarMock).toHaveBeenCalledWith('c1', { codigo: '3.1.01', descricao: 'Sal' })
    })

    it('re-renderiza form com erro do service', async () => {
      desdobrarMock.mockRejectedValue(new Error('Já existe uma conta com o código'))
      buscarMock.mockResolvedValue(CONTA)
      sugerirMock.mockResolvedValue('3.1.02')
      const res = await app.inject({ method: 'POST', url: '/c1/desdobrar', ...form({ codigo: '3.1', descricao: 'X' }) })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Já existe uma conta com o código')
    })

    it('404 se a conta sumiu no re-render do erro', async () => {
      desdobrarMock.mockRejectedValue(new Error('boom'))
      buscarMock.mockResolvedValue(null)
      const res = await app.inject({ method: 'POST', url: '/c1/desdobrar', ...form({ codigo: '3.1', descricao: 'X' }) })
      expect(res.statusCode).toBe(404)
    })

    it('mensagem default para erro não-Error', async () => {
      desdobrarMock.mockRejectedValue('boom')
      buscarMock.mockResolvedValue(CONTA)
      sugerirMock.mockResolvedValue('3.1.02')
      const res = await app.inject({ method: 'POST', url: '/c1/desdobrar', ...form({ codigo: '3.1', descricao: 'X' }) })
      expect(res.body).toContain('Erro ao desdobrar')
    })
  })

  describe('DELETE /:id', () => {
    it('exclui e redireciona', async () => {
      excluirMock.mockResolvedValue({ entidadeId: 'e1', ano: 2026 })
      const res = await app.inject({ method: 'DELETE', url: '/d1' })
      expect(res.statusCode).toBe(204)
      expect(res.headers['hx-redirect']).toBe('/admin/contas-despesa-entidade?entidadeId=e1&ano=2026')
    })
    it('erro vira modal (mostrarInfo) sem swap', async () => {
      excluirMock.mockRejectedValue(new Error('Conta com movimentação não pode ser excluída.'))
      const res = await app.inject({ method: 'DELETE', url: '/d1' })
      expect(res.statusCode).toBe(200)
      expect(res.headers['hx-reswap']).toBe('none')
      expect(res.headers['hx-trigger']).toContain('mostrarInfo')
    })
    it('mensagem default p/ erro não-Error', async () => {
      excluirMock.mockRejectedValue('boom')
      const res = await app.inject({ method: 'DELETE', url: '/d1' })
      expect(res.headers['hx-trigger']).toContain('Erro ao excluir')
    })
  })
})
