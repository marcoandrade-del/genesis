import { describe, it, expect, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'
import { criarApp, tokenJwt } from './helpers/criarApp.js'
import { adminsRoutes } from '../admins.js'
import type { FastifyInstance } from 'fastify'
import type { PrismaMock } from '../../services/__tests__/helpers/prisma-mock.js'

const SISTEMA = { id: 's1', nome: 'S', descricao: null, ativo: true, criadoEm: new Date(), atualizadoEm: new Date() }
const MODULO = { id: 'm1', sistemaId: 's1', nome: 'M', descricao: null, ativo: true, criadoEm: new Date(), atualizadoEm: new Date() }
const USUARIO = { id: 'u1', nomeCompleto: 'A', ativo: true }

describe('adminsRoutes', () => {
  let app: FastifyInstance
  let prisma: PrismaMock
  let auth: { authorization: string }

  beforeEach(async () => {
    ({ app, prisma } = await criarApp({ registrar: adminsRoutes, proteger: true }))
    auth = { authorization: `Bearer ${tokenJwt(app, { sub: 'u1', email: 'a@b.com' })}` }
  })

  it('GET /sistemas/:sistemaId/admins exige auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/sistemas/s1/admins' })
    expect(res.statusCode).toBe(401)
  })

  it('GET /sistemas/:sistemaId/admins retorna 404 quando sistema não existe', async () => {
    prisma.sistema.findUnique.mockResolvedValue(null)
    const res = await app.inject({ method: 'GET', url: '/sistemas/s1/admins', headers: auth })
    expect(res.statusCode).toBe(404)
  })

  it('POST /sistemas/:sistemaId/admins retorna 201', async () => {
    prisma.sistema.findUnique.mockResolvedValue(SISTEMA)
    prisma.usuario.findUnique.mockResolvedValue(USUARIO)
    prisma.adminSistema.create.mockResolvedValue({ id: 'as1' })
    const res = await app.inject({
      method: 'POST', url: '/sistemas/s1/admins', headers: auth,
      payload: { usuarioId: '00000000-0000-0000-0000-000000000001' },
    })
    expect(res.statusCode).toBe(201)
  })

  it('POST /sistemas/:sistemaId/admins retorna 409 quando usuário já é admin (P2002)', async () => {
    prisma.sistema.findUnique.mockResolvedValue(SISTEMA)
    prisma.usuario.findUnique.mockResolvedValue(USUARIO)
    prisma.adminSistema.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '7.0' })
    )
    const res = await app.inject({
      method: 'POST', url: '/sistemas/s1/admins', headers: auth,
      payload: { usuarioId: '00000000-0000-0000-0000-000000000001' },
    })
    expect(res.statusCode).toBe(409)
  })

  it('DELETE /sistemas/:sistemaId/admins/:usuarioId retorna 204 quando bem-sucedido', async () => {
    prisma.adminSistema.findUnique.mockResolvedValue({ id: 'as1', ativo: true })
    prisma.adminSistema.count.mockResolvedValue(2)
    prisma.adminSistema.delete.mockResolvedValue({})
    const res = await app.inject({ method: 'DELETE', url: '/sistemas/s1/admins/u1', headers: auth })
    expect(res.statusCode).toBe(204)
  })

  it('DELETE /sistemas/:sistemaId/admins/:usuarioId retorna 409 ao tentar remover último admin ativo', async () => {
    prisma.adminSistema.findUnique.mockResolvedValue({ id: 'as1', ativo: true })
    prisma.adminSistema.count.mockResolvedValue(1)
    const res = await app.inject({ method: 'DELETE', url: '/sistemas/s1/admins/u1', headers: auth })
    expect(res.statusCode).toBe(409)
  })

  it('GET /modulos/:moduloId/admins retorna 404 quando módulo não existe', async () => {
    prisma.modulo.findUnique.mockResolvedValue(null)
    const res = await app.inject({ method: 'GET', url: '/modulos/m1/admins', headers: auth })
    expect(res.statusCode).toBe(404)
  })

  it('POST /modulos/:moduloId/admins retorna 201', async () => {
    prisma.modulo.findUnique.mockResolvedValue(MODULO)
    prisma.usuario.findUnique.mockResolvedValue(USUARIO)
    prisma.adminModulo.create.mockResolvedValue({ id: 'am1' })
    const res = await app.inject({
      method: 'POST', url: '/modulos/m1/admins', headers: auth,
      payload: { usuarioId: '00000000-0000-0000-0000-000000000001' },
    })
    expect(res.statusCode).toBe(201)
  })

  it('DELETE /modulos/:moduloId/admins/:usuarioId retorna 409 ao tentar remover último admin ativo', async () => {
    prisma.adminModulo.findUnique.mockResolvedValue({ id: 'am1', ativo: true })
    prisma.adminModulo.count.mockResolvedValue(1)
    const res = await app.inject({ method: 'DELETE', url: '/modulos/m1/admins/u1', headers: auth })
    expect(res.statusCode).toBe(409)
  })
})
