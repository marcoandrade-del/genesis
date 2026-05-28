import { describe, it, expect, beforeEach, vi } from 'vitest'

const { buscarPorIdMock, criarMock, atualizarMock, excluirMock } = vi.hoisted(() => ({
  buscarPorIdMock: vi.fn(),
  criarMock: vi.fn(),
  atualizarMock: vi.fn(),
  excluirMock: vi.fn(),
}))

vi.mock('../../services/planos-contas-despesa.js', () => ({
  PlanosContasDespesaService: class {
    buscarPorId = buscarPorIdMock
    criar = criarMock
    atualizar = atualizarMock
    excluir = excluirMock
  },
}))

import { criarApp } from '../../routes/__tests__/helpers/criarApp.js'
import { adminPlanosContasDespesaRoutes } from '../planos-contas-despesa.js'
import type { FastifyInstance } from 'fastify'
import type { PrismaMock } from '../../services/__tests__/helpers/prisma-mock.js'

const MODELO = { id: 'm1', descricao: 'PARANÁ', ativo: true }
const PLANO = {
  id: 'pd1', descricao: 'Despesa PR 2026', ano: 2026, modeloContabilId: 'm1',
  criadoEm: new Date(), atualizadoEm: new Date(),
}
const PLANO_COM_MODELO = { ...PLANO, modeloContabil: { id: 'm1', descricao: 'PARANÁ' }, _count: { contas: 0 } }

function form(obj: Record<string, string>) {
  return {
    payload: new URLSearchParams(obj).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  }
}

describe('adminPlanosContasDespesaRoutes', () => {
  let app: FastifyInstance
  let prisma: PrismaMock

  beforeEach(async () => {
    ;[buscarPorIdMock, criarMock, atualizarMock, excluirMock].forEach((m) => m.mockReset())
    ;({ app, prisma } = await criarApp({
      registrar: adminPlanosContasDespesaRoutes,
      comView: true,
      simularAdmin: { sub: 'admin1', email: 'admin@x.com' },
    }))
  })

  describe('GET /', () => {
    it('lista planos sem filtro', async () => {
      prisma.modeloContabil.findMany.mockResolvedValue([MODELO])
      prisma.planoContasDespesa.findMany.mockResolvedValue([PLANO_COM_MODELO])
      const res = await app.inject({ method: 'GET', url: '/' })
      expect(res.statusCode).toBe(200)
      expect(prisma.planoContasDespesa.findMany).toHaveBeenCalledWith({
        where: undefined,
        orderBy: [{ modeloContabilId: 'asc' }, { ano: 'desc' }],
        include: {
          modeloContabil: { select: { id: true, descricao: true } },
          _count: { select: { contas: true } },
        },
      })
    })

    it('aplica filtro quando modeloContabilId vem na query', async () => {
      prisma.modeloContabil.findMany.mockResolvedValue([MODELO])
      prisma.planoContasDespesa.findMany.mockResolvedValue([])
      await app.inject({ method: 'GET', url: '/?modeloContabilId=m1' })
      expect(prisma.planoContasDespesa.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { modeloContabilId: 'm1' } }),
      )
    })

    it('ignora modeloContabilId vazio (whitespace) e lista tudo', async () => {
      prisma.modeloContabil.findMany.mockResolvedValue([MODELO])
      prisma.planoContasDespesa.findMany.mockResolvedValue([])
      await app.inject({ method: 'GET', url: '/?modeloContabilId=%20%20' })
      expect(prisma.planoContasDespesa.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: undefined }),
      )
    })

    it('estado vazio quando não há planos', async () => {
      prisma.modeloContabil.findMany.mockResolvedValue([])
      prisma.planoContasDespesa.findMany.mockResolvedValue([])
      const res = await app.inject({ method: 'GET', url: '/' })
      expect(res.body).toContain('Nenhum plano de contas da despesa cadastrado')
    })
  })

  describe('GET /form', () => {
    it('renderiza form de novo plano com select de modelos ativos', async () => {
      prisma.modeloContabil.findMany.mockResolvedValue([MODELO])
      const res = await app.inject({ method: 'GET', url: '/form' })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Novo Plano de Contas da Despesa')
      expect(prisma.modeloContabil.findMany).toHaveBeenCalledWith({
        where: { ativo: true }, orderBy: { descricao: 'asc' }, select: { id: true, descricao: true },
      })
    })
  })

  describe('GET /:id/form', () => {
    it('404 quando plano não existe', async () => {
      prisma.planoContasDespesa.findUnique.mockResolvedValue(null)
      const res = await app.inject({ method: 'GET', url: '/x/form' })
      expect(res.statusCode).toBe(404)
    })

    it('renderiza form com modelo readonly quando edita', async () => {
      prisma.planoContasDespesa.findUnique.mockResolvedValue(PLANO_COM_MODELO)
      const res = await app.inject({ method: 'GET', url: '/pd1/form' })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Editar Plano de Contas da Despesa')
      expect(res.body).toContain('O modelo é definido na criação')
    })
  })

  describe('POST /', () => {
    it('cria e redireciona com HX-Redirect', async () => {
      criarMock.mockResolvedValue(PLANO)
      const res = await app.inject({
        method: 'POST', url: '/',
        ...form({ descricao: 'Despesa PR 2026', ano: '2026', modeloContabilId: 'm1' }),
      })
      expect(res.statusCode).toBe(204)
      expect(res.headers['hx-redirect']).toBe('/admin/planos-contas-despesa')
      expect(criarMock).toHaveBeenCalledWith({ descricao: 'Despesa PR 2026', ano: 2026, modeloContabilId: 'm1' })
    })

    it('re-renderiza com erro quando descrição vazia', async () => {
      prisma.modeloContabil.findMany.mockResolvedValue([])
      const res = await app.inject({
        method: 'POST', url: '/', ...form({ descricao: '   ', ano: '2026', modeloContabilId: 'm1' }),
      })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('A descrição é obrigatória')
      expect(criarMock).not.toHaveBeenCalled()
    })

    it('re-renderiza com erro quando modelo não selecionado', async () => {
      prisma.modeloContabil.findMany.mockResolvedValue([])
      const res = await app.inject({
        method: 'POST', url: '/', ...form({ descricao: 'X', ano: '2026', modeloContabilId: '' }),
      })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Selecione um modelo')
    })

    it('re-renderiza com erro quando ano não-numérico', async () => {
      prisma.modeloContabil.findMany.mockResolvedValue([])
      const res = await app.inject({
        method: 'POST', url: '/', ...form({ descricao: 'X', ano: 'abc', modeloContabilId: 'm1' }),
      })
      expect(res.body).toContain('Ano inválido')
    })

    it('re-renderiza com erro quando ano fora do intervalo (< 1900)', async () => {
      prisma.modeloContabil.findMany.mockResolvedValue([])
      const res = await app.inject({
        method: 'POST', url: '/', ...form({ descricao: 'X', ano: '1800', modeloContabilId: 'm1' }),
      })
      expect(res.body).toContain('Ano inválido')
    })

    it('re-renderiza com erro quando ano fora do intervalo (> 9999)', async () => {
      prisma.modeloContabil.findMany.mockResolvedValue([])
      const res = await app.inject({
        method: 'POST', url: '/', ...form({ descricao: 'X', ano: '10000', modeloContabilId: 'm1' }),
      })
      expect(res.body).toContain('Ano inválido')
    })

    it('re-renderiza com erro do service (Error instance)', async () => {
      prisma.modeloContabil.findMany.mockResolvedValue([])
      criarMock.mockRejectedValue(new Error('Já existe plano'))
      const res = await app.inject({
        method: 'POST', url: '/', ...form({ descricao: 'X', ano: '2026', modeloContabilId: 'm1' }),
      })
      expect(res.body).toContain('Já existe plano')
    })

    it('mensagem default para erro não-Error', async () => {
      prisma.modeloContabil.findMany.mockResolvedValue([])
      criarMock.mockRejectedValue('boom')
      const res = await app.inject({
        method: 'POST', url: '/', ...form({ descricao: 'X', ano: '2026', modeloContabilId: 'm1' }),
      })
      expect(res.body).toContain('Erro ao criar plano de contas da despesa')
    })
  })

  describe('PUT /:id', () => {
    it('atualiza descricao e ano', async () => {
      atualizarMock.mockResolvedValue(PLANO)
      const res = await app.inject({
        method: 'PUT', url: '/pd1', ...form({ descricao: 'Despesa nova', ano: '2027' }),
      })
      expect(res.statusCode).toBe(204)
      expect(res.headers['hx-redirect']).toBe('/admin/planos-contas-despesa')
      expect(atualizarMock).toHaveBeenCalledWith('pd1', { descricao: 'Despesa nova', ano: 2027 })
    })

    it('re-renderiza com erro quando descrição vazia', async () => {
      prisma.planoContasDespesa.findUnique.mockResolvedValue(PLANO_COM_MODELO)
      const res = await app.inject({ method: 'PUT', url: '/pd1', ...form({ descricao: '', ano: '2027' }) })
      expect(res.body).toContain('A descrição é obrigatória')
      expect(atualizarMock).not.toHaveBeenCalled()
    })

    it('re-renderiza com erro quando ano inválido', async () => {
      prisma.planoContasDespesa.findUnique.mockResolvedValue(PLANO_COM_MODELO)
      const res = await app.inject({ method: 'PUT', url: '/pd1', ...form({ descricao: 'X', ano: 'foo' }) })
      expect(res.body).toContain('Ano inválido')
    })

    it('re-renderiza com erro do service', async () => {
      prisma.planoContasDespesa.findUnique.mockResolvedValue(PLANO_COM_MODELO)
      atualizarMock.mockRejectedValue(new Error('Conflito'))
      const res = await app.inject({ method: 'PUT', url: '/pd1', ...form({ descricao: 'X', ano: '2027' }) })
      expect(res.body).toContain('Conflito')
    })

    it('mensagem default para erro não-Error', async () => {
      prisma.planoContasDespesa.findUnique.mockResolvedValue(PLANO_COM_MODELO)
      atualizarMock.mockRejectedValue('boom')
      const res = await app.inject({ method: 'PUT', url: '/pd1', ...form({ descricao: 'X', ano: '2027' }) })
      expect(res.body).toContain('Erro ao atualizar plano de contas da despesa')
    })
  })

  describe('DELETE /:id', () => {
    it('exclui com 200', async () => {
      excluirMock.mockResolvedValue(undefined)
      const res = await app.inject({ method: 'DELETE', url: '/pd1' })
      expect(res.statusCode).toBe(200)
      expect(excluirMock).toHaveBeenCalledWith('pd1')
    })

    it('400 quando service rejeita com Error', async () => {
      excluirMock.mockRejectedValue(new Error('Em uso'))
      const res = await app.inject({ method: 'DELETE', url: '/pd1' })
      expect(res.statusCode).toBe(400)
      expect(res.body).toBe('Em uso')
    })

    it('400 com mensagem default para erro não-Error', async () => {
      excluirMock.mockRejectedValue('x')
      const res = await app.inject({ method: 'DELETE', url: '/pd1' })
      expect(res.statusCode).toBe(400)
      expect(res.body).toBe('Erro ao excluir.')
    })
  })
})
