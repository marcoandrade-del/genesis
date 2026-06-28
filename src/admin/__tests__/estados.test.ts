import { describe, it, expect, beforeEach, vi } from 'vitest'

const { definirModeloMock, proporMock, lerXlsxMock } = vi.hoisted(() => ({
  definirModeloMock: vi.fn(),
  proporMock: vi.fn(),
  lerXlsxMock: vi.fn(),
}))

vi.mock('../../services/estados.js', () => ({
  EstadosService: class {
    definirModelo = definirModeloMock
  },
}))
vi.mock('../../services/rcl-import-ia.js', () => ({ RclImportIaService: class { proporComposicao = proporMock } }))
vi.mock('../../services/rcl-xlsx.js', () => ({ lerXlsxBase64: lerXlsxMock }))

import { criarApp } from '../../routes/__tests__/helpers/criarApp.js'
import { adminEstadosRoutes } from '../estados.js'
import { ErroNegocio } from '../../errors.js'
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
      expect(prisma.estado.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'e1' }, data: expect.objectContaining({ loaCodigoModo: 'NIVEL', loaCodigoNivel: 3 }) }),
      )
    })

    it('salva a composição da RCL (JSON válido) e ignora JSON inválido', async () => {
      definirModeloMock.mockResolvedValue({ estado: ESTADO, municipiosAtualizados: 0 })
      const cfg = JSON.stringify({ nome: 'TCE-PR', deducoes: [{ rotulo: 'FUNDEB', prefixos: ['1.7.5.1.50'] }] })
      await app.inject({ method: 'PUT', url: '/e1', ...form({ modeloContabilId: '', rclComposicao: cfg }) })
      expect(prisma.estado.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ rclComposicao: { nome: 'TCE-PR', deducoes: [{ rotulo: 'FUNDEB', prefixos: ['1.7.5.1.50'] }] } }) }),
      )

      prisma.estado.update.mockClear()
      await app.inject({ method: 'PUT', url: '/e1', ...form({ modeloContabilId: '', rclComposicao: 'isto não é json' }) })
      // JSON inválido → limpa (DbNull), não persiste lixo
      const data = prisma.estado.update.mock.calls[0]![0].data
      expect(data.rclComposicao).not.toEqual({ nome: 'TCE-PR' })
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

  describe('POST /:id/rcl-import (IA)', () => {
    beforeEach(() => {
      proporMock.mockReset()
      lerXlsxMock.mockReset().mockResolvedValue('grade de texto da planilha')
    })

    it('re-renderiza o form com a composição proposta pela IA (revisão)', async () => {
      prisma.estado.findUnique.mockResolvedValue(ESTADO)
      prisma.modeloContabil.findMany.mockResolvedValue([])
      proporMock.mockResolvedValue({ nome: 'TCE-PR', deducoes: [{ rotulo: 'FUNDEB', prefixos: ['1.7.5.1.50'] }] })
      const res = await app.inject({ method: 'POST', url: '/e1/rcl-import', ...form({ planilhaBase64: 'QQ==' }) })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Proposta da IA')
      expect(res.body).toContain('TCE-PR')
      expect(res.body).toContain('FUNDEB')
      expect(lerXlsxMock).toHaveBeenCalled()
      expect(proporMock).toHaveBeenCalledWith('admin1', 'grade de texto da planilha')
    })

    it('motor sem chave → form com aviso (não quebra)', async () => {
      prisma.estado.findUnique.mockResolvedValue(ESTADO)
      prisma.modeloContabil.findMany.mockResolvedValue([])
      proporMock.mockRejectedValue(new ErroNegocio('IA_NAO_CONFIGURADA', 'IA por Google · Gemini 2.5 Pro não configurada — defina GEMINI_API_KEY no .env.'))
      const res = await app.inject({ method: 'POST', url: '/e1/rcl-import', ...form({ planilhaBase64: 'QQ==' }) })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('não configurada')
    })

    it('estado inexistente → 404', async () => {
      prisma.estado.findUnique.mockResolvedValue(null)
      const res = await app.inject({ method: 'POST', url: '/e9/rcl-import', ...form({ planilhaBase64: 'QQ==' }) })
      expect(res.statusCode).toBe(404)
    })
  })
})
