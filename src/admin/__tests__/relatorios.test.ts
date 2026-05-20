import { describe, it, expect, beforeEach, vi } from 'vitest'

const { criarFixoMock, atualizarFixoMock, excluirFixoMock } = vi.hoisted(() => ({
  criarFixoMock: vi.fn(),
  atualizarFixoMock: vi.fn(),
  excluirFixoMock: vi.fn(),
}))

vi.mock('../../services/relatorios.js', () => ({
  RelatoriosService: class {
    criarFixo = criarFixoMock
    atualizarFixo = atualizarFixoMock
    excluirFixo = excluirFixoMock
  },
}))

import { criarApp } from '../../routes/__tests__/helpers/criarApp.js'
import { adminRelatoriosRoutes } from '../relatorios.js'
import type { FastifyInstance } from 'fastify'
import type { PrismaMock } from '../../services/__tests__/helpers/prisma-mock.js'

const RELATORIO = {
  id: 'r1',
  nome: 'Vendas',
  descricao: '',
  rota: '/vendas',
  sistemaId: 's1',
  sistema: { nome: 'ERP' },
}

function form(obj: Record<string, string>) {
  return {
    payload: new URLSearchParams(obj).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  }
}

describe('adminRelatoriosRoutes', () => {
  let app: FastifyInstance
  let prisma: PrismaMock

  beforeEach(async () => {
    [criarFixoMock, atualizarFixoMock, excluirFixoMock].forEach(m => m.mockReset())
    ;({ app, prisma } = await criarApp({
      registrar: adminRelatoriosRoutes,
      comView: true,
      simularAdmin: { sub: 'admin1', email: 'admin@x.com' },
    }))
  })

  describe('GET /', () => {
    it('lista relatórios sem filtro', async () => {
      prisma.relatorioFixo.findMany.mockResolvedValue([])
      prisma.sistema.findMany.mockResolvedValue([])
      const res = await app.inject({ method: 'GET', url: '/' })
      expect(res.statusCode).toBe(200)
      expect(prisma.relatorioFixo.findMany).toHaveBeenCalledWith(
        expect.not.objectContaining({ where: expect.anything() }),
      )
    })

    it('filtra por sistemaId', async () => {
      prisma.relatorioFixo.findMany.mockResolvedValue([])
      prisma.sistema.findMany.mockResolvedValue([])
      await app.inject({ method: 'GET', url: '/?sistemaId=s1' })
      expect(prisma.relatorioFixo.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { sistemaId: 's1' },
      }))
    })
  })

  describe('GET /form', () => {
    it('renderiza form vazio', async () => {
      const res = await app.inject({ method: 'GET', url: '/form' })
      expect(res.statusCode).toBe(200)
    })
  })

  describe('GET /:id/form', () => {
    it('retorna 404 se relatório não existe', async () => {
      prisma.relatorioFixo.findUnique.mockResolvedValue(null)
      const res = await app.inject({ method: 'GET', url: '/r1/form' })
      expect(res.statusCode).toBe(404)
    })

    it('renderiza form com relatório', async () => {
      prisma.relatorioFixo.findUnique.mockResolvedValue(RELATORIO)
      const res = await app.inject({ method: 'GET', url: '/r1/form' })
      expect(res.statusCode).toBe(200)
    })
  })

  describe('POST /', () => {
    it('valida sistemaId obrigatório', async () => {
      const res = await app.inject({
        method: 'POST', url: '/',
        ...form({ nome: 'X', descricao: '', rota: '/x', sistemaId: '' }),
      })
      expect(res.statusCode).toBe(200)
      expect(res.body).toMatch(/Selecione um sistema/)
      expect(criarFixoMock).not.toHaveBeenCalled()
    })

    it('valida nome obrigatório', async () => {
      const res = await app.inject({
        method: 'POST', url: '/',
        ...form({ nome: '   ', descricao: '', rota: '/x', sistemaId: 's1' }),
      })
      expect(res.statusCode).toBe(200)
      expect(res.body).toMatch(/nome é obrigatório/i)
    })

    it('valida rota obrigatória', async () => {
      const res = await app.inject({
        method: 'POST', url: '/',
        ...form({ nome: 'X', descricao: '', rota: '   ', sistemaId: 's1' }),
      })
      expect(res.statusCode).toBe(200)
      expect(res.body).toMatch(/rota é obrigatória/i)
    })

    it('cria relatório e redireciona', async () => {
      criarFixoMock.mockResolvedValue({ id: 'r1' })

      const res = await app.inject({
        method: 'POST', url: '/',
        ...form({ nome: 'X', descricao: 'desc', rota: '/x', sistemaId: 's1' }),
      })

      expect(res.statusCode).toBe(204)
      expect(res.headers['hx-redirect']).toBe('/admin/relatorios')
      expect(criarFixoMock).toHaveBeenCalledWith('s1', { nome: 'X', rota: '/x', descricao: 'desc' })
    })

    it('omite descricao quando vazia', async () => {
      criarFixoMock.mockResolvedValue({ id: 'r1' })
      await app.inject({
        method: 'POST', url: '/',
        ...form({ nome: 'X', descricao: '', rota: '/x', sistemaId: 's1' }),
      })
      expect(criarFixoMock).toHaveBeenCalledWith('s1', { nome: 'X', rota: '/x' })
    })

    it('renderiza form com erro quando service falha', async () => {
      criarFixoMock.mockRejectedValue(new Error('Nome duplicado.'))
      const res = await app.inject({
        method: 'POST', url: '/',
        ...form({ nome: 'X', descricao: '', rota: '/x', sistemaId: 's1' }),
      })
      expect(res.body).toContain('Nome duplicado.')
    })
  })

  describe('PUT /:id', () => {
    it('valida campos obrigatórios', async () => {
      prisma.relatorioFixo.findUnique.mockResolvedValue(RELATORIO)
      const res = await app.inject({
        method: 'PUT', url: '/r1',
        ...form({ nome: '', descricao: '', rota: '' }),
      })
      expect(res.statusCode).toBe(200)
      expect(res.body).toMatch(/obrigatóri/)
    })

    it('atualiza e redireciona', async () => {
      atualizarFixoMock.mockResolvedValue(undefined)
      const res = await app.inject({
        method: 'PUT', url: '/r1',
        ...form({ nome: 'Novo', descricao: 'd', rota: '/n', ativo: 'true' }),
      })
      expect(res.statusCode).toBe(204)
      expect(res.headers['hx-redirect']).toBe('/admin/relatorios')
      expect(atualizarFixoMock).toHaveBeenCalledWith('r1', {
        nome: 'Novo', rota: '/n', descricao: 'd', ativo: true,
      })
    })

    it('renderiza form com erro quando atualização falha', async () => {
      atualizarFixoMock.mockRejectedValue(new Error('Falhou.'))
      prisma.relatorioFixo.findUnique.mockResolvedValue(RELATORIO)
      const res = await app.inject({
        method: 'PUT', url: '/r1',
        ...form({ nome: 'X', descricao: '', rota: '/x' }),
      })
      expect(res.body).toContain('Falhou.')
    })
  })

  describe('DELETE /:id', () => {
    it('exclui e retorna 200', async () => {
      excluirFixoMock.mockResolvedValue(undefined)
      const res = await app.inject({ method: 'DELETE', url: '/r1' })
      expect(res.statusCode).toBe(200)
      expect(excluirFixoMock).toHaveBeenCalledWith('r1')
    })

    it('retorna 400 com mensagem quando falha', async () => {
      excluirFixoMock.mockRejectedValue(new Error('Em uso.'))
      const res = await app.inject({ method: 'DELETE', url: '/r1' })
      expect(res.statusCode).toBe(400)
      expect(res.body).toBe('Em uso.')
    })
  })
})
