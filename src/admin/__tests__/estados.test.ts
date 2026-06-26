import { describe, it, expect, beforeEach, vi } from 'vitest'

const { definirModeloMock } = vi.hoisted(() => ({
  definirModeloMock: vi.fn(),
}))

vi.mock('../../services/estados.js', () => ({
  EstadosService: class {
    definirModelo = definirModeloMock
  },
}))

import { criarApp } from '../../routes/__tests__/helpers/criarApp.js'
import { adminEstadosRoutes } from '../estados.js'
import type { FastifyInstance } from 'fastify'
import type { PrismaMock } from '../../services/__tests__/helpers/prisma-mock.js'

const ESTADO = {
  id: 'e1', nome: 'Minas Gerais', sigla: 'MG', modeloContabilId: 'm1',
  modeloContabil: { id: 'm1', descricao: 'PCASP-MG' },
  _count: { municipios: 853 },
}
const ESTADO_SEM_MODELO = { ...ESTADO, modeloContabilId: null, modeloContabil: null }

function form(obj: Record<string, string>) {
  return {
    payload: new URLSearchParams(obj).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  }
}

describe('adminEstadosRoutes', () => {
  let app: FastifyInstance
  let prisma: PrismaMock

  beforeEach(async () => {
    definirModeloMock.mockReset()
    ;({ app, prisma } = await criarApp({
      registrar: adminEstadosRoutes,
      comView: true,
      simularAdmin: { sub: 'admin1', email: 'admin@x.com' },
    }))
  })

  describe('GET /', () => {
    it('lista estados com modeloContabil e _count', async () => {
      prisma.estado.findMany.mockResolvedValue([ESTADO])
      const res = await app.inject({ method: 'GET', url: '/' })
      expect(res.statusCode).toBe(200)
      expect(prisma.estado.findMany).toHaveBeenCalledWith({
        orderBy: { nome: 'asc' },
        include: {
          modeloContabil: { select: { id: true, descricao: true } },
          _count: { select: { municipios: true } },
        },
      })
      expect(res.body).toContain('PCASP-MG')
      expect(res.body).toContain('Minas Gerais')
      // drill-down para municípios do estado + Planos ▾ do modelo
      expect(res.body).toContain('/admin/municipios?estadoId=e1')
      expect(res.body).toContain('/admin/planos-de-contas?modeloContabilId=m1')
      expect(res.body).toContain('/admin/planos-contas-receita?modeloContabilId=m1')
    })

    it('não mostra Planos quando o estado não tem modelo', async () => {
      prisma.estado.findMany.mockResolvedValue([ESTADO_SEM_MODELO])
      const res = await app.inject({ method: 'GET', url: '/' })
      expect(res.body).not.toContain('planos-de-contas?modeloContabilId=')
    })

    it('mostra "Não atribuído" para estado sem modelo', async () => {
      prisma.estado.findMany.mockResolvedValue([ESTADO_SEM_MODELO])
      const res = await app.inject({ method: 'GET', url: '/' })
      expect(res.body).toContain('Não atribuído')
    })
  })

  describe('GET /:id/form', () => {
    it('404 quando estado não existe', async () => {
      prisma.estado.findUnique.mockResolvedValue(null)
      const res = await app.inject({ method: 'GET', url: '/xx/form' })
      expect(res.statusCode).toBe(404)
    })

    it('renderiza form com select de modelos', async () => {
      prisma.estado.findUnique.mockResolvedValue(ESTADO)
      prisma.modeloContabil.findMany.mockResolvedValue([{ id: 'm1', descricao: 'PCASP-MG' }])
      const res = await app.inject({ method: 'GET', url: '/e1/form' })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Minas Gerais')
      expect(res.body).toContain('PCASP-MG')
      expect(res.body).toContain('853') // contagem de municípios afetados
    })

    it('avisa quando nenhum modelo cadastrado', async () => {
      prisma.estado.findUnique.mockResolvedValue(ESTADO_SEM_MODELO)
      prisma.modeloContabil.findMany.mockResolvedValue([])
      const res = await app.inject({ method: 'GET', url: '/e1/form' })
      expect(res.body).toContain('Cadastre um modelo')
    })
  })

  describe('PUT /:id', () => {
    it('atribui modelo e dispara propagação', async () => {
      definirModeloMock.mockResolvedValue({ estado: ESTADO, municipiosAtualizados: 853 })
      const res = await app.inject({
        method: 'PUT', url: '/e1',
        ...form({ modeloContabilId: 'm1' }),
      })
      expect(res.statusCode).toBe(204)
      expect(res.headers['hx-redirect']).toBe('/admin/estados')
      expect(definirModeloMock).toHaveBeenCalledWith('e1', 'm1')
      expect(res.headers['hx-trigger']).toContain('853')
    })

    it('salva o formato de código da LOA do estado', async () => {
      definirModeloMock.mockResolvedValue({ estado: ESTADO, municipiosAtualizados: 0 })
      await app.inject({
        method: 'PUT',
        url: '/e1',
        ...form({ modeloContabilId: '', loaCodigoModo: 'NIVEL', loaCodigoNivel: '3' }),
      })
      expect(prisma.estado.update).toHaveBeenCalledWith({
        where: { id: 'e1' },
        data: { loaCodigoModo: 'NIVEL', loaCodigoNivel: 3 },
      })
    })

    it('passa null quando modeloContabilId é string vazia', async () => {
      definirModeloMock.mockResolvedValue({ estado: ESTADO, municipiosAtualizados: 10 })
      await app.inject({ method: 'PUT', url: '/e1', ...form({ modeloContabilId: '' }) })
      expect(definirModeloMock).toHaveBeenCalledWith('e1', null)
    })

    it('passa null quando modeloContabilId é só espaços', async () => {
      definirModeloMock.mockResolvedValue({ estado: ESTADO, municipiosAtualizados: 0 })
      await app.inject({ method: 'PUT', url: '/e1', ...form({ modeloContabilId: '   ' }) })
      expect(definirModeloMock).toHaveBeenCalledWith('e1', null)
    })

    it('re-renderiza form com erro do service', async () => {
      definirModeloMock.mockRejectedValue(new Error('Modelo não existe'))
      prisma.estado.findUnique.mockResolvedValue(ESTADO)
      prisma.modeloContabil.findMany.mockResolvedValue([])
      const res = await app.inject({
        method: 'PUT', url: '/e1', ...form({ modeloContabilId: 'mx' }),
      })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Modelo não existe')
    })

    it('captura erro não-Error com mensagem padrão', async () => {
      definirModeloMock.mockRejectedValue('boom')
      prisma.estado.findUnique.mockResolvedValue(ESTADO)
      prisma.modeloContabil.findMany.mockResolvedValue([])
      const res = await app.inject({
        method: 'PUT', url: '/e1', ...form({ modeloContabilId: 'mx' }),
      })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Erro ao atualizar')
    })
  })
})
