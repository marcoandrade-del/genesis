import { describe, it, expect, beforeEach, vi } from 'vitest'
import Fastify, { type FastifyInstance, type FastifyPluginAsync } from 'fastify'
import cookie from '@fastify/cookie'
import fastifyJwt from '@fastify/jwt'
import { criarPrismaMock, type PrismaMock } from '../../services/__tests__/helpers/prisma-mock.js'

const { rotaVazia, rotaRaiz, rotaSistemas, rotaFuncionando } = vi.hoisted(() => ({
  rotaVazia: vi.fn<FastifyPluginAsync>(async () => {}),
  rotaRaiz: vi.fn<FastifyPluginAsync>(async (app) => {
    app.get('/login', async () => ({ login: true }))
  }),
  rotaSistemas: vi.fn<FastifyPluginAsync>(async (app) => {
    app.get('/', async () => ({ raiz: true }))
    app.get('/sub', async () => ({ sub: true }))
  }),
  rotaFuncionando: vi.fn<FastifyPluginAsync>(async (app) => {
    app.get('/sub', async () => ({ sub: true }))
  }),
}))

vi.mock('../auth.js', () => ({ adminAuthRoutes: rotaRaiz }))
vi.mock('../dashboard.js', () => ({ adminDashboardRoutes: rotaVazia }))
vi.mock('../sistemas.js', () => ({ adminSistemasRoutes: rotaSistemas }))
vi.mock('../modulos.js', () => ({ adminModulosRoutes: rotaVazia }))
vi.mock('../menus.js', () => ({ adminMenusRoutes: rotaVazia }))
vi.mock('../usuarios.js', () => ({ adminUsuariosRoutes: rotaVazia }))
vi.mock('../lookup.js', () => ({ adminLookupRoutes: rotaVazia }))
vi.mock('../lixeira.js', () => ({ adminLixeiraRoutes: rotaVazia }))
vi.mock('../permissoes.js', () => ({ adminPermissoesRoutes: rotaVazia }))
vi.mock('../relatorios.js', () => ({ adminRelatoriosRoutes: rotaVazia }))
vi.mock('../relatorios-personalizados.js', () => ({ adminRelatoriosPersonalizadosRoutes: rotaVazia }))
vi.mock('../favoritos.js', () => ({ adminFavoritosRoutes: rotaVazia }))
vi.mock('../funcionando.js', () => ({ adminFuncionandoRoutes: rotaFuncionando }))

const { adminRoutes } = await import('../index.js')

const JWT_SECRET = 'test-secret'
const USER_ID = 'u1'

async function criarApp() {
  const app = Fastify({ logger: false })
  const prisma = criarPrismaMock()
  app.decorate('prisma', prisma as never)
  await app.register(cookie)
  await app.register(fastifyJwt, { secret: JWT_SECRET })
  await app.register(adminRoutes, { prefix: '/admin' })
  return { app, prisma }
}

function tokenValido(app: FastifyInstance) {
  return app.jwt.sign({ sub: USER_ID, email: 'a@b.com' })
}

describe('adminRoutes — registro e hook de redirecionamento de fragmentos', () => {
  let app: FastifyInstance
  let prisma: PrismaMock
  let cookies: Record<string, string>

  beforeEach(async () => {
    ({ app, prisma } = await criarApp())
    cookies = { genesis_admin_token: tokenValido(app) }
    prisma.adminSistema.findFirst.mockResolvedValue({
      usuario: { emailValidado: true, ativo: true },
    })
  })

  it('rotas públicas mountadas em /admin (sem auth)', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/login' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ login: true })
  })

  it('rotas protegidas mountadas com prefix correto', async () => {
    const res = await app.inject({
      method: 'GET', url: '/admin/sistemas/', headers: { 'hx-request': 'true' }, cookies,
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ raiz: true })
  })

  it('GET de fragmento (2+ segmentos) sem HX-Request → redireciona para /admin', async () => {
    const res = await app.inject({
      method: 'GET', url: '/admin/sistemas/sub', cookies,
    })
    expect(res.statusCode).toBe(302)
    expect(res.headers['location']).toBe('/admin')
  })

  it('GET de fragmento com HX-Request → passa para o handler', async () => {
    const res = await app.inject({
      method: 'GET', url: '/admin/sistemas/sub',
      headers: { 'hx-request': 'true' }, cookies,
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ sub: true })
  })

  it('GET de rota com 1 segmento sem HX-Request → passa (não é fragmento)', async () => {
    const res = await app.inject({
      method: 'GET', url: '/admin/sistemas/', cookies,
    })
    expect(res.statusCode).toBe(200)
  })

  it('GET em /admin/funcionando/sub sem HX-Request → passa (exceção)', async () => {
    const res = await app.inject({
      method: 'GET', url: '/admin/funcionando/sub', cookies,
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ sub: true })
  })

  it('método não-GET nunca redireciona', async () => {
    const res = await app.inject({
      method: 'POST', url: '/admin/sistemas/sub', cookies,
    })
    expect(res.statusCode).toBe(404)
  })
})
