import { describe, it, expect, beforeEach, vi } from 'vitest'

const { listarMock, buscarPorIdMock, excluirMock } = vi.hoisted(() => ({
  listarMock: vi.fn(),
  buscarPorIdMock: vi.fn(),
  excluirMock: vi.fn(),
}))

vi.mock('../../services/lancamentos.js', () => ({
  LancamentosService: class {
    listar = listarMock
    buscarPorId = buscarPorIdMock
    excluir = excluirMock
  },
}))

import { criarApp } from '../../routes/__tests__/helpers/criarApp.js'
import { adminLancamentosRoutes } from '../lancamentos.js'
import type { FastifyInstance } from 'fastify'
import type { PrismaMock } from '../../services/__tests__/helpers/prisma-mock.js'

const ESTADO = { id: 'e1', sigla: 'MG', nome: 'Minas Gerais' }
const MUNICIPIO = { id: 'mun1', nome: 'Belo Horizonte', estado: ESTADO }
const LANCAMENTO = {
  id: 'l1', municipioId: 'mun1', data: new Date('2026-05-20T00:00:00Z'),
  historico: 'Pagamento de fornecedor', valor: '1500.00',
  criadoEm: new Date(), criadoPorId: 'u1',
  itens: [
    { id: 'i1', lancamentoId: 'l1', contaId: 'c1', tipo: 'DEBITO', valor: '1500.00' },
    { id: 'i2', lancamentoId: 'l1', contaId: 'c2', tipo: 'CREDITO', valor: '1500.00' },
  ],
}

describe('adminLancamentosRoutes', () => {
  let app: FastifyInstance
  let prisma: PrismaMock

  beforeEach(async () => {
    ;[listarMock, buscarPorIdMock, excluirMock].forEach((m) => m.mockReset())
    ;({ app, prisma } = await criarApp({
      registrar: adminLancamentosRoutes,
      comView: true,
      simularAdmin: { sub: 'a1', email: 'a@x.com' },
    }))
  })

  describe('GET /', () => {
    it('sem estado/município mostra picker e lista vazia', async () => {
      prisma.estado.findMany.mockResolvedValue([ESTADO])
      const res = await app.inject({ method: 'GET', url: '/' })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Selecione um estado e município')
      expect(prisma.municipio.findMany).not.toHaveBeenCalled()
      expect(listarMock).not.toHaveBeenCalled()
    })

    it('com estadoId mostra select de municípios filtrado', async () => {
      prisma.estado.findMany.mockResolvedValue([ESTADO])
      prisma.municipio.findMany.mockResolvedValue([{ id: 'mun1', nome: 'Belo Horizonte' }])
      const res = await app.inject({ method: 'GET', url: '/?estadoId=e1' })
      expect(prisma.municipio.findMany).toHaveBeenCalledWith({
        where: { estadoId: 'e1' },
        orderBy: { nome: 'asc' },
        select: { id: true, nome: true },
      })
      expect(res.body).toContain('Belo Horizonte')
    })

    it('ignora estadoId vazio (whitespace)', async () => {
      prisma.estado.findMany.mockResolvedValue([])
      await app.inject({ method: 'GET', url: '/?estadoId=%20' })
      expect(prisma.municipio.findMany).not.toHaveBeenCalled()
    })

    it('com município lista lançamentos', async () => {
      prisma.estado.findMany.mockResolvedValue([ESTADO])
      prisma.municipio.findMany.mockResolvedValue([])
      prisma.municipio.findUnique.mockResolvedValue(MUNICIPIO)
      listarMock.mockResolvedValue([LANCAMENTO])
      const res = await app.inject({ method: 'GET', url: '/?municipioId=mun1' })
      expect(res.statusCode).toBe(200)
      expect(listarMock).toHaveBeenCalledWith('mun1', {})
      expect(res.body).toContain('Pagamento de fornecedor')
    })

    it('aplica filtros de data quando informados', async () => {
      prisma.estado.findMany.mockResolvedValue([])
      prisma.municipio.findUnique.mockResolvedValue(MUNICIPIO)
      listarMock.mockResolvedValue([])
      await app.inject({ method: 'GET', url: '/?municipioId=mun1&dataInicio=2026-01-01&dataFim=2026-12-31' })
      expect(listarMock).toHaveBeenCalledWith('mun1', { dataInicio: '2026-01-01', dataFim: '2026-12-31' })
    })

    it('omite filtros vazios da chamada ao service', async () => {
      prisma.estado.findMany.mockResolvedValue([])
      prisma.municipio.findUnique.mockResolvedValue(MUNICIPIO)
      listarMock.mockResolvedValue([])
      await app.inject({ method: 'GET', url: '/?municipioId=mun1&dataInicio=%20&dataFim=' })
      expect(listarMock).toHaveBeenCalledWith('mun1', {})
    })

    it('estado vazio quando município sem lançamentos no período', async () => {
      prisma.estado.findMany.mockResolvedValue([])
      prisma.municipio.findUnique.mockResolvedValue(MUNICIPIO)
      listarMock.mockResolvedValue([])
      const res = await app.inject({ method: 'GET', url: '/?municipioId=mun1' })
      expect(res.body).toContain('Nenhum lançamento no período')
    })

    it('mostra aviso de limite atingido quando 500 retornados', async () => {
      prisma.estado.findMany.mockResolvedValue([])
      prisma.municipio.findUnique.mockResolvedValue(MUNICIPIO)
      listarMock.mockResolvedValue(Array(500).fill(LANCAMENTO))
      const res = await app.inject({ method: 'GET', url: '/?municipioId=mun1' })
      expect(res.body).toContain('limite 500 atingido')
    })

    it('ignora municipioId quando município não existe (não chama service)', async () => {
      prisma.estado.findMany.mockResolvedValue([])
      prisma.municipio.findUnique.mockResolvedValue(null)
      const res = await app.inject({ method: 'GET', url: '/?municipioId=xx' })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Selecione um estado')
      expect(listarMock).not.toHaveBeenCalled()
    })
  })

  describe('GET /:id/detalhe', () => {
    it('404 quando lançamento não existe', async () => {
      buscarPorIdMock.mockResolvedValue(null)
      const res = await app.inject({ method: 'GET', url: '/x/detalhe' })
      expect(res.statusCode).toBe(404)
    })

    it('renderiza modal com itens e contas', async () => {
      buscarPorIdMock.mockResolvedValue(LANCAMENTO)
      prisma.municipio.findUnique.mockResolvedValue(MUNICIPIO)
      prisma.conta.findMany.mockResolvedValue([
        { id: 'c1', codigo: '1.1.1.1.1.01.00', descricao: 'CAIXA' },
        { id: 'c2', codigo: '2.1.3.1.1.01.00', descricao: 'FORNECEDORES' },
      ])
      const res = await app.inject({ method: 'GET', url: '/l1/detalhe' })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('CAIXA')
      expect(res.body).toContain('FORNECEDORES')
      expect(res.body).toContain('Débito')
      expect(res.body).toContain('Crédito')
    })

    it('mostra placeholder quando conta referenciada não existe mais', async () => {
      buscarPorIdMock.mockResolvedValue(LANCAMENTO)
      prisma.municipio.findUnique.mockResolvedValue(MUNICIPIO)
      prisma.conta.findMany.mockResolvedValue([])  // contas removidas
      const res = await app.inject({ method: 'GET', url: '/l1/detalhe' })
      expect(res.body).toContain('&lt;conta removida&gt;')
    })

    it('renderiza com município null sem quebrar', async () => {
      buscarPorIdMock.mockResolvedValue(LANCAMENTO)
      prisma.municipio.findUnique.mockResolvedValue(null)
      prisma.conta.findMany.mockResolvedValue([])
      const res = await app.inject({ method: 'GET', url: '/l1/detalhe' })
      expect(res.statusCode).toBe(200)
    })
  })

  describe('DELETE /:id', () => {
    it('exclui com 200', async () => {
      excluirMock.mockResolvedValue(undefined)
      const res = await app.inject({ method: 'DELETE', url: '/l1' })
      expect(res.statusCode).toBe(200)
      expect(excluirMock).toHaveBeenCalledWith('l1')
    })

    it('400 quando service rejeita com Error', async () => {
      excluirMock.mockRejectedValue(new Error('Não encontrado'))
      const res = await app.inject({ method: 'DELETE', url: '/l1' })
      expect(res.statusCode).toBe(400)
      expect(res.body).toBe('Não encontrado')
    })

    it('400 com mensagem default para erro não-Error', async () => {
      excluirMock.mockRejectedValue('boom')
      const res = await app.inject({ method: 'DELETE', url: '/l1' })
      expect(res.body).toBe('Erro ao excluir.')
    })
  })
})
