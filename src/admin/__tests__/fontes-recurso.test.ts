import { describe, it, expect, beforeEach, vi } from 'vitest'

const { listarMock, criarMock, atualizarMock, excluirMock } = vi.hoisted(() => ({
  listarMock: vi.fn(),
  criarMock: vi.fn(),
  atualizarMock: vi.fn(),
  excluirMock: vi.fn(),
}))

vi.mock('../../services/fontes-recurso.js', () => ({
  FontesRecursoService: class {
    listar = listarMock
    criar = criarMock
    atualizar = atualizarMock
    excluir = excluirMock
  },
}))

import { criarApp } from '../../routes/__tests__/helpers/criarApp.js'
import { adminFontesRecursoRoutes } from '../fontes-recurso.js'
import type { FastifyInstance } from 'fastify'
import type { PrismaMock } from '../../services/__tests__/helpers/prisma-mock.js'

const MODELO = { id: 'm1', descricao: 'PARANÁ', ativo: true }
const FONTE = {
  id: 'fr1', modeloContabilId: 'm1', ano: 2026, codigo: '500',
  nomenclatura: 'Recursos não Vinculados de Impostos', especificacao: 'Impostos e transferências',
  vinculada: false, grupo: 'Livres', criadoEm: new Date(), atualizadoEm: new Date(),
  modeloContabil: { descricao: 'PARANÁ' },
}

function form(obj: Record<string, string>) {
  return {
    payload: new URLSearchParams(obj).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  }
}

describe('adminFontesRecursoRoutes', () => {
  let app: FastifyInstance
  let prisma: PrismaMock

  beforeEach(async () => {
    ;[listarMock, criarMock, atualizarMock, excluirMock].forEach((m) => m.mockReset())
    listarMock.mockResolvedValue([])
    ;({ app, prisma } = await criarApp({
      registrar: adminFontesRecursoRoutes,
      comView: true,
      simularAdmin: { sub: 'admin1', email: 'admin@x.com' },
    }))
  })

  describe('GET /', () => {
    it('lista sem filtros', async () => {
      prisma.modeloContabil.findMany.mockResolvedValue([MODELO])
      listarMock.mockResolvedValue([FONTE])
      const res = await app.inject({ method: 'GET', url: '/' })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Recursos não Vinculados')
      expect(listarMock).toHaveBeenCalledWith({})
    })

    it('filtra por modelo e ano', async () => {
      prisma.modeloContabil.findMany.mockResolvedValue([MODELO])
      await app.inject({ method: 'GET', url: '/?modeloContabilId=m1&ano=2026' })
      expect(listarMock).toHaveBeenCalledWith({ modeloContabilId: 'm1', ano: 2026 })
    })

    it('ignora ano inválido no filtro', async () => {
      prisma.modeloContabil.findMany.mockResolvedValue([MODELO])
      await app.inject({ method: 'GET', url: '/?ano=abc' })
      expect(listarMock).toHaveBeenCalledWith({})
    })

    it('estado vazio quando não há fontes', async () => {
      prisma.modeloContabil.findMany.mockResolvedValue([])
      listarMock.mockResolvedValue([])
      const res = await app.inject({ method: 'GET', url: '/' })
      expect(res.body).toContain('Nenhuma fonte de recurso cadastrada')
    })
  })

  describe('GET /form', () => {
    it('renderiza form novo com modelos ativos', async () => {
      prisma.modeloContabil.findMany.mockResolvedValue([MODELO])
      const res = await app.inject({ method: 'GET', url: '/form' })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Nova Fonte de Recurso')
    })
  })

  describe('GET /:id/form', () => {
    it('404 quando não existe', async () => {
      prisma.fonteRecurso.findUnique.mockResolvedValue(null)
      const res = await app.inject({ method: 'GET', url: '/x/form' })
      expect(res.statusCode).toBe(404)
    })

    it('renderiza form de edição com modelo/ano/código imutáveis', async () => {
      prisma.fonteRecurso.findUnique.mockResolvedValue(FONTE)
      const res = await app.inject({ method: 'GET', url: '/fr1/form' })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Editar Fonte de Recurso')
      expect(res.body).toContain('imutáveis após a criação')
    })
  })

  describe('POST /', () => {
    it('cria e redireciona (com especificacao e grupo)', async () => {
      criarMock.mockResolvedValue(FONTE)
      const res = await app.inject({
        method: 'POST', url: '/',
        ...form({ modeloContabilId: 'm1', ano: '2026', codigo: '500', nomenclatura: 'Livres', especificacao: 'Imp.', grupo: 'Livres', vinculada: 'true' }),
      })
      expect(res.statusCode).toBe(204)
      expect(res.headers['hx-redirect']).toBe('/admin/fontes-recurso')
      expect(criarMock).toHaveBeenCalledWith({
        modeloContabilId: 'm1', ano: 2026, codigo: '500', nomenclatura: 'Livres',
        vinculada: true, especificacao: 'Imp.', grupo: 'Livres',
      })
    })

    it('cria sem opcionais (vinculada=false quando não marcada)', async () => {
      criarMock.mockResolvedValue(FONTE)
      await app.inject({
        method: 'POST', url: '/',
        ...form({ modeloContabilId: 'm1', ano: '2026', codigo: '600', nomenclatura: 'SUS', especificacao: '', grupo: '' }),
      })
      expect(criarMock).toHaveBeenCalledWith({
        modeloContabilId: 'm1', ano: 2026, codigo: '600', nomenclatura: 'SUS', vinculada: false,
      })
    })

    it('erro quando modelo não selecionado', async () => {
      prisma.modeloContabil.findMany.mockResolvedValue([])
      const res = await app.inject({
        method: 'POST', url: '/', ...form({ modeloContabilId: '', ano: '2026', codigo: '5', nomenclatura: 'X', especificacao: '', grupo: '' }),
      })
      expect(res.body).toContain('Selecione um modelo')
      expect(criarMock).not.toHaveBeenCalled()
    })

    it('erro quando ano inválido', async () => {
      prisma.modeloContabil.findMany.mockResolvedValue([])
      const res = await app.inject({
        method: 'POST', url: '/', ...form({ modeloContabilId: 'm1', ano: 'foo', codigo: '5', nomenclatura: 'X', especificacao: '', grupo: '' }),
      })
      expect(res.body).toContain('Ano inválido')
    })

    it('erro quando código vazio', async () => {
      prisma.modeloContabil.findMany.mockResolvedValue([])
      const res = await app.inject({
        method: 'POST', url: '/', ...form({ modeloContabilId: 'm1', ano: '2026', codigo: '  ', nomenclatura: 'X', especificacao: '', grupo: '' }),
      })
      expect(res.body).toContain('O código é obrigatório')
    })

    it('erro quando nomenclatura vazia', async () => {
      prisma.modeloContabil.findMany.mockResolvedValue([])
      const res = await app.inject({
        method: 'POST', url: '/', ...form({ modeloContabilId: 'm1', ano: '2026', codigo: '5', nomenclatura: '', especificacao: '', grupo: '' }),
      })
      expect(res.body).toContain('A nomenclatura é obrigatória')
    })

    it('re-renderiza erro do service', async () => {
      prisma.modeloContabil.findMany.mockResolvedValue([])
      criarMock.mockRejectedValue(new Error('Já existe a fonte'))
      const res = await app.inject({
        method: 'POST', url: '/', ...form({ modeloContabilId: 'm1', ano: '2026', codigo: '500', nomenclatura: 'X', especificacao: '', grupo: '' }),
      })
      expect(res.body).toContain('Já existe a fonte')
    })

    it('mensagem default para erro não-Error', async () => {
      prisma.modeloContabil.findMany.mockResolvedValue([])
      criarMock.mockRejectedValue('boom')
      const res = await app.inject({
        method: 'POST', url: '/', ...form({ modeloContabilId: 'm1', ano: '2026', codigo: '500', nomenclatura: 'X', especificacao: '', grupo: '' }),
      })
      expect(res.body).toContain('Erro ao criar fonte de recurso')
    })
  })

  describe('PUT /:id', () => {
    it('atualiza e redireciona', async () => {
      atualizarMock.mockResolvedValue(FONTE)
      const res = await app.inject({
        method: 'PUT', url: '/fr1',
        ...form({ nomenclatura: 'Novo nome', especificacao: 'spec', grupo: 'Educação', vinculada: 'true' }),
      })
      expect(res.statusCode).toBe(204)
      expect(res.headers['hx-redirect']).toBe('/admin/fontes-recurso')
      expect(atualizarMock).toHaveBeenCalledWith('fr1', {
        nomenclatura: 'Novo nome', vinculada: true, especificacao: 'spec', grupo: 'Educação',
      })
    })

    it('erro quando nomenclatura vazia', async () => {
      prisma.fonteRecurso.findUnique.mockResolvedValue(FONTE)
      const res = await app.inject({ method: 'PUT', url: '/fr1', ...form({ nomenclatura: '', especificacao: '', grupo: '' }) })
      expect(res.body).toContain('A nomenclatura é obrigatória')
      expect(atualizarMock).not.toHaveBeenCalled()
    })

    it('re-renderiza erro do service', async () => {
      prisma.fonteRecurso.findUnique.mockResolvedValue(FONTE)
      atualizarMock.mockRejectedValue(new Error('Não encontrada'))
      const res = await app.inject({ method: 'PUT', url: '/fr1', ...form({ nomenclatura: 'X', especificacao: '', grupo: '' }) })
      expect(res.body).toContain('Não encontrada')
    })

    it('mensagem default para erro não-Error', async () => {
      prisma.fonteRecurso.findUnique.mockResolvedValue(FONTE)
      atualizarMock.mockRejectedValue('boom')
      const res = await app.inject({ method: 'PUT', url: '/fr1', ...form({ nomenclatura: 'X', especificacao: '', grupo: '' }) })
      expect(res.body).toContain('Erro ao atualizar fonte de recurso')
    })
  })

  describe('DELETE /:id', () => {
    it('exclui com 200', async () => {
      excluirMock.mockResolvedValue(undefined)
      const res = await app.inject({ method: 'DELETE', url: '/fr1' })
      expect(res.statusCode).toBe(200)
      expect(excluirMock).toHaveBeenCalledWith('fr1')
    })

    it('400 quando service rejeita com Error', async () => {
      excluirMock.mockRejectedValue(new Error('Em uso'))
      const res = await app.inject({ method: 'DELETE', url: '/fr1' })
      expect(res.statusCode).toBe(400)
      expect(res.body).toBe('Em uso')
    })

    it('400 com mensagem default para erro não-Error', async () => {
      excluirMock.mockRejectedValue('x')
      const res = await app.inject({ method: 'DELETE', url: '/fr1' })
      expect(res.statusCode).toBe(400)
      expect(res.body).toBe('Erro ao excluir.')
    })
  })
})
