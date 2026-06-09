import { describe, it, expect, beforeEach, vi } from 'vitest'

const { criarMock, atualizarMock, excluirMock } = vi.hoisted(() => ({
  criarMock: vi.fn(),
  atualizarMock: vi.fn(),
  excluirMock: vi.fn(),
}))

vi.mock('../../services/municipios.js', () => ({
  MunicipiosService: class {
    criar = criarMock
    atualizar = atualizarMock
    excluir = excluirMock
  },
}))

import { criarApp } from '../../routes/__tests__/helpers/criarApp.js'
import { adminMunicipiosRoutes } from '../municipios.js'
import type { FastifyInstance } from 'fastify'
import type { PrismaMock } from '../../services/__tests__/helpers/prisma-mock.js'

const ESTADO = {
  id: 'e1', nome: 'Minas Gerais', sigla: 'MG', modeloContabilId: 'm1',
  modeloContabil: { id: 'm1', descricao: 'PCASP-MG' },
}
const MUNICIPIO = {
  id: 'mun1', nome: 'Belo Horizonte', estadoId: 'e1', modeloContabilId: null,
  modeloContabil: null,
  estado: ESTADO,
}

function form(obj: Record<string, string>) {
  return {
    payload: new URLSearchParams(obj).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  }
}

describe('adminMunicipiosRoutes', () => {
  let app: FastifyInstance
  let prisma: PrismaMock

  beforeEach(async () => {
    [criarMock, atualizarMock, excluirMock].forEach((m) => m.mockReset())
    ;({ app, prisma } = await criarApp({
      registrar: adminMunicipiosRoutes,
      comView: true,
      simularAdmin: { sub: 'admin1', email: 'admin@x.com' },
    }))
  })

  describe('GET /', () => {
    it('renderiza com tabela vazia quando sem estadoId', async () => {
      prisma.estado.findMany.mockResolvedValue([ESTADO])
      const res = await app.inject({ method: 'GET', url: '/' })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Selecione um estado')
      expect(prisma.municipio.findMany).not.toHaveBeenCalled()
    })

    it('lista municípios do estado selecionado', async () => {
      prisma.estado.findMany.mockResolvedValue([ESTADO])
      prisma.municipio.findMany.mockResolvedValue([MUNICIPIO])
      const res = await app.inject({ method: 'GET', url: '/?estadoId=e1' })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Belo Horizonte')
      expect(prisma.municipio.findMany).toHaveBeenCalledWith({
        where: { estadoId: 'e1' },
        orderBy: { nome: 'asc' },
        include: { modeloContabil: { select: { id: true, descricao: true } } },
      })
      // drill-down para entidades + Planos ▾ usando o modelo HERDADO do estado (m1)
      expect(res.body).toContain('/admin/entidades?municipioId=mun1')
      expect(res.body).toContain('/admin/planos-de-contas?modeloContabilId=m1')
    })

    it('mostra "Herdado de UF" para município sem modelo próprio', async () => {
      prisma.estado.findMany.mockResolvedValue([ESTADO])
      prisma.municipio.findMany.mockResolvedValue([MUNICIPIO])
      const res = await app.inject({ method: 'GET', url: '/?estadoId=e1' })
      expect(res.body).toContain('Herdado de MG')
      expect(res.body).toContain('PCASP-MG')
    })

    it('mostra "Não atribuído" quando nem município nem estado têm modelo', async () => {
      const estSemModelo = { ...ESTADO, modeloContabilId: null, modeloContabil: null }
      prisma.estado.findMany.mockResolvedValue([estSemModelo])
      prisma.municipio.findMany.mockResolvedValue([{ ...MUNICIPIO, estado: estSemModelo }])
      const res = await app.inject({ method: 'GET', url: '/?estadoId=e1' })
      expect(res.body).toContain('Não atribuído')
    })
  })

  describe('GET /form', () => {
    it('400 quando estadoId ausente', async () => {
      const res = await app.inject({ method: 'GET', url: '/form' })
      expect(res.statusCode).toBe(400)
    })

    it('404 quando estado não existe', async () => {
      prisma.estado.findUnique.mockResolvedValue(null)
      const res = await app.inject({ method: 'GET', url: '/form?estadoId=xx' })
      expect(res.statusCode).toBe(404)
    })

    it('renderiza form com estado e modelos', async () => {
      prisma.estado.findUnique.mockResolvedValue(ESTADO)
      prisma.modeloContabil.findMany.mockResolvedValue([{ id: 'm1', descricao: 'PCASP-MG' }])
      const res = await app.inject({ method: 'GET', url: '/form?estadoId=e1' })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Novo Município')
      expect(res.body).toContain('PCASP-MG')
    })
  })

  describe('GET /:id/form', () => {
    it('404 quando município não existe', async () => {
      prisma.municipio.findUnique.mockResolvedValue(null)
      const res = await app.inject({ method: 'GET', url: '/mun1/form' })
      expect(res.statusCode).toBe(404)
    })

    it('renderiza form com município existente', async () => {
      prisma.municipio.findUnique.mockResolvedValue(MUNICIPIO)
      prisma.modeloContabil.findMany.mockResolvedValue([{ id: 'm1', descricao: 'PCASP-MG' }])
      const res = await app.inject({ method: 'GET', url: '/mun1/form' })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Editar Município')
      expect(res.body).toContain('Belo Horizonte')
    })
  })

  describe('POST /', () => {
    it('cria sem modelo (herda) e redireciona com estadoId', async () => {
      criarMock.mockResolvedValue(MUNICIPIO)
      const res = await app.inject({
        method: 'POST', url: '/',
        ...form({ nome: 'BH', estadoId: 'e1' }),
      })
      expect(res.statusCode).toBe(204)
      expect(res.headers['hx-redirect']).toBe('/admin/municipios?estadoId=e1')
      expect(criarMock).toHaveBeenCalledWith({ nome: 'BH', estadoId: 'e1' })
    })

    it('cria com modelo próprio', async () => {
      criarMock.mockResolvedValue(MUNICIPIO)
      await app.inject({
        method: 'POST', url: '/',
        ...form({ nome: 'BH', estadoId: 'e1', modeloContabilId: 'm9' }),
      })
      expect(criarMock).toHaveBeenCalledWith({ nome: 'BH', estadoId: 'e1', modeloContabilId: 'm9' })
    })

    it('erro quando nome vazio', async () => {
      prisma.estado.findUnique.mockResolvedValue(ESTADO)
      prisma.modeloContabil.findMany.mockResolvedValue([])
      const res = await app.inject({
        method: 'POST', url: '/',
        ...form({ nome: '   ', estadoId: 'e1' }),
      })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('O nome é obrigatório')
      expect(criarMock).not.toHaveBeenCalled()
    })

    it('erro quando estadoId vazio', async () => {
      prisma.estado.findUnique.mockResolvedValue(null)
      prisma.modeloContabil.findMany.mockResolvedValue([])
      const res = await app.inject({
        method: 'POST', url: '/',
        ...form({ nome: 'X', estadoId: '' }),
      })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('O estado é obrigatório')
    })

    it('captura erro do service', async () => {
      criarMock.mockRejectedValue(new Error('Município duplicado'))
      prisma.estado.findUnique.mockResolvedValue(ESTADO)
      prisma.modeloContabil.findMany.mockResolvedValue([])
      const res = await app.inject({
        method: 'POST', url: '/',
        ...form({ nome: 'BH', estadoId: 'e1' }),
      })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Município duplicado')
    })

    it('captura erro não-Error com mensagem padrão', async () => {
      criarMock.mockRejectedValue('boom')
      prisma.estado.findUnique.mockResolvedValue(ESTADO)
      prisma.modeloContabil.findMany.mockResolvedValue([])
      const res = await app.inject({
        method: 'POST', url: '/',
        ...form({ nome: 'BH', estadoId: 'e1' }),
      })
      expect(res.body).toContain('Erro ao criar município')
    })
  })

  describe('PUT /:id', () => {
    it('atualiza e redireciona com estadoId', async () => {
      atualizarMock.mockResolvedValue(MUNICIPIO)
      prisma.municipio.findUnique.mockResolvedValue({ estadoId: 'e1' })
      const res = await app.inject({
        method: 'PUT', url: '/mun1',
        ...form({ nome: 'BH', modeloContabilId: 'm9' }),
      })
      expect(res.statusCode).toBe(204)
      expect(res.headers['hx-redirect']).toBe('/admin/municipios?estadoId=e1')
      expect(atualizarMock).toHaveBeenCalledWith('mun1', { nome: 'BH', modeloContabilId: 'm9' })
    })

    it('string vazia em modeloContabilId → null (restaurar herança)', async () => {
      atualizarMock.mockResolvedValue(MUNICIPIO)
      prisma.municipio.findUnique.mockResolvedValue({ estadoId: 'e1' })
      await app.inject({
        method: 'PUT', url: '/mun1',
        ...form({ nome: 'BH', modeloContabilId: '' }),
      })
      expect(atualizarMock).toHaveBeenCalledWith('mun1', { nome: 'BH', modeloContabilId: null })
    })

    it('omite modeloContabilId no payload deixa o valor atual intocado', async () => {
      atualizarMock.mockResolvedValue(MUNICIPIO)
      prisma.municipio.findUnique.mockResolvedValue({ estadoId: 'e1' })
      await app.inject({ method: 'PUT', url: '/mun1', ...form({ nome: 'BH' }) })
      expect(atualizarMock).toHaveBeenCalledWith('mun1', { nome: 'BH' })
    })

    it('404 quando município não existe', async () => {
      prisma.municipio.findUnique.mockResolvedValue(null)
      const res = await app.inject({
        method: 'PUT', url: '/mun1',
        ...form({ nome: 'BH', modeloContabilId: 'm9' }),
      })
      expect(res.statusCode).toBe(404)
    })

    it('erro quando nome vazio', async () => {
      prisma.municipio.findUnique.mockResolvedValue(MUNICIPIO)
      prisma.modeloContabil.findMany.mockResolvedValue([])
      const res = await app.inject({
        method: 'PUT', url: '/mun1', ...form({ nome: '' }),
      })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('O nome é obrigatório')
    })

    it('captura erro do service', async () => {
      atualizarMock.mockRejectedValue(new Error('Conflito'))
      prisma.municipio.findUnique
        .mockResolvedValueOnce({ estadoId: 'e1' }) // lookup pro update
        .mockResolvedValueOnce(MUNICIPIO) // re-render
      prisma.modeloContabil.findMany.mockResolvedValue([])
      const res = await app.inject({
        method: 'PUT', url: '/mun1',
        ...form({ nome: 'BH', modeloContabilId: 'm9' }),
      })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Conflito')
    })

    it('captura erro não-Error com mensagem padrão', async () => {
      atualizarMock.mockRejectedValue('boom')
      prisma.municipio.findUnique
        .mockResolvedValueOnce({ estadoId: 'e1' })
        .mockResolvedValueOnce(MUNICIPIO)
      prisma.modeloContabil.findMany.mockResolvedValue([])
      const res = await app.inject({
        method: 'PUT', url: '/mun1',
        ...form({ nome: 'BH', modeloContabilId: 'm9' }),
      })
      expect(res.body).toContain('Erro ao atualizar município')
    })
  })

  describe('DELETE /:id', () => {
    it('exclui com 200', async () => {
      excluirMock.mockResolvedValue(undefined)
      const res = await app.inject({ method: 'DELETE', url: '/mun1' })
      expect(res.statusCode).toBe(200)
    })

    it('400 quando service rejeita', async () => {
      excluirMock.mockRejectedValue(new Error('Tem lançamentos'))
      const res = await app.inject({ method: 'DELETE', url: '/mun1' })
      expect(res.statusCode).toBe(400)
      expect(res.body).toBe('Tem lançamentos')
    })

    it('400 com mensagem padrão para erro não-Error', async () => {
      excluirMock.mockRejectedValue('boom')
      const res = await app.inject({ method: 'DELETE', url: '/mun1' })
      expect(res.body).toBe('Erro ao excluir.')
    })
  })
})
