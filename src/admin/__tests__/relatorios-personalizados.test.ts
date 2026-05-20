import { describe, it, expect, beforeEach, vi } from 'vitest'

const { criarPersonalizadoMock, atualizarPersonalizadoMock, excluirPersonalizadoMock } = vi.hoisted(() => ({
  criarPersonalizadoMock: vi.fn(),
  atualizarPersonalizadoMock: vi.fn(),
  excluirPersonalizadoMock: vi.fn(),
}))

vi.mock('../../services/relatorios.js', () => ({
  RelatoriosService: class {
    criarPersonalizado = criarPersonalizadoMock
    atualizarPersonalizado = atualizarPersonalizadoMock
    excluirPersonalizado = excluirPersonalizadoMock
  },
}))

import { criarApp } from '../../routes/__tests__/helpers/criarApp.js'
import { adminRelatoriosPersonalizadosRoutes } from '../relatorios-personalizados.js'
import type { FastifyInstance } from 'fastify'
import type { PrismaMock } from '../../services/__tests__/helpers/prisma-mock.js'

const RELATORIO = {
  id: 'rp1',
  nome: 'Custom',
  descricao: '',
  configuracao: {},
  usuarioId: 'u1',
  usuario: { nomeCompleto: 'Maria' },
}

function form(obj: Record<string, string>) {
  return {
    payload: new URLSearchParams(obj).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  }
}

describe('adminRelatoriosPersonalizadosRoutes', () => {
  let app: FastifyInstance
  let prisma: PrismaMock

  beforeEach(async () => {
    [criarPersonalizadoMock, atualizarPersonalizadoMock, excluirPersonalizadoMock].forEach(m => m.mockReset())
    ;({ app, prisma } = await criarApp({
      registrar: adminRelatoriosPersonalizadosRoutes,
      comView: true,
      simularAdmin: { sub: 'admin1', email: 'admin@x.com' },
    }))
  })

  describe('GET /', () => {
    it('lista relatórios sem filtro', async () => {
      prisma.relatorioPersonalizado.findMany.mockResolvedValue([])
      prisma.usuario.findMany.mockResolvedValue([])
      const res = await app.inject({ method: 'GET', url: '/' })
      expect(res.statusCode).toBe(200)
    })

    it('filtra por usuarioId', async () => {
      prisma.relatorioPersonalizado.findMany.mockResolvedValue([])
      prisma.usuario.findMany.mockResolvedValue([])
      await app.inject({ method: 'GET', url: '/?usuarioId=u1' })
      expect(prisma.relatorioPersonalizado.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { usuarioId: 'u1' },
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
    it('retorna 404 quando não existe', async () => {
      prisma.relatorioPersonalizado.findUnique.mockResolvedValue(null)
      const res = await app.inject({ method: 'GET', url: '/rp1/form' })
      expect(res.statusCode).toBe(404)
    })

    it('renderiza form com relatório', async () => {
      prisma.relatorioPersonalizado.findUnique.mockResolvedValue(RELATORIO)
      const res = await app.inject({ method: 'GET', url: '/rp1/form' })
      expect(res.statusCode).toBe(200)
    })
  })

  describe('POST /', () => {
    it('valida usuarioId obrigatório', async () => {
      const res = await app.inject({
        method: 'POST', url: '/',
        ...form({ nome: 'X', descricao: '', configuracao: '{}', usuarioId: '' }),
      })
      expect(res.body).toMatch(/Selecione um usuário/)
      expect(criarPersonalizadoMock).not.toHaveBeenCalled()
    })

    it('valida nome obrigatório', async () => {
      const res = await app.inject({
        method: 'POST', url: '/',
        ...form({ nome: '  ', descricao: '', configuracao: '{}', usuarioId: 'u1' }),
      })
      expect(res.body).toMatch(/nome é obrigatório/i)
    })

    it('rejeita configuração inválida (JSON malformado)', async () => {
      const res = await app.inject({
        method: 'POST', url: '/',
        ...form({ nome: 'X', descricao: '', configuracao: '{abc', usuarioId: 'u1' }),
      })
      expect(res.body).toMatch(/Configuração inválida/)
      expect(criarPersonalizadoMock).not.toHaveBeenCalled()
    })

    it('rejeita configuração que não é objeto (array)', async () => {
      const res = await app.inject({
        method: 'POST', url: '/',
        ...form({ nome: 'X', descricao: '', configuracao: '[1,2]', usuarioId: 'u1' }),
      })
      expect(res.body).toMatch(/Configuração inválida/)
    })

    it('cria relatório com configuração padrão {} quando vazia', async () => {
      criarPersonalizadoMock.mockResolvedValue({ id: 'rp1' })
      await app.inject({
        method: 'POST', url: '/',
        ...form({ nome: 'X', descricao: '', configuracao: '', usuarioId: 'u1' }),
      })
      expect(criarPersonalizadoMock).toHaveBeenCalledWith('u1', { nome: 'X', configuracao: {} })
    })

    it('cria relatório e redireciona', async () => {
      criarPersonalizadoMock.mockResolvedValue({ id: 'rp1' })
      const res = await app.inject({
        method: 'POST', url: '/',
        ...form({ nome: 'X', descricao: 'desc', configuracao: '{"a":1}', usuarioId: 'u1' }),
      })
      expect(res.statusCode).toBe(204)
      expect(res.headers['hx-redirect']).toBe('/admin/relatorios-personalizados')
      expect(criarPersonalizadoMock).toHaveBeenCalledWith('u1', {
        nome: 'X', configuracao: { a: 1 }, descricao: 'desc',
      })
    })

    it('renderiza erro quando service falha', async () => {
      criarPersonalizadoMock.mockRejectedValue(new Error('Falha.'))
      const res = await app.inject({
        method: 'POST', url: '/',
        ...form({ nome: 'X', descricao: '', configuracao: '{}', usuarioId: 'u1' }),
      })
      expect(res.body).toContain('Falha.')
    })
  })

  describe('PUT /:id', () => {
    it('valida nome obrigatório', async () => {
      prisma.relatorioPersonalizado.findUnique.mockResolvedValue(RELATORIO)
      const res = await app.inject({
        method: 'PUT', url: '/rp1',
        ...form({ nome: '', descricao: '', configuracao: '' }),
      })
      expect(res.body).toMatch(/nome é obrigatório/i)
    })

    it('rejeita configuração inválida', async () => {
      prisma.relatorioPersonalizado.findUnique.mockResolvedValue(RELATORIO)
      const res = await app.inject({
        method: 'PUT', url: '/rp1',
        ...form({ nome: 'X', descricao: '', configuracao: '[1]' }),
      })
      expect(res.body).toMatch(/Configuração inválida/)
    })

    it('atualiza e redireciona', async () => {
      atualizarPersonalizadoMock.mockResolvedValue(undefined)
      const res = await app.inject({
        method: 'PUT', url: '/rp1',
        ...form({ nome: 'Novo', descricao: 'd', configuracao: '{"x":1}', ativo: 'false' }),
      })
      expect(res.statusCode).toBe(204)
      expect(atualizarPersonalizadoMock).toHaveBeenCalledWith('rp1', {
        nome: 'Novo', descricao: 'd', configuracao: { x: 1 }, ativo: false,
      })
    })

    it('atualiza sem configuracao quando não informada', async () => {
      atualizarPersonalizadoMock.mockResolvedValue(undefined)
      await app.inject({
        method: 'PUT', url: '/rp1',
        ...form({ nome: 'Novo', descricao: '', configuracao: '' }),
      })
      expect(atualizarPersonalizadoMock).toHaveBeenCalledWith('rp1', { nome: 'Novo' })
    })

    it('renderiza erro quando service falha', async () => {
      atualizarPersonalizadoMock.mockRejectedValue(new Error('Erro.'))
      prisma.relatorioPersonalizado.findUnique.mockResolvedValue(RELATORIO)
      const res = await app.inject({
        method: 'PUT', url: '/rp1',
        ...form({ nome: 'X', descricao: '', configuracao: '' }),
      })
      expect(res.body).toContain('Erro.')
    })
  })

  describe('DELETE /:id', () => {
    it('exclui e retorna 200', async () => {
      excluirPersonalizadoMock.mockResolvedValue(undefined)
      const res = await app.inject({ method: 'DELETE', url: '/rp1' })
      expect(res.statusCode).toBe(200)
    })

    it('retorna 400 quando falha', async () => {
      excluirPersonalizadoMock.mockRejectedValue(new Error('Em uso.'))
      const res = await app.inject({ method: 'DELETE', url: '/rp1' })
      expect(res.statusCode).toBe(400)
      expect(res.body).toBe('Em uso.')
    })
  })
})
