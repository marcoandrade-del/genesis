import { describe, it, expect, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'
import { criarApp, tokenJwt } from './helpers/criarApp.js'
import { adminsRoutes } from '../admins.js'
import type { FastifyInstance } from 'fastify'
import type { PrismaMock } from '../../services/__tests__/helpers/prisma-mock.js'

const SISTEMA = { id: 's1', nome: 'S', descricao: null, ativo: true, criadoEm: new Date(), atualizadoEm: new Date() }
const MODULO = { id: 'm1', sistemaId: 's1', nome: 'M', descricao: null, ativo: true, criadoEm: new Date(), atualizadoEm: new Date() }

describe('adminsRoutes — caminhos de sucesso e erros restantes', () => {
  let app: FastifyInstance
  let prisma: PrismaMock
  let auth: { authorization: string }

  beforeEach(async () => {
    ({ app, prisma } = await criarApp({ registrar: adminsRoutes, proteger: true }))
    auth = { authorization: `Bearer ${tokenJwt(app, { sub: 'u1', email: 'a@b.com' })}` }
    prisma.adminSistema.findUnique.mockResolvedValue({ id: 'as0', ativo: true })
    prisma.adminModulo.findUnique.mockResolvedValue({ id: 'am0', ativo: true })
  })

  // Line 18 — GET /sistemas/:sistemaId/admins success
  it('GET /sistemas/:sistemaId/admins retorna lista de admins', async () => {
    prisma.sistema.findUnique.mockResolvedValue(SISTEMA)
    prisma.adminSistema.findMany.mockResolvedValue([
      { id: 'as1', usuarioId: 'u1', sistemaId: 's1', ativo: true, criadoEm: new Date() },
    ])
    const res = await app.inject({ method: 'GET', url: '/sistemas/s1/admins', headers: auth })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toHaveLength(1)
  })

  // Line 60 — GET /modulos/:moduloId/admins success
  it('GET /modulos/:moduloId/admins retorna lista de admins', async () => {
    prisma.modulo.findUnique.mockResolvedValue(MODULO)
    prisma.adminModulo.findMany.mockResolvedValue([
      { id: 'am1', usuarioId: 'u1', moduloId: 'm1', ativo: true, criadoEm: new Date() },
    ])
    const res = await app.inject({ method: 'GET', url: '/modulos/m1/admins', headers: auth })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toHaveLength(1)
  })

  // Line 76 — POST /modulos/:moduloId/admins catch
  it('POST /modulos/:moduloId/admins retorna 409 quando usuário já é admin (P2002)', async () => {
    prisma.modulo.findUnique.mockResolvedValue(MODULO)
    prisma.usuario.findUnique.mockResolvedValue({ id: 'u1', nomeCompleto: 'A', ativo: true })
    prisma.adminModulo.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '7.0' }),
    )
    const res = await app.inject({
      method: 'POST', url: '/modulos/m1/admins', headers: auth,
      payload: { usuarioId: '00000000-0000-0000-0000-000000000001' },
    })
    expect(res.statusCode).toBe(409)
  })

  // Line 87 — DELETE /modulos/:moduloId/admins/:usuarioId success
  it('DELETE /modulos/:moduloId/admins/:usuarioId retorna 204 quando bem-sucedido', async () => {
    prisma.adminModulo.findUnique.mockResolvedValue({ id: 'am1', ativo: true })
    prisma.adminModulo.count.mockResolvedValue(2)
    prisma.adminModulo.delete.mockResolvedValue({})
    const res = await app.inject({ method: 'DELETE', url: '/modulos/m1/admins/u1', headers: auth })
    expect(res.statusCode).toBe(204)
  })
})
