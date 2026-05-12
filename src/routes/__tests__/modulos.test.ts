import { describe, it, expect, beforeEach } from 'vitest'
import { criarApp, tokenJwt } from './helpers/criarApp.js'
import { modulosRoutes } from '../modulos.js'
import type { FastifyInstance } from 'fastify'
import type { PrismaMock } from '../../services/__tests__/helpers/prisma-mock.js'

const SISTEMA = { id: 's1', nome: 'S', descricao: null, ativo: true, criadoEm: new Date(), atualizadoEm: new Date() }
const MODULO = { id: 'm1', sistemaId: 's1', nome: 'Mod', descricao: null, ativo: true, criadoEm: new Date(), atualizadoEm: new Date() }
const ADMIN_USER = { id: 'u1', nomeCompleto: 'A', ativo: true }

describe('modulosRoutes', () => {
  let app: FastifyInstance
  let prisma: PrismaMock
  let auth: { authorization: string }

  beforeEach(async () => {
    ({ app, prisma } = await criarApp({ registrar: modulosRoutes, proteger: true }))
    auth = { authorization: `Bearer ${tokenJwt(app, { sub: 'u1', email: 'a@b.com' })}` }
  })

  it('GET /sistemas/:sistemaId/modulos exige auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/sistemas/s1/modulos' })
    expect(res.statusCode).toBe(401)
  })

  it('GET /sistemas/:sistemaId/modulos retorna 404 se sistema não existe', async () => {
    prisma.sistema.findUnique.mockResolvedValue(null)
    const res = await app.inject({ method: 'GET', url: '/sistemas/s1/modulos', headers: auth })
    expect(res.statusCode).toBe(404)
  })

  it('GET /sistemas/:sistemaId/modulos retorna lista', async () => {
    prisma.sistema.findUnique.mockResolvedValue(SISTEMA)
    prisma.modulo.findMany.mockResolvedValue([MODULO])
    const res = await app.inject({ method: 'GET', url: '/sistemas/s1/modulos', headers: auth })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toHaveLength(1)
  })

  it('GET /modulos/:id retorna 404 quando não existe', async () => {
    prisma.modulo.findUnique.mockResolvedValue(null)
    const res = await app.inject({ method: 'GET', url: '/modulos/m1', headers: auth })
    expect(res.statusCode).toBe(404)
  })

  it('POST /sistemas/:sistemaId/modulos retorna 201', async () => {
    prisma.sistema.findUnique.mockResolvedValue(SISTEMA)
    prisma.usuario.findUnique.mockResolvedValue(ADMIN_USER)
    prisma.modulo.create.mockResolvedValue(MODULO)
    prisma.adminModulo.create.mockResolvedValue({})

    const res = await app.inject({
      method: 'POST', url: '/sistemas/s1/modulos', headers: auth,
      payload: { nome: 'Mod', adminUsuarioId: '00000000-0000-0000-0000-000000000001' },
    })
    expect(res.statusCode).toBe(201)
  })

  it('POST /sistemas/:sistemaId/modulos retorna 409 quando sistema inativo', async () => {
    prisma.sistema.findUnique.mockResolvedValue({ ...SISTEMA, ativo: false })
    const res = await app.inject({
      method: 'POST', url: '/sistemas/s1/modulos', headers: auth,
      payload: { nome: 'Mod', adminUsuarioId: '00000000-0000-0000-0000-000000000001' },
    })
    expect(res.statusCode).toBe(409)
  })

  it('PUT /modulos/:id retorna 404 quando não existe', async () => {
    prisma.modulo.findUnique.mockResolvedValue(null)
    const res = await app.inject({
      method: 'PUT', url: '/modulos/m1', headers: auth,
      payload: { nome: 'Novo' },
    })
    expect(res.statusCode).toBe(404)
  })

  it('PUT /modulos/:id atualiza com sucesso', async () => {
    prisma.modulo.findUnique.mockResolvedValue(MODULO)
    prisma.modulo.update.mockResolvedValue({ ...MODULO, nome: 'Novo' })
    const res = await app.inject({
      method: 'PUT', url: '/modulos/m1', headers: auth,
      payload: { nome: 'Novo' },
    })
    expect(res.statusCode).toBe(200)
  })

  it('DELETE /modulos/:id retorna 404 quando não existe', async () => {
    prisma.modulo.findUnique.mockResolvedValue(null)
    const res = await app.inject({ method: 'DELETE', url: '/modulos/m1', headers: auth })
    expect(res.statusCode).toBe(404)
  })
})
