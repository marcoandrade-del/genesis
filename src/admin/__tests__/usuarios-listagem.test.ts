import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('argon2', () => ({ hash: vi.fn(async (s: string) => `hashed:${s}`) }))
vi.mock('../../services/email.js', () => ({ enviarCodigoEmail: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../../services/sms.js', () => ({ enviarCodigoSms: vi.fn().mockResolvedValue(undefined) }))

import { criarApp } from '../../routes/__tests__/helpers/criarApp.js'
import { adminUsuariosRoutes } from '../usuarios.js'
import type { FastifyInstance } from 'fastify'
import type { PrismaMock } from '../../services/__tests__/helpers/prisma-mock.js'

const USUARIO_DB = {
  id: 'u1',
  cpf: '52998224725',
  idEstrangeiro: null,
  nomeCompleto: 'Maria',
  nomeSocial: '',
  dataNascimento: new Date('1990-01-01'),
  emailPrincipal: 'maria@x.com',
  emailAlternativo: null,
  telefonePrincipal: '11999',
  telefoneAlternativo: null,
  emailValidado: true,
  celularValidado: true,
  ativo: true,
  criadoEm: new Date(),
  atualizadoEm: new Date(),
}

describe('adminUsuariosRoutes — listagem e formulários', () => {
  let app: FastifyInstance
  let prisma: PrismaMock

  beforeEach(async () => {
    ;({ app, prisma } = await criarApp({
      registrar: adminUsuariosRoutes,
      comView: true,
      simularAdmin: { sub: 'admin1', email: 'admin@x.com' },
    }))
  })

  describe('GET /', () => {
    it('lista sem filtro (AND vazio)', async () => {
      prisma.usuario.findMany.mockResolvedValue([])
      prisma.usuario.count.mockResolvedValue(0)
      const res = await app.inject({ method: 'GET', url: '/' })
      expect(res.statusCode).toBe(200)
      expect(prisma.usuario.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { AND: [{}, {}] },
      }))
    })

    it('busca aplica OR em nome/email', async () => {
      prisma.usuario.findMany.mockResolvedValue([])
      prisma.usuario.count.mockResolvedValue(0)
      await app.inject({ method: 'GET', url: '/?busca=maria' })
      const call = prisma.usuario.findMany.mock.calls[0]?.[0] as { where: { AND: unknown[] } }
      expect(call.where.AND[0]).toEqual({
        OR: [
          { nomeCompleto: { contains: 'maria', mode: 'insensitive' } },
          { emailPrincipal: { contains: 'maria', mode: 'insensitive' } },
        ],
      })
    })

    it('status=ativo filtra ativo:true', async () => {
      prisma.usuario.findMany.mockResolvedValue([])
      prisma.usuario.count.mockResolvedValue(0)
      await app.inject({ method: 'GET', url: '/?status=ativo' })
      const call = prisma.usuario.findMany.mock.calls[0]?.[0] as { where: { AND: unknown[] } }
      expect(call.where.AND[1]).toEqual({ ativo: true })
    })

    it('status=inativo filtra ativo:false + emailValidado:false', async () => {
      prisma.usuario.findMany.mockResolvedValue([])
      prisma.usuario.count.mockResolvedValue(0)
      await app.inject({ method: 'GET', url: '/?status=inativo' })
      const call = prisma.usuario.findMany.mock.calls[0]?.[0] as { where: { AND: unknown[] } }
      expect(call.where.AND[1]).toEqual({ ativo: false, emailValidado: false })
    })

    it('status=pendente filtra ativo:false + OR (email ou celular validado)', async () => {
      prisma.usuario.findMany.mockResolvedValue([])
      prisma.usuario.count.mockResolvedValue(0)
      await app.inject({ method: 'GET', url: '/?status=pendente' })
      const call = prisma.usuario.findMany.mock.calls[0]?.[0] as { where: { AND: unknown[] } }
      expect(call.where.AND[1]).toEqual({
        ativo: false,
        OR: [{ emailValidado: true }, { celularValidado: true }],
      })
    })
  })

  describe('GET /lista', () => {
    it('renderiza partial lista', async () => {
      prisma.usuario.findMany.mockResolvedValue([])
      prisma.usuario.count.mockResolvedValue(0)
      const res = await app.inject({ method: 'GET', url: '/lista' })
      expect(res.statusCode).toBe(200)
    })
  })

  describe('GET /form e GET /:id/form', () => {
    it('renderiza form vazio', async () => {
      const res = await app.inject({ method: 'GET', url: '/form' })
      expect(res.statusCode).toBe(200)
    })

    it('renderiza form de edição quando usuário existe', async () => {
      prisma.usuario.findUnique.mockResolvedValue({ ...USUARIO_DB })
      const res = await app.inject({ method: 'GET', url: '/u1/form' })
      expect(res.statusCode).toBe(200)
    })
  })

  describe('PUT /:id — usuário inexistente', () => {
    it('renderiza form com mensagem quando id não existe', async () => {
      prisma.usuario.findUnique.mockResolvedValue(null)
      const res = await app.inject({
        method: 'PUT', url: '/u1',
        payload: new URLSearchParams({ nomeCompleto: 'X', ativo: 'true' }).toString(),
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      })
      expect(res.body).toContain('Usuário não encontrado.')
    })
  })

  describe('POST / — erro no service', () => {
    it('renderiza form com mensagem quando criar falha', async () => {
      prisma.usuario.create.mockRejectedValue(new Error('CPF inválido.'))
      const res = await app.inject({
        method: 'POST', url: '/',
        payload: new URLSearchParams({
          nomeCompleto: 'X', dataNascimento: '1990-01-01',
          emailPrincipal: 'x@x.com', telefonePrincipal: '1', senha: 'abc',
          cpf: '00000000000',
        }).toString(),
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      })
      expect(res.body).toContain('CPF inválido.')
    })
  })
})
