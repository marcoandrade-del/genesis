import { describe, it, expect, beforeEach, vi } from 'vitest'

const { criarMock, atualizarMock, excluirMock } = vi.hoisted(() => ({
  criarMock: vi.fn(),
  atualizarMock: vi.fn(),
  excluirMock: vi.fn(),
}))

vi.mock('../../services/contas-receita.js', () => ({
  ContasReceitaService: class {
    criar = criarMock
    atualizar = atualizarMock
    excluir = excluirMock
  },
}))

import { criarApp } from '../../routes/__tests__/helpers/criarApp.js'
import { adminContasReceitaRoutes } from '../contas-receita.js'
import type { FastifyInstance } from 'fastify'
import type { PrismaMock } from '../../services/__tests__/helpers/prisma-mock.js'

const PLANO = {
  id: 'pr1', descricao: 'Receita PR 2026', ano: 2026, modeloContabilId: 'm1',
  criadoEm: new Date(), atualizadoEm: new Date(),
  modeloContabil: { descricao: 'PARANÁ' },
}
const RAIZ = {
  id: 'c1', planoId: 'pr1', codigo: '1', descricao: 'Receitas Correntes', nivel: 1,
  admiteMovimento: false, parentId: null,
  criadoEm: new Date(), atualizadoEm: new Date(),
}
const FILHO = {
  id: 'c2', planoId: 'pr1', codigo: '1.1', descricao: 'Impostos', nivel: 2,
  admiteMovimento: false, parentId: 'c1',
  criadoEm: new Date(), atualizadoEm: new Date(),
}

function form(obj: Record<string, string>) {
  return {
    payload: new URLSearchParams(obj).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  }
}

describe('adminContasReceitaRoutes', () => {
  let app: FastifyInstance
  let prisma: PrismaMock

  beforeEach(async () => {
    ;[criarMock, atualizarMock, excluirMock].forEach((m) => m.mockReset())
    ;({ app, prisma } = await criarApp({
      registrar: adminContasReceitaRoutes,
      comView: true,
      simularAdmin: { sub: 'a1', email: 'a@x.com' },
    }))
  })

  describe('GET /', () => {
    it('sem planoId renderiza picker vazio', async () => {
      prisma.planoContasReceita.findMany.mockResolvedValue([PLANO])
      const res = await app.inject({ method: 'GET', url: '/' })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Selecione um plano de contas da receita acima')
      expect(prisma.contaReceita.findMany).not.toHaveBeenCalled()
    })

    it('ignora planoId vazio (whitespace) e cai no picker', async () => {
      prisma.planoContasReceita.findMany.mockResolvedValue([])
      const res = await app.inject({ method: 'GET', url: '/?planoId=%20' })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Selecione um plano')
    })

    it('404 quando plano não existe', async () => {
      prisma.planoContasReceita.findMany.mockResolvedValue([])
      prisma.planoContasReceita.findUnique.mockResolvedValue(null)
      const res = await app.inject({ method: 'GET', url: '/?planoId=x' })
      expect(res.statusCode).toBe(404)
    })

    it('renderiza raizes com flag temFilhos', async () => {
      prisma.planoContasReceita.findMany.mockResolvedValue([PLANO])
      prisma.planoContasReceita.findUnique.mockResolvedValue(PLANO)
      prisma.contaReceita.findMany.mockResolvedValue([RAIZ])
      prisma.contaReceita.groupBy.mockResolvedValue([{ parentId: 'c1', _count: { _all: 2 } }])
      const res = await app.inject({ method: 'GET', url: '/?planoId=pr1' })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Receitas Correntes')
      expect(res.body).toContain('Expandir')
    })

    it('plano vazio mostra mensagem informativa', async () => {
      prisma.planoContasReceita.findMany.mockResolvedValue([PLANO])
      prisma.planoContasReceita.findUnique.mockResolvedValue(PLANO)
      prisma.contaReceita.findMany.mockResolvedValue([])
      const res = await app.inject({ method: 'GET', url: '/?planoId=pr1' })
      expect(res.body).toContain('Plano sem contas cadastradas')
    })

    it('comTemFilhos lida com lista vazia sem chamar groupBy', async () => {
      prisma.planoContasReceita.findMany.mockResolvedValue([PLANO])
      prisma.planoContasReceita.findUnique.mockResolvedValue(PLANO)
      prisma.contaReceita.findMany.mockResolvedValue([])
      await app.inject({ method: 'GET', url: '/?planoId=pr1' })
      expect(prisma.contaReceita.groupBy).not.toHaveBeenCalled()
    })

    it('comTemFilhos filtra parentId null do set', async () => {
      prisma.planoContasReceita.findMany.mockResolvedValue([PLANO])
      prisma.planoContasReceita.findUnique.mockResolvedValue(PLANO)
      prisma.contaReceita.findMany.mockResolvedValue([RAIZ])
      prisma.contaReceita.groupBy.mockResolvedValue([{ parentId: null, _count: { _all: 1 } }])
      const res = await app.inject({ method: 'GET', url: '/?planoId=pr1' })
      expect(res.body).not.toContain('Expandir')
    })
  })

  describe('GET /:id/filhos', () => {
    it('404 quando pai não existe', async () => {
      prisma.contaReceita.findUnique.mockResolvedValue(null)
      const res = await app.inject({ method: 'GET', url: '/x/filhos' })
      expect(res.statusCode).toBe(404)
    })

    it('renderiza filhos com indentação correta', async () => {
      prisma.contaReceita.findUnique.mockResolvedValue(RAIZ)
      prisma.contaReceita.findMany.mockResolvedValue([FILHO])
      prisma.contaReceita.groupBy.mockResolvedValue([])
      const res = await app.inject({ method: 'GET', url: '/c1/filhos' })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('1.1')
      expect(res.body).toContain('Impostos')
    })
  })

  describe('GET /form', () => {
    it('400 quando planoId ausente', async () => {
      const res = await app.inject({ method: 'GET', url: '/form' })
      expect(res.statusCode).toBe(400)
    })

    it('400 quando planoId é whitespace', async () => {
      const res = await app.inject({ method: 'GET', url: '/form?planoId=%20' })
      expect(res.statusCode).toBe(400)
    })

    it('404 quando plano não existe', async () => {
      prisma.planoContasReceita.findUnique.mockResolvedValue(null)
      const res = await app.inject({ method: 'GET', url: '/form?planoId=pr1' })
      expect(res.statusCode).toBe(404)
    })

    it('renderiza form de raiz quando sem parentId', async () => {
      prisma.planoContasReceita.findUnique.mockResolvedValue(PLANO)
      const res = await app.inject({ method: 'GET', url: '/form?planoId=pr1' })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Nova Conta-raiz')
    })

    it('404 quando parentId não existe', async () => {
      prisma.planoContasReceita.findUnique.mockResolvedValue(PLANO)
      prisma.contaReceita.findUnique.mockResolvedValue(null)
      const res = await app.inject({ method: 'GET', url: '/form?planoId=pr1&parentId=zzz' })
      expect(res.statusCode).toBe(404)
    })

    it('renderiza form de filha com parent contextual', async () => {
      prisma.planoContasReceita.findUnique.mockResolvedValue(PLANO)
      prisma.contaReceita.findUnique.mockResolvedValue(RAIZ)
      const res = await app.inject({ method: 'GET', url: '/form?planoId=pr1&parentId=c1' })
      expect(res.body).toContain('Nova Conta-filha')
      expect(res.body).toContain('Receitas Correntes')
    })
  })

  describe('GET /:id/form', () => {
    it('404 quando conta não existe', async () => {
      prisma.contaReceita.findUnique.mockResolvedValue(null)
      const res = await app.inject({ method: 'GET', url: '/x/form' })
      expect(res.statusCode).toBe(404)
    })

    it('renderiza form de edição com código readonly', async () => {
      prisma.contaReceita.findUnique.mockResolvedValue({ ...RAIZ, plano: PLANO, parent: null })
      const res = await app.inject({ method: 'GET', url: '/c1/form' })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Editar Conta')
      expect(res.body).toContain('O código é imutável após criação')
    })
  })

  describe('POST /', () => {
    it('cria raiz e redireciona', async () => {
      criarMock.mockResolvedValue(RAIZ)
      const res = await app.inject({
        method: 'POST', url: '/',
        ...form({ planoId: 'pr1', codigo: '1', descricao: 'Receitas Correntes' }),
      })
      expect(res.statusCode).toBe(204)
      expect(res.headers['hx-redirect']).toBe('/admin/contas-receita?planoId=pr1')
      expect(criarMock).toHaveBeenCalledWith({
        planoId: 'pr1', codigo: '1', descricao: 'Receitas Correntes', admiteMovimento: false,
      })
    })

    it('cria filha quando parentId vem (e admiteMovimento)', async () => {
      criarMock.mockResolvedValue(FILHO)
      await app.inject({
        method: 'POST', url: '/',
        ...form({ planoId: 'pr1', parentId: 'c1', codigo: '1.1', descricao: 'X', admiteMovimento: 'true' }),
      })
      expect(criarMock).toHaveBeenCalledWith({
        planoId: 'pr1', codigo: '1.1', descricao: 'X', parentId: 'c1', admiteMovimento: true,
      })
    })

    it('ignora parentId vazio', async () => {
      criarMock.mockResolvedValue(RAIZ)
      await app.inject({
        method: 'POST', url: '/',
        ...form({ planoId: 'pr1', parentId: '   ', codigo: '1', descricao: 'A' }),
      })
      expect(criarMock).toHaveBeenCalledWith(expect.not.objectContaining({ parentId: expect.anything() }))
    })

    it('re-renderiza com erro quando código vazio', async () => {
      prisma.planoContasReceita.findUnique.mockResolvedValue(PLANO)
      const res = await app.inject({
        method: 'POST', url: '/', ...form({ planoId: 'pr1', codigo: '  ', descricao: 'X' }),
      })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('O código é obrigatório')
      expect(criarMock).not.toHaveBeenCalled()
    })

    it('re-renderiza com erro quando descrição vazia', async () => {
      prisma.planoContasReceita.findUnique.mockResolvedValue(PLANO)
      const res = await app.inject({
        method: 'POST', url: '/', ...form({ planoId: 'pr1', codigo: '1', descricao: '' }),
      })
      expect(res.body).toContain('A descrição é obrigatória')
    })

    it('re-render erro recupera parent quando parentId presente', async () => {
      prisma.planoContasReceita.findUnique.mockResolvedValue(PLANO)
      prisma.contaReceita.findUnique.mockResolvedValue(RAIZ)
      const res = await app.inject({
        method: 'POST', url: '/', ...form({ planoId: 'pr1', parentId: 'c1', codigo: '', descricao: 'X' }),
      })
      expect(res.body).toContain('Nova Conta-filha')
      expect(prisma.contaReceita.findUnique).toHaveBeenCalled()
    })

    it('propaga erro do service como mensagem', async () => {
      prisma.planoContasReceita.findUnique.mockResolvedValue(PLANO)
      criarMock.mockRejectedValue(new Error('Já existe esse código'))
      const res = await app.inject({
        method: 'POST', url: '/', ...form({ planoId: 'pr1', codigo: '1', descricao: 'A' }),
      })
      expect(res.body).toContain('Já existe esse código')
    })

    it('mensagem default para erro não-Error', async () => {
      prisma.planoContasReceita.findUnique.mockResolvedValue(PLANO)
      criarMock.mockRejectedValue('boom')
      const res = await app.inject({
        method: 'POST', url: '/', ...form({ planoId: 'pr1', codigo: '1', descricao: 'A' }),
      })
      expect(res.body).toContain('Erro ao criar conta')
    })
  })

  describe('PUT /:id', () => {
    it('atualiza descricao + admiteMovimento e redireciona', async () => {
      atualizarMock.mockResolvedValue(RAIZ)
      prisma.contaReceita.findUnique.mockResolvedValue({ planoId: 'pr1' })
      const res = await app.inject({
        method: 'PUT', url: '/c1',
        ...form({ descricao: 'NOVA', admiteMovimento: 'true' }),
      })
      expect(res.statusCode).toBe(204)
      expect(res.headers['hx-redirect']).toBe('/admin/contas-receita?planoId=pr1')
      expect(atualizarMock).toHaveBeenCalledWith('c1', { descricao: 'NOVA', admiteMovimento: true })
    })

    it('404 quando conta some entre validação e update', async () => {
      prisma.contaReceita.findUnique.mockResolvedValue(null)
      const res = await app.inject({
        method: 'PUT', url: '/c1', ...form({ descricao: 'X' }),
      })
      expect(res.statusCode).toBe(404)
    })

    it('re-renderiza com erro quando descrição vazia', async () => {
      prisma.contaReceita.findUnique.mockResolvedValue({ ...RAIZ, plano: PLANO, parent: null })
      const res = await app.inject({
        method: 'PUT', url: '/c1', ...form({ descricao: '' }),
      })
      expect(res.body).toContain('A descrição é obrigatória')
      expect(atualizarMock).not.toHaveBeenCalled()
    })

    it('propaga erro do service', async () => {
      prisma.contaReceita.findUnique
        .mockResolvedValueOnce({ planoId: 'pr1' })
        .mockResolvedValueOnce({ ...RAIZ, plano: PLANO, parent: null })
      atualizarMock.mockRejectedValue(new Error('Conta com filhos'))
      const res = await app.inject({
        method: 'PUT', url: '/c1', ...form({ descricao: 'X', admiteMovimento: 'true' }),
      })
      expect(res.body).toContain('Conta com filhos')
    })

    it('mensagem default para erro não-Error', async () => {
      prisma.contaReceita.findUnique
        .mockResolvedValueOnce({ planoId: 'pr1' })
        .mockResolvedValueOnce({ ...RAIZ, plano: PLANO, parent: null })
      atualizarMock.mockRejectedValue('boom')
      const res = await app.inject({
        method: 'PUT', url: '/c1', ...form({ descricao: 'X' }),
      })
      expect(res.body).toContain('Erro ao atualizar conta')
    })
  })

  describe('DELETE /:id', () => {
    it('exclui com 200', async () => {
      excluirMock.mockResolvedValue(undefined)
      const res = await app.inject({ method: 'DELETE', url: '/c1' })
      expect(res.statusCode).toBe(200)
      expect(excluirMock).toHaveBeenCalledWith('c1')
    })

    it('400 quando service rejeita com Error', async () => {
      excluirMock.mockRejectedValue(new Error('Em uso'))
      const res = await app.inject({ method: 'DELETE', url: '/c1' })
      expect(res.statusCode).toBe(400)
      expect(res.body).toBe('Em uso')
    })

    it('400 com mensagem default para erro não-Error', async () => {
      excluirMock.mockRejectedValue('x')
      const res = await app.inject({ method: 'DELETE', url: '/c1' })
      expect(res.statusCode).toBe(400)
      expect(res.body).toBe('Erro ao excluir.')
    })
  })
})
