import { describe, it, expect, beforeEach, vi } from 'vitest'

const { listarRaizesMock, listarFilhosMock, buscarMock, sugerirMock, desdobrarMock, excluirMock } = vi.hoisted(() => ({
  listarRaizesMock: vi.fn(), listarFilhosMock: vi.fn(), buscarMock: vi.fn(), sugerirMock: vi.fn(), desdobrarMock: vi.fn(), excluirMock: vi.fn(),
}))

vi.mock('../../services/contas-contabil-entidade.js', () => ({
  ContasContabilEntidadeService: class {
    listarRaizes = listarRaizesMock
    listarFilhos = listarFilhosMock
    buscarPorId = buscarMock
    sugerirCodigo = sugerirMock
    desdobrar = desdobrarMock
    excluir = excluirMock
  },
}))

import { criarApp } from '../../routes/__tests__/helpers/criarApp.js'
import { adminContasContabilEntidadeRoutes } from '../contas-contabil-entidade.js'
import type { FastifyInstance } from 'fastify'
import type { PrismaMock } from '../../services/__tests__/helpers/prisma-mock.js'

const ENTIDADE = { id: 'e1', nome: 'Prefeitura', municipio: { nome: 'Curitiba', estado: { sigla: 'PR' } } }
const CONTA = { id: 'c1', entidadeId: 'e1', ano: 2026, codigo: '1.1', descricao: 'Ativo Circulante', nivel: 2, admiteMovimento: true, origem: 'MODELO', parentId: null }

function form(obj: Record<string, string>) {
  return { payload: new URLSearchParams(obj).toString(), headers: { 'content-type': 'application/x-www-form-urlencoded' } }
}

describe('adminContasContabilEntidadeRoutes', () => {
  let app: FastifyInstance
  let prisma: PrismaMock

  beforeEach(async () => {
    ;[listarRaizesMock, listarFilhosMock, buscarMock, sugerirMock, desdobrarMock, excluirMock].forEach((m) => m.mockReset())
    listarRaizesMock.mockResolvedValue([]); listarFilhosMock.mockResolvedValue([])
    ;({ app, prisma } = await criarApp({ registrar: adminContasContabilEntidadeRoutes, comView: true, simularAdmin: { sub: 'a1', email: 'a@x.com' } }))
    prisma.entidade.findMany.mockResolvedValue([ENTIDADE])
  })

  describe('GET /', () => {
    it('sem entidade mostra picker', async () => {
      const res = await app.inject({ method: 'GET', url: '/' })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Selecione uma entidade')
    })
    it('404 quando entidade não existe', async () => {
      prisma.entidade.findUnique.mockResolvedValue(null)
      expect((await app.inject({ method: 'GET', url: '/?entidadeId=x' })).statusCode).toBe(404)
    })
    it('renderiza árvore', async () => {
      prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
      listarRaizesMock.mockResolvedValue([CONTA])
      prisma.contaContabilEntidade.groupBy.mockResolvedValue([{ parentId: 'c1', _count: { _all: 1 } }])
      const res = await app.inject({ method: 'GET', url: '/?entidadeId=e1&ano=2026' })
      expect(res.body).toContain('Ativo Circulante')
      expect(res.body).toContain('Desdobrar')
      expect(listarRaizesMock).toHaveBeenCalledWith('e1', 2026)
    })
    it('ano inválido cai no ano corrente', async () => {
      prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
      await app.inject({ method: 'GET', url: '/?entidadeId=e1&ano=abc' })
      expect(listarRaizesMock).toHaveBeenCalledWith('e1', new Date().getFullYear())
    })
  })

  describe('GET /:id/filhos', () => {
    it('404 quando pai não existe', async () => {
      buscarMock.mockResolvedValue(null)
      expect((await app.inject({ method: 'GET', url: '/x/filhos' })).statusCode).toBe(404)
    })
    it('renderiza filhos', async () => {
      buscarMock.mockResolvedValue(CONTA)
      listarFilhosMock.mockResolvedValue([{ ...CONTA, id: 'c2', codigo: '1.1.01', origem: 'DESDOBRAMENTO', nivel: 3, parentId: 'c1' }])
      prisma.contaContabilEntidade.groupBy.mockResolvedValue([])
      const res = await app.inject({ method: 'GET', url: '/c1/filhos' })
      expect(res.body).toContain('1.1.01')
      expect(res.body).toContain('Desdobr.')
    })
  })

  describe('GET /:id/desdobrar', () => {
    it('404 quando conta não existe', async () => {
      buscarMock.mockResolvedValue(null)
      expect((await app.inject({ method: 'GET', url: '/x/desdobrar' })).statusCode).toBe(404)
    })
    it('409 quando sintética', async () => {
      buscarMock.mockResolvedValue({ ...CONTA, admiteMovimento: false })
      expect((await app.inject({ method: 'GET', url: '/c1/desdobrar' })).statusCode).toBe(409)
    })
    it('renderiza form com sugestão', async () => {
      buscarMock.mockResolvedValue(CONTA); sugerirMock.mockResolvedValue('1.1.01')
      const res = await app.inject({ method: 'GET', url: '/c1/desdobrar' })
      expect(res.body).toContain('Desdobrar Conta')
      expect(res.body).toContain('1.1.01')
    })
  })

  describe('POST /:id/desdobrar', () => {
    it('desdobra e redireciona', async () => {
      desdobrarMock.mockResolvedValue({ id: 'f1', entidadeId: 'e1', ano: 2026 })
      const res = await app.inject({ method: 'POST', url: '/c1/desdobrar', ...form({ codigo: '1.1.01', descricao: 'Caixa' }) })
      expect(res.statusCode).toBe(204)
      expect(res.headers['hx-redirect']).toBe('/admin/contas-contabil-entidade?entidadeId=e1&ano=2026')
    })
    it('re-renderiza erro do service', async () => {
      desdobrarMock.mockRejectedValue(new Error('dup'))
      buscarMock.mockResolvedValue(CONTA); sugerirMock.mockResolvedValue('1.1.02')
      const res = await app.inject({ method: 'POST', url: '/c1/desdobrar', ...form({ codigo: '1.1', descricao: 'X' }) })
      expect(res.body).toContain('dup')
    })
    it('404 se conta sumiu no re-render', async () => {
      desdobrarMock.mockRejectedValue(new Error('x')); buscarMock.mockResolvedValue(null)
      expect((await app.inject({ method: 'POST', url: '/c1/desdobrar', ...form({ codigo: '1', descricao: 'X' }) })).statusCode).toBe(404)
    })
    it('mensagem default para erro não-Error', async () => {
      desdobrarMock.mockRejectedValue('boom'); buscarMock.mockResolvedValue(CONTA); sugerirMock.mockResolvedValue('1.1.02')
      const res = await app.inject({ method: 'POST', url: '/c1/desdobrar', ...form({ codigo: '1', descricao: 'X' }) })
      expect(res.body).toContain('Erro ao desdobrar')
    })
  })

  describe('DELETE /:id', () => {
    it('exclui e redireciona (HX-Redirect)', async () => {
      excluirMock.mockResolvedValue({ entidadeId: 'e1', ano: 2026 })
      const res = await app.inject({ method: 'DELETE', url: '/d1' })
      expect(res.statusCode).toBe(204)
      expect(res.headers['hx-redirect']).toBe('/admin/contas-contabil-entidade?entidadeId=e1&ano=2026')
    })
    it('erro vira modal (HX-Trigger mostrarInfo) sem swap', async () => {
      excluirMock.mockRejectedValue(new Error('Conta com movimentação não pode ser excluída.'))
      const res = await app.inject({ method: 'DELETE', url: '/d1' })
      expect(res.statusCode).toBe(200)
      expect(res.headers['hx-reswap']).toBe('none')
      expect(res.headers['hx-trigger']).toContain('mostrarInfo')
      expect(res.headers['hx-trigger']).toContain('movimentação')
    })
    it('mensagem default para erro não-Error', async () => {
      excluirMock.mockRejectedValue('boom')
      const res = await app.inject({ method: 'DELETE', url: '/d1' })
      expect(res.headers['hx-trigger']).toContain('Erro ao excluir')
    })
  })
})
