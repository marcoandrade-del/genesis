import { describe, it, expect, beforeEach } from 'vitest'
import { criarApp, tokenJwt } from './helpers/criarApp.js'
import { modelosContabeisRoutes } from '../modelos-contabeis.js'
import type { FastifyInstance } from 'fastify'
import type { PrismaMock } from '../../services/__tests__/helpers/prisma-mock.js'

const MODELO = { id: 'm1', descricao: 'PCASP-MG', ativo: true, criadoEm: new Date(), atualizadoEm: new Date() }

describe('modelosContabeisRoutes', () => {
  let app: FastifyInstance
  let prisma: PrismaMock
  let auth: { authorization: string }

  beforeEach(async () => {
    ({ app, prisma } = await criarApp({ registrar: modelosContabeisRoutes, proteger: true }))
    auth = { authorization: `Bearer ${tokenJwt(app, { sub: 'u1', email: 'a@b.com' })}` }
  })

  it('GET /modelos-contabeis exige autenticação', async () => {
    const res = await app.inject({ method: 'GET', url: '/modelos-contabeis' })
    expect(res.statusCode).toBe(401)
  })

  it('GET /modelos-contabeis retorna lista', async () => {
    prisma.modeloContabil.findMany.mockResolvedValue([MODELO])
    const res = await app.inject({ method: 'GET', url: '/modelos-contabeis', headers: auth })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toHaveLength(1)
  })

  it('GET /:id retorna 404 quando não existe', async () => {
    prisma.modeloContabil.findUnique.mockResolvedValue(null)
    const res = await app.inject({ method: 'GET', url: '/modelos-contabeis/m1', headers: auth })
    expect(res.statusCode).toBe(404)
  })

  it('GET /:id retorna o modelo', async () => {
    prisma.modeloContabil.findUnique.mockResolvedValue(MODELO)
    const res = await app.inject({ method: 'GET', url: '/modelos-contabeis/m1', headers: auth })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.id).toBe('m1')
  })

  it('POST exige descricao (400 sem)', async () => {
    const res = await app.inject({ method: 'POST', url: '/modelos-contabeis', headers: auth, payload: {} })
    expect(res.statusCode).toBe(400)
  })

  it('POST cria com sucesso (201)', async () => {
    prisma.modeloContabil.create.mockResolvedValue(MODELO)
    const res = await app.inject({
      method: 'POST', url: '/modelos-contabeis', headers: auth,
      payload: { descricao: 'PCASP-MG' },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().data.descricao).toBe('PCASP-MG')
  })

  it('POST retorna 409 quando duplicado (CONFLITO via P2002)', async () => {
    const { Prisma } = await import('@prisma/client')
    const erro = new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '7.0.0' })
    prisma.modeloContabil.create.mockRejectedValue(erro)
    const res = await app.inject({
      method: 'POST', url: '/modelos-contabeis', headers: auth,
      payload: { descricao: 'PCASP-MG' },
    })
    expect(res.statusCode).toBe(409)
  })

  it('PUT retorna 404 quando não existe', async () => {
    prisma.modeloContabil.findUnique.mockResolvedValue(null)
    const res = await app.inject({
      method: 'PUT', url: '/modelos-contabeis/m1', headers: auth,
      payload: { descricao: 'X' },
    })
    expect(res.statusCode).toBe(404)
  })

  it('PUT atualiza com sucesso', async () => {
    prisma.modeloContabil.findUnique.mockResolvedValue(MODELO)
    prisma.modeloContabil.update.mockResolvedValue({ ...MODELO, descricao: 'Novo' })
    const res = await app.inject({
      method: 'PUT', url: '/modelos-contabeis/m1', headers: auth,
      payload: { descricao: 'Novo' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.descricao).toBe('Novo')
  })

  it('PUT trata erro do service (409 quando conflito de descrição)', async () => {
    prisma.modeloContabil.findUnique.mockResolvedValue(MODELO)
    const { Prisma } = await import('@prisma/client')
    prisma.modeloContabil.update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '7.0.0' }),
    )
    const res = await app.inject({
      method: 'PUT', url: '/modelos-contabeis/m1', headers: auth,
      payload: { descricao: 'X' },
    })
    expect(res.statusCode).toBe(409)
  })

  it('DELETE retorna 204 quando excluído', async () => {
    prisma.modeloContabil.findUnique.mockResolvedValue(MODELO)
    prisma.estado.count.mockResolvedValue(0)
    prisma.municipio.count.mockResolvedValue(0)
    prisma.planoDeContas.count.mockResolvedValue(0)
    const res = await app.inject({ method: 'DELETE', url: '/modelos-contabeis/m1', headers: auth })
    expect(res.statusCode).toBe(204)
  })

  it('DELETE retorna 404 quando não existe', async () => {
    prisma.modeloContabil.findUnique.mockResolvedValue(null)
    const res = await app.inject({ method: 'DELETE', url: '/modelos-contabeis/m1', headers: auth })
    expect(res.statusCode).toBe(404)
  })

  it('DELETE retorna 409 quando em uso', async () => {
    prisma.modeloContabil.findUnique.mockResolvedValue(MODELO)
    prisma.estado.count.mockResolvedValue(1)
    prisma.municipio.count.mockResolvedValue(0)
    prisma.planoDeContas.count.mockResolvedValue(0)
    const res = await app.inject({ method: 'DELETE', url: '/modelos-contabeis/m1', headers: auth })
    expect(res.statusCode).toBe(409)
  })
})
