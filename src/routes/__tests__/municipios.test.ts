import { describe, it, expect, beforeEach } from 'vitest'
import { criarApp, tokenJwt } from './helpers/criarApp.js'
import { municipiosRoutes } from '../municipios.js'
import type { FastifyInstance } from 'fastify'
import type { PrismaMock } from '../../services/__tests__/helpers/prisma-mock.js'

const ESTADO = { id: 'e1', nome: 'MG', sigla: 'MG', modeloContabilId: 'm1' }
const MUNICIPIO = { id: 'mun1', nome: 'BH', estadoId: 'e1', modeloContabilId: null, criadoEm: new Date(), atualizadoEm: new Date() }

describe('municipiosRoutes', () => {
  let app: FastifyInstance
  let prisma: PrismaMock
  let auth: { authorization: string }

  beforeEach(async () => {
    ({ app, prisma } = await criarApp({ registrar: municipiosRoutes, proteger: true }))
    auth = { authorization: `Bearer ${tokenJwt(app, { sub: 'u1', email: 'a@b.com' })}` }
  })

  it('GET exige autenticação', async () => {
    const res = await app.inject({ method: 'GET', url: '/municipios' })
    expect(res.statusCode).toBe(401)
  })

  it('GET /municipios lista todos', async () => {
    prisma.municipio.findMany.mockResolvedValue([MUNICIPIO])
    const res = await app.inject({ method: 'GET', url: '/municipios', headers: auth })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toHaveLength(1)
  })

  it('GET /municipios?estadoId=... filtra', async () => {
    prisma.municipio.findMany.mockResolvedValue([])
    const res = await app.inject({ method: 'GET', url: '/municipios?estadoId=e1', headers: auth })
    expect(res.statusCode).toBe(200)
    expect(prisma.municipio.findMany).toHaveBeenCalledWith({ where: { estadoId: 'e1' }, orderBy: { nome: 'asc' } })
  })

  it('GET /:id retorna 404 quando não existe', async () => {
    prisma.municipio.findUnique.mockResolvedValue(null)
    const res = await app.inject({ method: 'GET', url: '/municipios/mun1', headers: auth })
    expect(res.statusCode).toBe(404)
  })

  it('GET /:id retorna município com modelo efetivo herdado', async () => {
    prisma.municipio.findUnique.mockResolvedValue({ ...MUNICIPIO, estado: { modeloContabilId: 'm1' } })
    const res = await app.inject({ method: 'GET', url: '/municipios/mun1', headers: auth })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toMatchObject({ modeloContabilEfetivoId: 'm1', herdaDoEstado: true })
  })

  it('POST exige nome e estadoId', async () => {
    const res = await app.inject({ method: 'POST', url: '/municipios', headers: auth, payload: { nome: 'BH' } })
    expect(res.statusCode).toBe(400)
  })

  it('POST cria com sucesso', async () => {
    prisma.estado.findUnique.mockResolvedValue(ESTADO)
    prisma.municipio.create.mockResolvedValue(MUNICIPIO)
    const res = await app.inject({
      method: 'POST', url: '/municipios', headers: auth,
      payload: { nome: 'BH', estadoId: '00000000-0000-0000-0000-000000000001' },
    })
    expect(res.statusCode).toBe(201)
  })

  it('POST retorna 404 quando estado não existe', async () => {
    prisma.estado.findUnique.mockResolvedValue(null)
    const res = await app.inject({
      method: 'POST', url: '/municipios', headers: auth,
      payload: { nome: 'BH', estadoId: '00000000-0000-0000-0000-000000000001' },
    })
    expect(res.statusCode).toBe(404)
  })

  it('PUT retorna 404 quando não existe', async () => {
    prisma.municipio.findUnique.mockResolvedValue(null)
    const res = await app.inject({
      method: 'PUT', url: '/municipios/mun1', headers: auth,
      payload: { nome: 'Novo' },
    })
    expect(res.statusCode).toBe(404)
  })

  it('PUT atualiza com sucesso (limpa modelo)', async () => {
    prisma.municipio.findUnique.mockResolvedValue(MUNICIPIO)
    prisma.municipio.update.mockResolvedValue({ ...MUNICIPIO, modeloContabilId: null })
    const res = await app.inject({
      method: 'PUT', url: '/municipios/mun1', headers: auth,
      payload: { modeloContabilId: null },
    })
    expect(res.statusCode).toBe(200)
  })

  it('PUT trata erro do service', async () => {
    prisma.municipio.findUnique.mockResolvedValue(MUNICIPIO)
    prisma.modeloContabil.findUnique.mockResolvedValue(null)
    const res = await app.inject({
      method: 'PUT', url: '/municipios/mun1', headers: auth,
      payload: { modeloContabilId: '00000000-0000-0000-0000-000000000099' },
    })
    expect(res.statusCode).toBe(404)
  })

  it('DELETE retorna 204', async () => {
    prisma.municipio.findUnique.mockResolvedValue(MUNICIPIO)
    prisma.lancamento.count.mockResolvedValue(0)
    prisma.resumoMensalConta.count.mockResolvedValue(0)
    prisma.saldoInicialAno.count.mockResolvedValue(0)
    const res = await app.inject({ method: 'DELETE', url: '/municipios/mun1', headers: auth })
    expect(res.statusCode).toBe(204)
  })

  it('DELETE retorna 409 quando há movimentação', async () => {
    prisma.municipio.findUnique.mockResolvedValue(MUNICIPIO)
    prisma.lancamento.count.mockResolvedValue(3)
    const res = await app.inject({ method: 'DELETE', url: '/municipios/mun1', headers: auth })
    expect(res.statusCode).toBe(409)
  })
})
