import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('argon2', () => ({
  default: {
    hash: vi.fn(async (s: string) => `hashed:${s}`),
    verify: vi.fn(async (hash: string, senha: string) => hash === `hashed:${senha}`),
  },
  hash: vi.fn(async (s: string) => `hashed:${s}`),
  verify: vi.fn(async (hash: string, senha: string) => hash === `hashed:${senha}`),
}))
vi.mock('../../services/email.js', () => ({ enviarCodigoEmail: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../../services/sms.js', () => ({ enviarCodigoSms: vi.fn().mockResolvedValue(undefined) }))

import rateLimit from '@fastify/rate-limit'
import { criarApp, JWT_SECRET } from '../../routes/__tests__/helpers/criarApp.js'
import { adminAuthRoutes } from '../auth.js'
import type { FastifyInstance } from 'fastify'
import type { PrismaMock } from '../../services/__tests__/helpers/prisma-mock.js'

const USUARIO = {
  id: 'u1',
  emailPrincipal: 'joao@exemplo.com',
  telefonePrincipal: '44999990000',
  senhaHash: 'hashed:senha1234',
  emailValidado: false,
  celularValidado: false,
  ativo: false,
}

function form(obj: Record<string, string>) {
  return {
    payload: new URLSearchParams(obj).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  }
}

describe('adminAuthRoutes — branches restantes', () => {
  let app: FastifyInstance
  let prisma: PrismaMock

  beforeEach(async () => {
    ({ app, prisma } = await criarApp({ registrar: adminAuthRoutes, comView: true }))
  })

  it('POST /reenviar com erro Error do service re-renderiza com mensagem', async () => {
    prisma.usuario.findUnique.mockResolvedValue(USUARIO)
    prisma.codigoValidacao.deleteMany.mockRejectedValue(new Error('Limite atingido.'))

    const res = await app.inject({
      method: 'POST', url: '/reenviar/u1',
      ...form({ passo: 'EMAIL' }),
    })

    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('Limite atingido.')
  })

  it('POST /reenviar com erro não-Error usa mensagem fallback', async () => {
    prisma.usuario.findUnique.mockResolvedValue(USUARIO)
    prisma.codigoValidacao.deleteMany.mockRejectedValue('string crua')

    const res = await app.inject({
      method: 'POST', url: '/reenviar/u1',
      ...form({ passo: 'CELULAR' }),
    })

    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('Erro ao reenviar.')
  })

  it('GET /login com token válido redireciona para /admin', async () => {
    const token = app.jwt.sign({ sub: 'u1', email: 'joao@exemplo.com' })

    const res = await app.inject({
      method: 'GET', url: '/login',
      headers: { cookie: `genesis_admin_token=${token}` },
    })

    expect(res.statusCode).toBe(302)
    expect(res.headers['location']).toBe('/admin')
  })

  it('GET /login com token inválido renderiza tela de login', async () => {
    const res = await app.inject({
      method: 'GET', url: '/login',
      headers: { cookie: 'genesis_admin_token=token.invalido.aqui' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.body).toMatch(/login|email/i)
  })

  it('POST /registro sem nomeSocial usa nomeCompleto como fallback', async () => {
    prisma.usuario.findUnique.mockResolvedValue({ ...USUARIO, nomeSocial: 'Maria' })
    prisma.usuario.create.mockResolvedValue({ ...USUARIO, nomeSocial: 'Maria' })
    prisma.codigoValidacao.deleteMany.mockResolvedValue({ count: 0 })
    prisma.codigoValidacao.create.mockResolvedValue({ id: 'c1', expiradoEm: new Date(Date.now() + 900000) })

    const res = await app.inject({
      method: 'POST', url: '/registro',
      ...form({
        nomeCompleto: 'Maria',
        cpf: '52998224725',
        dataNascimento: '1990-01-15',
        emailPrincipal: 'm@x.com',
        telefonePrincipal: '44999990000',
        senha: 'senha1234',
        confirmarSenha: 'senha1234',
      }),
    })

    expect(res.statusCode).toBe(302)
    expect(prisma.usuario.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ nomeSocial: 'Maria' }),
    }))
  })

  it('POST /registro com erro não-Error usa mensagem fallback', async () => {
    prisma.usuario.create.mockRejectedValue('falha crua')
    const res = await app.inject({
      method: 'POST', url: '/registro',
      ...form({
        nomeCompleto: 'X', nomeSocial: 'X',
        cpf: '52998224725', dataNascimento: '1990-01-15',
        emailPrincipal: 'x@y.com', telefonePrincipal: '44999990000',
        senha: 'senha1234', confirmarSenha: 'senha1234',
      }),
    })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('Erro ao criar conta.')
  })

  it('GET /ativar com ?passo=CELULAR renderiza CELULAR', async () => {
    prisma.usuario.findUnique.mockResolvedValue(USUARIO)
    const res = await app.inject({ method: 'GET', url: '/ativar/u1?passo=CELULAR' })
    expect(res.statusCode).toBe(200)
  })

  it('POST /ativar redireciona para login quando usuário não existe', async () => {
    prisma.usuario.findUnique.mockResolvedValue(null)
    const res = await app.inject({
      method: 'POST', url: '/ativar/u1',
      ...form({ passo: 'EMAIL', codigo: '123456' }),
    })
    expect(res.statusCode).toBe(302)
    expect(res.headers['location']).toBe('/admin/login')
  })

  it('POST /ativar com erro não-Error usa mensagem fallback', async () => {
    prisma.usuario.findUnique.mockResolvedValue(USUARIO)
    prisma.codigoValidacao.findFirst.mockRejectedValue('falha crua')
    const res = await app.inject({
      method: 'POST', url: '/ativar/u1',
      ...form({ passo: 'EMAIL', codigo: '000000' }),
    })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('Código inválido.')
  })

  it('POST /reenviar com rate-limit registrado chama keyGenerator com usuarioId', async () => {
    // App separado com @fastify/rate-limit ativo para exercitar o keyGenerator.
    const Fastify = (await import('fastify')).default
    const cookie = (await import('@fastify/cookie')).default
    const formbody = (await import('@fastify/formbody')).default
    const fastifyJwt = (await import('@fastify/jwt')).default
    const view = (await import('@fastify/view')).default
    const ejs = (await import('ejs')).default
    const path = await import('node:path')
    const { fileURLToPath } = await import('node:url')
    const { criarPrismaMock } = await import('../../services/__tests__/helpers/prisma-mock.js')
    const here = path.dirname(fileURLToPath(import.meta.url))

    const a = Fastify({ logger: false })
    const p = criarPrismaMock()
    a.decorate('prisma', p as never)
    await a.register(cookie)
    await a.register(formbody)
    await a.register(fastifyJwt, { secret: JWT_SECRET })
    await a.register(view, {
      engine: { ejs },
      root: path.join(here, '..', '..', 'views'),
      viewExt: 'ejs',
    })
    await a.register(rateLimit, { global: false })
    await a.register(adminAuthRoutes)

    p.usuario.findUnique.mockResolvedValue(USUARIO)
    p.codigoValidacao.deleteMany.mockResolvedValue({ count: 0 })
    p.codigoValidacao.create.mockResolvedValue({ id: 'c1', expiradoEm: new Date(Date.now() + 900000) })

    const res = await a.inject({
      method: 'POST', url: '/reenviar/u1',
      ...form({ passo: 'EMAIL' }),
    })

    expect(res.statusCode).toBe(200)
    // x-ratelimit-* headers só aparecem quando o keyGenerator rodou
    expect(res.headers['x-ratelimit-limit']).toBeDefined()
    await a.close()
  })
})
