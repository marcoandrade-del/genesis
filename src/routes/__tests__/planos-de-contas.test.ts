import { describe, it, expect, beforeEach } from 'vitest'
import { criarApp, tokenJwt } from './helpers/criarApp.js'
import { planosDeContasRoutes } from '../planos-de-contas.js'
import type { FastifyInstance } from 'fastify'
import type { PrismaMock } from '../../services/__tests__/helpers/prisma-mock.js'

const MODELO = { id: 'm1', descricao: 'PCASP-MG', ativo: true }
const PLANO = { id: 'p1', descricao: 'PCASP 2026', ano: 2026, modeloContabilId: 'm1', criadoEm: new Date(), atualizadoEm: new Date() }

describe('planosDeContasRoutes', () => {
  let app: FastifyInstance
  let prisma: PrismaMock
  let auth: { authorization: string }

  beforeEach(async () => {
    ({ app, prisma } = await criarApp({ registrar: planosDeContasRoutes, proteger: true }))
    auth = { authorization: `Bearer ${tokenJwt(app, { sub: 'u1', email: 'a@b.com' })}` }
  })

  it('GET exige autenticação', async () => {
    const res = await app.inject({ method: 'GET', url: '/planos-de-contas' })
    expect(res.statusCode).toBe(401)
  })

  it('GET /planos-de-contas lista', async () => {
    prisma.planoDeContas.findMany.mockResolvedValue([PLANO])
    const res = await app.inject({ method: 'GET', url: '/planos-de-contas', headers: auth })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toHaveLength(1)
  })

  it('GET com modeloContabilId filtra', async () => {
    prisma.planoDeContas.findMany.mockResolvedValue([])
    const res = await app.inject({ method: 'GET', url: '/planos-de-contas?modeloContabilId=m1', headers: auth })
    expect(res.statusCode).toBe(200)
    expect(prisma.planoDeContas.findMany).toHaveBeenCalledWith({
      where: { modeloContabilId: 'm1' },
      orderBy: [{ modeloContabilId: 'asc' }, { ano: 'desc' }],
    })
  })

  it('GET /:id 404 quando não existe', async () => {
    prisma.planoDeContas.findUnique.mockResolvedValue(null)
    const res = await app.inject({ method: 'GET', url: '/planos-de-contas/p1', headers: auth })
    expect(res.statusCode).toBe(404)
  })

  it('GET /:id 200 quando existe', async () => {
    prisma.planoDeContas.findUnique.mockResolvedValue(PLANO)
    const res = await app.inject({ method: 'GET', url: '/planos-de-contas/p1', headers: auth })
    expect(res.statusCode).toBe(200)
  })

  it('POST 400 quando faltam campos', async () => {
    const res = await app.inject({ method: 'POST', url: '/planos-de-contas', headers: auth, payload: { ano: 2026 } })
    expect(res.statusCode).toBe(400)
  })

  it('POST cria com 201', async () => {
    prisma.modeloContabil.findUnique.mockResolvedValue(MODELO)
    prisma.planoDeContas.create.mockResolvedValue(PLANO)
    const res = await app.inject({
      method: 'POST', url: '/planos-de-contas', headers: auth,
      payload: { descricao: 'X', ano: 2026, modeloContabilId: '00000000-0000-0000-0000-000000000001' },
    })
    expect(res.statusCode).toBe(201)
  })

  it('POST trata erro do service (404 modelo inexistente)', async () => {
    prisma.modeloContabil.findUnique.mockResolvedValue(null)
    const res = await app.inject({
      method: 'POST', url: '/planos-de-contas', headers: auth,
      payload: { descricao: 'X', ano: 2026, modeloContabilId: '00000000-0000-0000-0000-000000000099' },
    })
    expect(res.statusCode).toBe(404)
  })

  it('PUT 404 quando plano não existe', async () => {
    prisma.planoDeContas.findUnique.mockResolvedValue(null)
    const res = await app.inject({
      method: 'PUT', url: '/planos-de-contas/p1', headers: auth,
      payload: { descricao: 'Novo' },
    })
    expect(res.statusCode).toBe(404)
  })

  it('PUT atualiza com 200', async () => {
    prisma.planoDeContas.findUnique.mockResolvedValue(PLANO)
    prisma.planoDeContas.update.mockResolvedValue({ ...PLANO, descricao: 'Novo' })
    const res = await app.inject({
      method: 'PUT', url: '/planos-de-contas/p1', headers: auth,
      payload: { descricao: 'Novo' },
    })
    expect(res.statusCode).toBe(200)
  })

  it('PUT trata erro do service', async () => {
    prisma.planoDeContas.findUnique.mockResolvedValue(PLANO)
    const { Prisma } = await import('@prisma/client')
    prisma.planoDeContas.update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '7.0.0' }),
    )
    const res = await app.inject({
      method: 'PUT', url: '/planos-de-contas/p1', headers: auth,
      payload: { ano: 2025 },
    })
    expect(res.statusCode).toBe(409)
  })

  it('DELETE 204', async () => {
    prisma.planoDeContas.findUnique.mockResolvedValue(PLANO)
    prisma.conta.count.mockResolvedValue(0)
    const res = await app.inject({ method: 'DELETE', url: '/planos-de-contas/p1', headers: auth })
    expect(res.statusCode).toBe(204)
  })

  it('DELETE 409 quando há contas', async () => {
    prisma.planoDeContas.findUnique.mockResolvedValue(PLANO)
    prisma.conta.count.mockResolvedValue(5)
    const res = await app.inject({ method: 'DELETE', url: '/planos-de-contas/p1', headers: auth })
    expect(res.statusCode).toBe(409)
  })
})
