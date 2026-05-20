import { describe, it, expect, beforeEach, vi } from 'vitest'

const { buscarPorIdMock, criarMock, atualizarMock, excluirMock } = vi.hoisted(() => ({
  buscarPorIdMock: vi.fn(),
  criarMock: vi.fn(),
  atualizarMock: vi.fn(),
  excluirMock: vi.fn(),
}))

vi.mock('../../services/modulos.js', () => ({
  ModulosService: class {
    buscarPorId = buscarPorIdMock
    criar = criarMock
    atualizar = atualizarMock
    excluir = excluirMock
  },
}))
vi.mock('../../services/lixeira.js', () => ({
  LixeiraService: class {},
}))

import { criarApp } from '../../routes/__tests__/helpers/criarApp.js'
import { adminModulosRoutes } from '../modulos.js'
import type { FastifyInstance } from 'fastify'
import type { PrismaMock } from '../../services/__tests__/helpers/prisma-mock.js'

function form(obj: Record<string, string>) {
  return {
    payload: new URLSearchParams(obj).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  }
}

describe('adminModulosRoutes', () => {
  let app: FastifyInstance
  let prisma: PrismaMock

  beforeEach(async () => {
    [buscarPorIdMock, criarMock, atualizarMock, excluirMock].forEach(m => m.mockReset())
    ;({ app, prisma } = await criarApp({
      registrar: adminModulosRoutes,
      comView: true,
      simularAdmin: { sub: 'admin1', email: 'admin@x.com' },
    }))
  })

  describe('GET /', () => {
    it('lista módulos sem filtro', async () => {
      prisma.modulo.findMany.mockResolvedValue([])
      prisma.sistema.findMany.mockResolvedValue([])

      const res = await app.inject({ method: 'GET', url: '/' })

      expect(res.statusCode).toBe(200)
      expect(prisma.modulo.findMany).toHaveBeenCalledWith(
        expect.not.objectContaining({ where: expect.anything() }),
      )
    })

    it('filtra por sistemaId quando fornecido', async () => {
      prisma.modulo.findMany.mockResolvedValue([])
      prisma.sistema.findMany.mockResolvedValue([])

      await app.inject({ method: 'GET', url: '/?sistemaId=s1' })

      expect(prisma.modulo.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { sistemaId: 's1' },
      }))
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
    it('retorna 404 quando módulo não existe', async () => {
      buscarPorIdMock.mockResolvedValue(null)
      const res = await app.inject({ method: 'GET', url: '/m1/form' })
      expect(res.statusCode).toBe(404)
    })

    it('renderiza form com módulo e nome do sistema', async () => {
      buscarPorIdMock.mockResolvedValue({ id: 'm1', sistemaId: 's1', nome: 'Mod' })
      prisma.sistema.findUnique.mockResolvedValue({ nome: 'ERP' })
      const res = await app.inject({ method: 'GET', url: '/m1/form' })
      expect(res.statusCode).toBe(200)
      expect(buscarPorIdMock).toHaveBeenCalledWith('m1')
    })
  })

  describe('POST /', () => {
    it('re-renderiza form com erro quando sistemaId vazio', async () => {
      prisma.usuario.findUnique.mockResolvedValue({ id: 'admin1', nomeCompleto: 'Admin' })

      const res = await app.inject({
        method: 'POST', url: '/',
        ...form({ nome: 'X', descricao: '', sistemaId: '', adminUsuarioId: 'u1' }),
      })

      expect(res.statusCode).toBe(200)
      expect(res.body).toMatch(/Selecione um sistema/)
      expect(criarMock).not.toHaveBeenCalled()
    })

    it('re-renderiza form com erro quando adminUsuarioId vazio', async () => {
      prisma.usuario.findUnique.mockResolvedValue({ id: 'admin1', nomeCompleto: 'Admin' })

      const res = await app.inject({
        method: 'POST', url: '/',
        ...form({ nome: 'X', descricao: '', sistemaId: 's1', adminUsuarioId: '' }),
      })

      expect(res.statusCode).toBe(200)
      expect(res.body).toMatch(/Selecione um usuário/)
      expect(criarMock).not.toHaveBeenCalled()
    })

    it('cria módulo e redireciona via HX-Redirect', async () => {
      criarMock.mockResolvedValue({ id: 'm1' })

      const res = await app.inject({
        method: 'POST', url: '/',
        ...form({ nome: 'Mod', descricao: 'desc', sistemaId: 's1', adminUsuarioId: 'u1' }),
      })

      expect(res.statusCode).toBe(204)
      expect(res.headers['hx-redirect']).toBe('/admin/modulos')
      expect(criarMock).toHaveBeenCalledWith('s1', { nome: 'Mod', adminUsuarioId: 'u1', descricao: 'desc' })
    })

    it('omite descricao quando vazia', async () => {
      criarMock.mockResolvedValue({ id: 'm1' })

      await app.inject({
        method: 'POST', url: '/',
        ...form({ nome: 'Mod', descricao: '', sistemaId: 's1', adminUsuarioId: 'u1' }),
      })

      expect(criarMock).toHaveBeenCalledWith('s1', { nome: 'Mod', adminUsuarioId: 'u1' })
    })

    it('renderiza form com erro quando criação falha', async () => {
      prisma.usuario.findUnique.mockResolvedValue({ id: 'admin1', nomeCompleto: 'Admin' })
      criarMock.mockRejectedValue(new Error('Nome duplicado.'))

      const res = await app.inject({
        method: 'POST', url: '/',
        ...form({ nome: 'X', descricao: '', sistemaId: 's1', adminUsuarioId: 'u1' }),
      })

      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Nome duplicado.')
    })
  })

  describe('PUT /:id', () => {
    it('atualiza e redireciona via HX-Redirect', async () => {
      atualizarMock.mockResolvedValue(undefined)

      const res = await app.inject({
        method: 'PUT', url: '/m1',
        ...form({ nome: 'Novo', descricao: 'nova', ativo: 'true' }),
      })

      expect(res.statusCode).toBe(204)
      expect(res.headers['hx-redirect']).toBe('/admin/modulos')
      expect(atualizarMock).toHaveBeenCalledWith('m1', { nome: 'Novo', descricao: 'nova', ativo: true })
    })

    it('converte ativo=false corretamente', async () => {
      atualizarMock.mockResolvedValue(undefined)
      await app.inject({
        method: 'PUT', url: '/m1',
        ...form({ nome: 'N', descricao: '', ativo: 'false' }),
      })
      expect(atualizarMock).toHaveBeenCalledWith('m1', { nome: 'N', ativo: false })
    })

    it('renderiza form com erro quando atualização falha', async () => {
      atualizarMock.mockRejectedValue(new Error('Falha.'))
      buscarPorIdMock.mockResolvedValue({ id: 'm1', sistemaId: 's1', nome: 'X' })
      prisma.sistema.findUnique.mockResolvedValue({ nome: 'ERP' })

      const res = await app.inject({
        method: 'PUT', url: '/m1',
        ...form({ nome: 'N', descricao: '' }),
      })

      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Falha.')
    })
  })

  describe('DELETE /:id', () => {
    it('exclui e retorna 200', async () => {
      excluirMock.mockResolvedValue(undefined)
      const res = await app.inject({ method: 'DELETE', url: '/m1' })
      expect(res.statusCode).toBe(200)
      expect(excluirMock).toHaveBeenCalledWith('m1', 'admin1', expect.anything())
    })

    it('retorna 400 com mensagem quando falha', async () => {
      excluirMock.mockRejectedValue(new Error('Tem dependentes.'))
      const res = await app.inject({ method: 'DELETE', url: '/m1' })
      expect(res.statusCode).toBe(400)
      expect(res.body).toBe('Tem dependentes.')
    })
  })
})
