import { describe, it, expect, beforeEach } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import cookie from '@fastify/cookie'
import fastifyJwt from '@fastify/jwt'
import { adminAuthMiddleware } from '../index.js'
import { criarPrismaMock, type PrismaMock } from '../../services/__tests__/helpers/prisma-mock.js'

const JWT_SECRET = 'test-secret-only-for-vitest'
const USER_ID = 'u1'
const EMAIL = 'admin@exemplo.com'

async function criarAppProtegido() {
  const app = Fastify({ logger: false })
  const prisma = criarPrismaMock()
  app.decorate('prisma', prisma as never)
  await app.register(cookie)
  await app.register(fastifyJwt, { secret: JWT_SECRET })

  await app.register(async (api) => {
    api.addHook('onRequest', adminAuthMiddleware)
    api.get('/admin-only', async () => ({ ok: true }))
  })

  return { app, prisma }
}

function tokenValido(app: FastifyInstance) {
  return app.jwt.sign({ sub: USER_ID, email: EMAIL })
}

describe('adminAuthMiddleware — gate de e-mail/celular validado', () => {
  let app: FastifyInstance
  let prisma: PrismaMock

  beforeEach(async () => {
    ({ app, prisma } = await criarAppProtegido())
  })

  it('sem cookie de token → redireciona para /admin/login', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin-only' })
    expect(res.statusCode).toBe(302)
    expect(res.headers['location']).toBe('/admin/login')
  })

  it('token inválido → limpa cookie e redireciona para /admin/login', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin-only',
      cookies: { genesis_admin_token: 'token-invalido' },
    })
    expect(res.statusCode).toBe(302)
    expect(res.headers['location']).toBe('/admin/login')
    expect(res.headers['set-cookie']).toMatch(/genesis_admin_token=;/)
  })

  it('sem vínculo AdminSistema ativo → limpa cookie e redireciona para /admin/login', async () => {
    prisma.adminSistema.findFirst.mockResolvedValue(null)
    const res = await app.inject({
      method: 'GET',
      url: '/admin-only',
      cookies: { genesis_admin_token: tokenValido(app) },
    })
    expect(res.statusCode).toBe(302)
    expect(res.headers['location']).toBe('/admin/login')
    expect(res.headers['set-cookie']).toMatch(/genesis_admin_token=;/)
  })

  it('emailValidado=false → limpa cookie e redireciona para /admin/ativar?passo=EMAIL', async () => {
    prisma.adminSistema.findFirst.mockResolvedValue({
      usuario: { emailValidado: false, ativo: false },
    })
    const res = await app.inject({
      method: 'GET',
      url: '/admin-only',
      cookies: { genesis_admin_token: tokenValido(app) },
    })
    expect(res.statusCode).toBe(302)
    expect(res.headers['location']).toBe(`/admin/ativar/${USER_ID}?passo=EMAIL`)
    expect(res.headers['set-cookie']).toMatch(/genesis_admin_token=;/)
  })

  it('emailValidado=true mas ativo=false → redireciona para /admin/ativar?passo=CELULAR', async () => {
    prisma.adminSistema.findFirst.mockResolvedValue({
      usuario: { emailValidado: true, ativo: false },
    })
    const res = await app.inject({
      method: 'GET',
      url: '/admin-only',
      cookies: { genesis_admin_token: tokenValido(app) },
    })
    expect(res.statusCode).toBe(302)
    expect(res.headers['location']).toBe(`/admin/ativar/${USER_ID}?passo=CELULAR`)
    expect(res.headers['set-cookie']).toMatch(/genesis_admin_token=;/)
  })

  it('admin com emailValidado=true e ativo=true → passa para o handler', async () => {
    prisma.adminSistema.findFirst.mockResolvedValue({
      usuario: { emailValidado: true, ativo: true },
    })
    const res = await app.inject({
      method: 'GET',
      url: '/admin-only',
      cookies: { genesis_admin_token: tokenValido(app) },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })
  })

  it('consulta o vínculo admin com select da relação usuario (sem N+1)', async () => {
    prisma.adminSistema.findFirst.mockResolvedValue({
      usuario: { emailValidado: true, ativo: true },
    })
    await app.inject({
      method: 'GET',
      url: '/admin-only',
      cookies: { genesis_admin_token: tokenValido(app) },
    })
    expect(prisma.adminSistema.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { usuarioId: USER_ID, ativo: true },
        select: expect.objectContaining({
          usuario: { select: { emailValidado: true, ativo: true } },
        }),
      }),
    )
    expect(prisma.usuario.findUnique).not.toHaveBeenCalled()
  })
})
