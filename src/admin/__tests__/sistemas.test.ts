import { describe, it, expect, beforeEach, vi } from 'vitest'

const { buscarComAdminsMock, criarMock, atualizarMock, trocarAdminMock, excluirMock } = vi.hoisted(() => ({
  buscarComAdminsMock: vi.fn(),
  criarMock: vi.fn(),
  atualizarMock: vi.fn(),
  trocarAdminMock: vi.fn(),
  excluirMock: vi.fn(),
}))

vi.mock('../../services/sistemas.js', () => ({
  SistemasService: class {
    buscarComAdmins = buscarComAdminsMock
    criar = criarMock
    atualizar = atualizarMock
    trocarAdmin = trocarAdminMock
    excluir = excluirMock
  },
}))
vi.mock('../../services/lixeira.js', () => ({ LixeiraService: class {} }))

import { criarApp } from '../../routes/__tests__/helpers/criarApp.js'
import { adminSistemasRoutes } from '../sistemas.js'
import type { FastifyInstance } from 'fastify'
import type { PrismaMock } from '../../services/__tests__/helpers/prisma-mock.js'

const SISTEMA = {
  id: 's1',
  nome: 'ERP',
  descricao: '',
  ativo: true,
  admins: [{ usuario: { id: 'u1', nomeCompleto: 'Admin' } }],
}

function form(obj: Record<string, string>) {
  return {
    payload: new URLSearchParams(obj).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  }
}

describe('adminSistemasRoutes', () => {
  let app: FastifyInstance
  let prisma: PrismaMock

  beforeEach(async () => {
    [buscarComAdminsMock, criarMock, atualizarMock, trocarAdminMock, excluirMock].forEach(m => m.mockReset())
    ;({ app, prisma } = await criarApp({
      registrar: adminSistemasRoutes,
      comView: true,
      simularAdmin: { sub: 'admin1', email: 'admin@x.com' },
    }))
  })

  describe('GET /', () => {
    it('lista sistemas', async () => {
      prisma.sistema.findMany.mockResolvedValue([])
      const res = await app.inject({ method: 'GET', url: '/' })
      expect(res.statusCode).toBe(200)
      expect(prisma.sistema.findMany).toHaveBeenCalledWith({
        orderBy: { nome: 'asc' },
        include: { _count: { select: { modulos: true } } },
      })
    })
  })

  describe('GET /form', () => {
    it('renderiza form vazio com adminPadrao do usuário logado', async () => {
      prisma.usuario.findUnique.mockResolvedValue({ id: 'admin1', nomeCompleto: 'Admin' })
      const res = await app.inject({ method: 'GET', url: '/form' })
      expect(res.statusCode).toBe(200)
      expect(prisma.usuario.findUnique).toHaveBeenCalledWith({
        where: { id: 'admin1' },
        select: { id: true, nomeCompleto: true },
      })
    })
  })

  describe('GET /:id/form', () => {
    it('retorna 404 quando sistema não existe', async () => {
      buscarComAdminsMock.mockResolvedValue(null)
      const res = await app.inject({ method: 'GET', url: '/s1/form' })
      expect(res.statusCode).toBe(404)
    })

    it('renderiza form com sistema e admin atual', async () => {
      buscarComAdminsMock.mockResolvedValue(SISTEMA)
      const res = await app.inject({ method: 'GET', url: '/s1/form' })
      expect(res.statusCode).toBe(200)
    })

    it('lida com sistema sem admins', async () => {
      buscarComAdminsMock.mockResolvedValue({ ...SISTEMA, admins: [] })
      const res = await app.inject({ method: 'GET', url: '/s1/form' })
      expect(res.statusCode).toBe(200)
    })
  })

  describe('POST /', () => {
    it('valida nome obrigatório', async () => {
      prisma.usuario.findUnique.mockResolvedValue({ id: 'admin1', nomeCompleto: 'Admin' })
      const res = await app.inject({
        method: 'POST', url: '/',
        ...form({ nome: '  ', descricao: '', adminUsuarioId: 'u1' }),
      })
      expect(res.body).toMatch(/nome é obrigatório/i)
      expect(criarMock).not.toHaveBeenCalled()
    })

    it('valida adminUsuarioId obrigatório', async () => {
      prisma.usuario.findUnique.mockResolvedValue({ id: 'admin1', nomeCompleto: 'Admin' })
      const res = await app.inject({
        method: 'POST', url: '/',
        ...form({ nome: 'X', descricao: '', adminUsuarioId: '' }),
      })
      expect(res.body).toMatch(/Selecione um usuário/)
    })

    it('cria sistema e redireciona', async () => {
      criarMock.mockResolvedValue({ id: 's1' })
      const res = await app.inject({
        method: 'POST', url: '/',
        ...form({ nome: 'ERP', descricao: 'desc', adminUsuarioId: 'u1' }),
      })
      expect(res.statusCode).toBe(204)
      expect(res.headers['hx-redirect']).toBe('/admin/sistemas')
      expect(criarMock).toHaveBeenCalledWith({ nome: 'ERP', adminUsuarioId: 'u1', descricao: 'desc' })
    })

    it('omite descricao quando vazia', async () => {
      criarMock.mockResolvedValue({ id: 's1' })
      await app.inject({
        method: 'POST', url: '/',
        ...form({ nome: 'X', descricao: '', adminUsuarioId: 'u1' }),
      })
      expect(criarMock).toHaveBeenCalledWith({ nome: 'X', adminUsuarioId: 'u1' })
    })

    it('renderiza form com erro quando service falha', async () => {
      prisma.usuario.findUnique.mockResolvedValue({ id: 'admin1', nomeCompleto: 'Admin' })
      criarMock.mockRejectedValue(new Error('Nome duplicado.'))
      const res = await app.inject({
        method: 'POST', url: '/',
        ...form({ nome: 'X', descricao: '', adminUsuarioId: 'u1' }),
      })
      expect(res.body).toContain('Nome duplicado.')
    })
  })

  describe('PUT /:id', () => {
    it('valida nome obrigatório (recarrega form)', async () => {
      buscarComAdminsMock.mockResolvedValue(SISTEMA)
      const res = await app.inject({
        method: 'PUT', url: '/s1',
        ...form({ nome: '', descricao: '' }),
      })
      expect(res.body).toMatch(/nome é obrigatório/i)
      expect(atualizarMock).not.toHaveBeenCalled()
    })

    it('atualiza sem trocar admin quando adminUsuarioId vazio', async () => {
      atualizarMock.mockResolvedValue(undefined)
      const res = await app.inject({
        method: 'PUT', url: '/s1',
        ...form({ nome: 'Novo', descricao: 'd', ativo: 'true' }),
      })
      expect(res.statusCode).toBe(204)
      expect(atualizarMock).toHaveBeenCalledWith('s1', { nome: 'Novo', descricao: 'd', ativo: true })
      expect(trocarAdminMock).not.toHaveBeenCalled()
    })

    it('atualiza e troca admin quando adminUsuarioId presente', async () => {
      atualizarMock.mockResolvedValue(undefined)
      trocarAdminMock.mockResolvedValue(undefined)
      await app.inject({
        method: 'PUT', url: '/s1',
        ...form({ nome: 'N', descricao: '', adminUsuarioId: 'u2' }),
      })
      expect(trocarAdminMock).toHaveBeenCalledWith('s1', 'u2')
    })

    it('renderiza form com erro quando falha', async () => {
      atualizarMock.mockRejectedValue(new Error('Falha.'))
      buscarComAdminsMock.mockResolvedValue(SISTEMA)
      const res = await app.inject({
        method: 'PUT', url: '/s1',
        ...form({ nome: 'N', descricao: '' }),
      })
      expect(res.body).toContain('Falha.')
    })
  })

  describe('DELETE /:id', () => {
    it('exclui e retorna 200', async () => {
      excluirMock.mockResolvedValue(undefined)
      const res = await app.inject({ method: 'DELETE', url: '/s1' })
      expect(res.statusCode).toBe(200)
      expect(excluirMock).toHaveBeenCalledWith('s1', 'admin1', expect.anything())
    })

    it('retorna 400 quando falha', async () => {
      excluirMock.mockRejectedValue(new Error('Tem relatórios.'))
      const res = await app.inject({ method: 'DELETE', url: '/s1' })
      expect(res.statusCode).toBe(400)
      expect(res.body).toBe('Tem relatórios.')
    })
  })
})
