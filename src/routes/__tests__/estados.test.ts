import { describe, it, expect, beforeEach } from 'vitest'
import { criarApp, tokenJwt } from './helpers/criarApp.js'
import { estadosRoutes } from '../estados.js'
import type { FastifyInstance } from 'fastify'
import type { PrismaMock } from '../../services/__tests__/helpers/prisma-mock.js'

const ESTADO = { id: 'e1', nome: 'Minas Gerais', sigla: 'MG', modeloContabilId: null, criadoEm: new Date(), atualizadoEm: new Date() }
const MODELO = { id: 'm1', descricao: 'PCASP-MG', ativo: true }

describe('estadosRoutes', () => {
  let app: FastifyInstance
  let prisma: PrismaMock
  let auth: { authorization: string }

  beforeEach(async () => {
    ({ app, prisma } = await criarApp({ registrar: estadosRoutes, proteger: true }))
    auth = { authorization: `Bearer ${tokenJwt(app, { sub: 'u1', email: 'a@b.com' })}` }
  })

  it('GET /estados exige autenticação', async () => {
    const res = await app.inject({ method: 'GET', url: '/estados' })
    expect(res.statusCode).toBe(401)
  })

  it('GET /estados retorna lista', async () => {
    prisma.estado.findMany.mockResolvedValue([ESTADO])
    const res = await app.inject({ method: 'GET', url: '/estados', headers: auth })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toHaveLength(1)
  })

  it('GET /estados/:id retorna 404 quando não existe', async () => {
    prisma.estado.findUnique.mockResolvedValue(null)
    const res = await app.inject({ method: 'GET', url: '/estados/e1', headers: auth })
    expect(res.statusCode).toBe(404)
  })

  it('GET /estados/:id retorna o estado', async () => {
    prisma.estado.findUnique.mockResolvedValue(ESTADO)
    const res = await app.inject({ method: 'GET', url: '/estados/e1', headers: auth })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.sigla).toBe('MG')
  })

  it('PUT /estados/:id define o modelo e propaga aos municípios', async () => {
    prisma.estado.findUnique.mockResolvedValue(ESTADO)
    prisma.modeloContabil.findUnique.mockResolvedValue(MODELO)
    prisma.estado.update.mockResolvedValue({ ...ESTADO, modeloContabilId: 'm1' })
    prisma.municipio.updateMany.mockResolvedValue({ count: 853 })

    const res = await app.inject({
      method: 'PUT', url: '/estados/e1', headers: auth,
      payload: { modeloContabilId: '00000000-0000-0000-0000-000000000001' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.municipiosAtualizados).toBe(853)
  })

  it('PUT /estados/:id aceita modeloContabilId null (limpa)', async () => {
    prisma.estado.findUnique.mockResolvedValue({ ...ESTADO, modeloContabilId: 'm1' })
    prisma.estado.update.mockResolvedValue({ ...ESTADO, modeloContabilId: null })
    prisma.municipio.updateMany.mockResolvedValue({ count: 10 })

    const res = await app.inject({
      method: 'PUT', url: '/estados/e1', headers: auth,
      payload: { modeloContabilId: null },
    })
    expect(res.statusCode).toBe(200)
  })

  it('PUT /estados/:id retorna 404 quando estado não existe', async () => {
    prisma.estado.findUnique.mockResolvedValue(null)
    const res = await app.inject({
      method: 'PUT', url: '/estados/e1', headers: auth,
      payload: { modeloContabilId: '00000000-0000-0000-0000-000000000001' },
    })
    expect(res.statusCode).toBe(404)
  })

  it('PUT /estados/:id retorna 404 quando modelo não existe', async () => {
    prisma.estado.findUnique.mockResolvedValue(ESTADO)
    prisma.modeloContabil.findUnique.mockResolvedValue(null)
    const res = await app.inject({
      method: 'PUT', url: '/estados/e1', headers: auth,
      payload: { modeloContabilId: '00000000-0000-0000-0000-000000000001' },
    })
    expect(res.statusCode).toBe(404)
  })
})
