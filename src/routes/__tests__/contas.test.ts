import { describe, it, expect, beforeEach } from 'vitest'
import { criarApp, tokenJwt } from './helpers/criarApp.js'
import { contasRoutes } from '../contas.js'
import type { FastifyInstance } from 'fastify'
import type { PrismaMock } from '../../services/__tests__/helpers/prisma-mock.js'

const PLANO = { id: 'p1', descricao: 'PCASP 2026', ano: 2026, modeloContabilId: 'm1' }
const CONTA = { id: 'c1', codigo: '1', descricao: 'Ativo', nivel: 1, admiteMovimento: false, planoId: 'p1', parentId: null }

describe('contasRoutes', () => {
  let app: FastifyInstance
  let prisma: PrismaMock
  let auth: { authorization: string }

  beforeEach(async () => {
    ({ app, prisma } = await criarApp({ registrar: contasRoutes, proteger: true }))
    auth = { authorization: `Bearer ${tokenJwt(app, { sub: 'u1', email: 'a@b.com' })}` }
  })

  it('GET exige autenticação', async () => {
    const res = await app.inject({ method: 'GET', url: '/planos-de-contas/p1/contas' })
    expect(res.statusCode).toBe(401)
  })

  it('GET lista contas do plano', async () => {
    prisma.conta.findMany.mockResolvedValue([CONTA])
    const res = await app.inject({ method: 'GET', url: '/planos-de-contas/p1/contas', headers: auth })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toHaveLength(1)
  })

  it('GET /contas/:id 404', async () => {
    prisma.conta.findUnique.mockResolvedValue(null)
    const res = await app.inject({ method: 'GET', url: '/contas/c1', headers: auth })
    expect(res.statusCode).toBe(404)
  })

  it('GET /contas/:id 200', async () => {
    prisma.conta.findUnique.mockResolvedValue(CONTA)
    const res = await app.inject({ method: 'GET', url: '/contas/c1', headers: auth })
    expect(res.statusCode).toBe(200)
  })

  it('POST 400 quando falta codigo/descricao', async () => {
    const res = await app.inject({ method: 'POST', url: '/planos-de-contas/p1/contas', headers: auth, payload: {} })
    expect(res.statusCode).toBe(400)
  })

  it('POST cria conta raiz', async () => {
    prisma.planoDeContas.findUnique.mockResolvedValue(PLANO)
    prisma.conta.create.mockResolvedValue(CONTA)
    const res = await app.inject({
      method: 'POST', url: '/planos-de-contas/p1/contas', headers: auth,
      payload: { codigo: '1', descricao: 'Ativo' },
    })
    expect(res.statusCode).toBe(201)
  })

  it('POST trata erro (404 plano inexistente)', async () => {
    prisma.planoDeContas.findUnique.mockResolvedValue(null)
    const res = await app.inject({
      method: 'POST', url: '/planos-de-contas/p1/contas', headers: auth,
      payload: { codigo: '1', descricao: 'X' },
    })
    expect(res.statusCode).toBe(404)
  })

  it('POST cria filha de conta analítica e torna o pai sintética (201)', async () => {
    prisma.planoDeContas.findUnique.mockResolvedValue(PLANO)
    prisma.conta.findUnique.mockResolvedValue({ ...CONTA, admiteMovimento: true, nivel: 2 })
    prisma.conta.create.mockResolvedValue({ ...CONTA, id: 'cN', nivel: 3, admiteMovimento: true, parentId: '00000000-0000-0000-0000-000000000001' })
    const res = await app.inject({
      method: 'POST', url: '/planos-de-contas/p1/contas', headers: auth,
      payload: { codigo: '1.1', descricao: 'X', parentId: '00000000-0000-0000-0000-000000000001' },
    })
    expect(res.statusCode).toBe(201)
    expect(prisma.conta.update).toHaveBeenCalledWith({ where: { id: '00000000-0000-0000-0000-000000000001' }, data: { admiteMovimento: false } })
  })

  it('PUT atualiza com 200', async () => {
    prisma.conta.findUnique.mockResolvedValue(CONTA)
    prisma.conta.update.mockResolvedValue({ ...CONTA, descricao: 'Novo' })
    const res = await app.inject({
      method: 'PUT', url: '/contas/c1', headers: auth,
      payload: { descricao: 'Novo' },
    })
    expect(res.statusCode).toBe(200)
  })

  it('PUT trata erro (404 conta não existe)', async () => {
    prisma.conta.findUnique.mockResolvedValue(null)
    const res = await app.inject({
      method: 'PUT', url: '/contas/c1', headers: auth,
      payload: { descricao: 'X' },
    })
    expect(res.statusCode).toBe(404)
  })

  it('PUT trata 409 (marcar admiteMovimento com filhos)', async () => {
    prisma.conta.findUnique.mockResolvedValue(CONTA)
    prisma.conta.count.mockResolvedValue(2)
    const res = await app.inject({
      method: 'PUT', url: '/contas/c1', headers: auth,
      payload: { admiteMovimento: true },
    })
    expect(res.statusCode).toBe(409)
  })

  it('DELETE 204', async () => {
    prisma.conta.findUnique.mockResolvedValue(CONTA)
    prisma.conta.count.mockResolvedValue(0)
    prisma.lancamentoItem.count.mockResolvedValue(0)
    prisma.resumoMensalConta.count.mockResolvedValue(0)
    prisma.saldoInicialAno.count.mockResolvedValue(0)
    const res = await app.inject({ method: 'DELETE', url: '/contas/c1', headers: auth })
    expect(res.statusCode).toBe(204)
  })

  it('DELETE 409 quando há filhos', async () => {
    prisma.conta.findUnique.mockResolvedValue(CONTA)
    prisma.conta.count.mockResolvedValue(3)
    const res = await app.inject({ method: 'DELETE', url: '/contas/c1', headers: auth })
    expect(res.statusCode).toBe(409)
  })

  it('DELETE 404 quando não existe', async () => {
    prisma.conta.findUnique.mockResolvedValue(null)
    const res = await app.inject({ method: 'DELETE', url: '/contas/c1', headers: auth })
    expect(res.statusCode).toBe(404)
  })
})
