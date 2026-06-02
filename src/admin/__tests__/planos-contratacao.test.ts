import { describe, it, expect, beforeEach, vi } from 'vitest'

const { listarMock, buscarMock, criarMock, atualizarMock, alterarStatusMock, excluirMock } = vi.hoisted(() => ({
  listarMock: vi.fn(),
  buscarMock: vi.fn(),
  criarMock: vi.fn(),
  atualizarMock: vi.fn(),
  alterarStatusMock: vi.fn(),
  excluirMock: vi.fn(),
}))

vi.mock('../../services/planos-contratacao.js', () => ({
  PlanosContratacaoService: class {
    listar = listarMock
    buscarPorId = buscarMock
    criar = criarMock
    atualizar = atualizarMock
    alterarStatus = alterarStatusMock
    excluir = excluirMock
  },
}))

import { criarApp } from '../../routes/__tests__/helpers/criarApp.js'
import { adminPlanosContratacaoRoutes } from '../planos-contratacao.js'
import type { FastifyInstance } from 'fastify'
import type { PrismaMock } from '../../services/__tests__/helpers/prisma-mock.js'

const ENTIDADE = {
  id: 'ent1',
  nome: 'Prefeitura',
  municipio: { nome: 'Curitiba', estado: { sigla: 'PR', nome: 'Paraná' } },
}

const PCA = {
  id: 'pca1',
  entidadeId: 'ent1',
  ano: 2026,
  status: 'RASCUNHO',
  observacoes: null,
  _count: { itens: 1, demandas: 0 },
  itens: [{ itemCatalogoId: 'c1', quantidadeEstimada: 10, valorUnitarioEstimado: 5 }],
}

const CATALOGO = [{ id: 'c1', tipo: 'MATERIAL', codigo: '123', descricao: 'Caneta', unidadeMedida: 'UN' }]

function form(obj: Record<string, string>) {
  return { payload: new URLSearchParams(obj).toString(), headers: { 'content-type': 'application/x-www-form-urlencoded' } }
}

describe('adminPlanosContratacaoRoutes', () => {
  let app: FastifyInstance
  let prisma: PrismaMock

  beforeEach(async () => {
    ;[listarMock, buscarMock, criarMock, atualizarMock, alterarStatusMock, excluirMock].forEach((m) => m.mockReset())
    ;({ app, prisma } = await criarApp({
      registrar: adminPlanosContratacaoRoutes,
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

    it('com entidade lista planos', async () => {
      prisma.estado.findMany.mockResolvedValue([])
      prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
      listarMock.mockResolvedValue([PCA])
      const res = await app.inject({ method: 'GET', url: '/?estadoId=e1&municipioId=mun1&entidadeId=ent1' })
      expect(listarMock).toHaveBeenCalledWith('ent1')
      expect(res.body).toContain('2026')
      expect(res.body).toContain('Rascunho')
    })
  })

  describe('GET form', () => {
    it('/form sem entidadeId → 400', async () => {
      const res = await app.inject({ method: 'GET', url: '/form' })
      expect(res.statusCode).toBe(400)
    })

    it('/form renderiza com catálogo', async () => {
      prisma.itemCatalogo.findMany.mockResolvedValue(CATALOGO)
      const res = await app.inject({ method: 'GET', url: '/form?entidadeId=ent1' })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Novo PCA')
    })

    it('/:id/form 404 quando não existe', async () => {
      buscarMock.mockResolvedValue(null)
      const res = await app.inject({ method: 'GET', url: '/pca1/form' })
      expect(res.statusCode).toBe(404)
    })

    it('/:id/form renderiza edição com itens', async () => {
      buscarMock.mockResolvedValue(PCA)
      prisma.itemCatalogo.findMany.mockResolvedValue(CATALOGO)
      const res = await app.inject({ method: 'GET', url: '/pca1/form' })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Editar PCA')
    })
  })

  describe('POST /', () => {
    it('cria com itens do JSON', async () => {
      criarMock.mockResolvedValue(PCA)
      const itensJson = JSON.stringify([{ itemCatalogoId: 'c1', quantidadeEstimada: '10', valorUnitarioEstimado: '5' }])
      const res = await app.inject({
        method: 'POST',
        url: '/',
        ...form({ entidadeId: 'ent1', ano: '2026', observacoes: 'x', itensJson }),
      })
      expect(res.statusCode).toBe(204)
      expect(res.headers['hx-redirect']).toContain('entidadeId=ent1')
      expect(criarMock).toHaveBeenCalledWith('ent1', 2026, {
        observacoes: 'x',
        itens: [{ itemCatalogoId: 'c1', quantidadeEstimada: '10', valorUnitarioEstimado: '5' }],
      })
    })

    it('erro re-renderiza form', async () => {
      criarMock.mockRejectedValue(new Error('Já existe um PCA'))
      prisma.itemCatalogo.findMany.mockResolvedValue(CATALOGO)
      const res = await app.inject({ method: 'POST', url: '/', ...form({ entidadeId: 'ent1', ano: '2026', itensJson: '[]' }) })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Já existe um PCA')
    })
  })

  describe('POST /:id/status', () => {
    it('status inválido → 400', async () => {
      const res = await app.inject({ method: 'POST', url: '/pca1/status', ...form({ status: 'XX' }) })
      expect(res.statusCode).toBe(400)
    })

    it('aprova e devolve HX-Redirect', async () => {
      prisma.planoContratacaoAnual.findUnique.mockResolvedValue({ id: 'pca1', entidadeId: 'ent1' })
      alterarStatusMock.mockResolvedValue({ id: 'pca1' })
      const res = await app.inject({ method: 'POST', url: '/pca1/status', ...form({ status: 'APROVADO' }) })
      expect(res.statusCode).toBe(204)
      expect(alterarStatusMock).toHaveBeenCalledWith('pca1', 'APROVADO')
    })
  })

  describe('DELETE /:id', () => {
    it('exclui com 200', async () => {
      excluirMock.mockResolvedValue(undefined)
      const res = await app.inject({ method: 'DELETE', url: '/pca1' })
      expect(res.statusCode).toBe(200)
    })

    it('erro vira 400', async () => {
      excluirMock.mockRejectedValue(new Error('tem demandas'))
      const res = await app.inject({ method: 'DELETE', url: '/pca1' })
      expect(res.statusCode).toBe(400)
    })
  })
})
