import { describe, it, expect, beforeEach, vi } from 'vitest'

const { listarMock, buscarMock, criarMock, atualizarMock, alterarStatusMock, excluirMock } = vi.hoisted(() => ({
  listarMock: vi.fn(),
  buscarMock: vi.fn(),
  criarMock: vi.fn(),
  atualizarMock: vi.fn(),
  alterarStatusMock: vi.fn(),
  excluirMock: vi.fn(),
}))
const { trBuscarMock, trCriarMock, trAtualizarMock, trExcluirMock } = vi.hoisted(() => ({
  trBuscarMock: vi.fn(),
  trCriarMock: vi.fn(),
  trAtualizarMock: vi.fn(),
  trExcluirMock: vi.fn(),
}))

vi.mock('../../services/documentos-demanda.js', () => ({
  DocumentosDemandaService: class {
    listar = listarMock
    buscarPorId = buscarMock
    criar = criarMock
    atualizar = atualizarMock
    alterarStatus = alterarStatusMock
    excluir = excluirMock
  },
}))
vi.mock('../../services/termos-referencia.js', () => ({
  TermosReferenciaService: class {
    buscarPorDemanda = trBuscarMock
    criar = trCriarMock
    atualizar = trAtualizarMock
    excluir = trExcluirMock
  },
}))

import { criarApp } from '../../routes/__tests__/helpers/criarApp.js'
import { adminDocumentosDemandaRoutes } from '../documentos-demanda.js'
import type { FastifyInstance } from 'fastify'
import type { PrismaMock } from '../../services/__tests__/helpers/prisma-mock.js'

const ENTIDADE = { id: 'ent1', nome: 'Prefeitura', municipio: { nome: 'Curitiba', estado: { sigla: 'PR', nome: 'Paraná' } } }
const DOD = {
  id: 'dod1',
  entidadeId: 'ent1',
  ano: 2026,
  numero: '2026/0001',
  status: 'RASCUNHO',
  justificativa: 'x',
  unidadeOrcamentaria: { codigo: '02.001', nome: 'Educação' },
  _count: { itens: 1 },
  termoReferencia: null,
  itens: [{ itemCatalogoId: 'c1', quantidade: 10 }],
}

function form(obj: Record<string, string>) {
  return { payload: new URLSearchParams(obj).toString(), headers: { 'content-type': 'application/x-www-form-urlencoded' } }
}

describe('adminDocumentosDemandaRoutes', () => {
  let app: FastifyInstance
  let prisma: PrismaMock

  beforeEach(async () => {
    ;[listarMock, buscarMock, criarMock, atualizarMock, alterarStatusMock, excluirMock, trBuscarMock, trCriarMock, trAtualizarMock, trExcluirMock].forEach((m) => m.mockReset())
    ;({ app, prisma } = await criarApp({
      registrar: adminDocumentosDemandaRoutes,
      comView: true,
      simularAdmin: { sub: 'a1', email: 'a@x.com' },
    }))
  })

  describe('GET /', () => {
    it('sem entidade mostra picker', async () => {
      prisma.estado.findMany.mockResolvedValue([])
      const res = await app.inject({ method: 'GET', url: '/' })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Selecione estado')
    })

    it('com entidade lista demandas', async () => {
      prisma.estado.findMany.mockResolvedValue([])
      prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
      listarMock.mockResolvedValue([DOD])
      const res = await app.inject({ method: 'GET', url: '/?estadoId=e1&municipioId=mun1&entidadeId=ent1' })
      expect(listarMock).toHaveBeenCalledWith('ent1')
      expect(res.body).toContain('2026/0001')
      expect(res.body).toContain('Rascunho')
    })
  })

  describe('GET form', () => {
    it('/form sem entidadeId → 400', async () => {
      const res = await app.inject({ method: 'GET', url: '/form' })
      expect(res.statusCode).toBe(400)
    })
    it('/form renderiza', async () => {
      const res = await app.inject({ method: 'GET', url: '/form?entidadeId=ent1' })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Nova Demanda')
    })
    it('/:id/form 404 quando não existe', async () => {
      buscarMock.mockResolvedValue(null)
      const res = await app.inject({ method: 'GET', url: '/dod1/form' })
      expect(res.statusCode).toBe(404)
    })
    it('/:id/form renderiza edição', async () => {
      buscarMock.mockResolvedValue(DOD)
      const res = await app.inject({ method: 'GET', url: '/dod1/form' })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Editar Demanda')
    })
  })

  describe('POST / (create DOD)', () => {
    it('cria com itens e PCA opcional', async () => {
      criarMock.mockResolvedValue(DOD)
      const itensJson = JSON.stringify([{ itemCatalogoId: 'c1', quantidade: '10' }])
      const res = await app.inject({
        method: 'POST',
        url: '/',
        ...form({ entidadeId: 'ent1', ano: '2026', numero: '2026/0001', unidadeOrcamentariaId: 'uo1', justificativa: 'x', itensJson }),
      })
      expect(res.statusCode).toBe(204)
      expect(criarMock).toHaveBeenCalledWith('ent1', {
        ano: 2026,
        numero: '2026/0001',
        unidadeOrcamentariaId: 'uo1',
        justificativa: 'x',
        itens: [{ itemCatalogoId: 'c1', quantidade: '10' }],
      })
    })
  })

  describe('status / parecer', () => {
    it('GET /:id/parecer renderiza modal', async () => {
      prisma.documentoDemanda.findUnique.mockResolvedValue({ id: 'dod1', numero: '2026/0001' })
      const res = await app.inject({ method: 'GET', url: '/dod1/parecer' })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Parecer Jurídico')
    })

    it('POST /:id/status com status inválido → 400', async () => {
      const res = await app.inject({ method: 'POST', url: '/dod1/status', ...form({ status: 'XX' }) })
      expect(res.statusCode).toBe(400)
    })

    it('POST /:id/status APROVADA passa parecer', async () => {
      prisma.documentoDemanda.findUnique.mockResolvedValue({ entidadeId: 'ent1' })
      alterarStatusMock.mockResolvedValue({ id: 'dod1' })
      const res = await app.inject({ method: 'POST', url: '/dod1/status', ...form({ status: 'APROVADA', responsavel: 'Ana', observacao: 'ok' }) })
      expect(res.statusCode).toBe(204)
      expect(alterarStatusMock).toHaveBeenCalledWith('dod1', 'APROVADA', { responsavel: 'Ana', observacao: 'ok' })
    })
  })

  describe('TR', () => {
    it('GET /:id/termo/form (sem TR ainda) renderiza', async () => {
      buscarMock.mockResolvedValue(DOD)
      trBuscarMock.mockResolvedValue(null)
      const res = await app.inject({ method: 'GET', url: '/dod1/termo/form' })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Termo de Referência')
    })

    it('POST /:id/termo cria TR', async () => {
      prisma.documentoDemanda.findUnique.mockResolvedValue({ entidadeId: 'ent1' })
      trCriarMock.mockResolvedValue({ id: 'tr1' })
      const itensJson = JSON.stringify([{ itemCatalogoId: 'c1', quantidade: '10', precoUnitarioEstimado: '5' }])
      const res = await app.inject({ method: 'POST', url: '/dod1/termo', ...form({ objeto: 'Material', itensJson }) })
      expect(res.statusCode).toBe(204)
      expect(trCriarMock).toHaveBeenCalledWith('dod1', {
        objeto: 'Material',
        observacoes: undefined,
        itens: [{ itemCatalogoId: 'c1', quantidade: '10', precoUnitarioEstimado: '5' }],
      })
    })

    it('PUT /termo/:trId atualiza TR', async () => {
      trAtualizarMock.mockResolvedValue({ documentoDemandaId: 'dod1' })
      prisma.documentoDemanda.findUnique.mockResolvedValue({ entidadeId: 'ent1' })
      const res = await app.inject({ method: 'PUT', url: '/termo/tr1', ...form({ objeto: 'Novo', itensJson: '[]' }) })
      expect(res.statusCode).toBe(204)
      expect(trAtualizarMock).toHaveBeenCalledWith('tr1', { objeto: 'Novo', observacoes: undefined, itens: [] })
    })

    it('DELETE /termo/:trId remove e redireciona', async () => {
      prisma.termoReferencia.findUnique.mockResolvedValue({ documentoDemanda: { entidadeId: 'ent1' } })
      trExcluirMock.mockResolvedValue(undefined)
      const res = await app.inject({ method: 'DELETE', url: '/termo/tr1' })
      expect(res.statusCode).toBe(204)
      expect(res.headers['hx-redirect']).toContain('entidadeId=ent1')
      expect(trExcluirMock).toHaveBeenCalledWith('tr1')
    })
  })

  describe('DELETE /:id', () => {
    it('exclui com 200', async () => {
      excluirMock.mockResolvedValue(undefined)
      const res = await app.inject({ method: 'DELETE', url: '/dod1' })
      expect(res.statusCode).toBe(200)
    })
  })
})
