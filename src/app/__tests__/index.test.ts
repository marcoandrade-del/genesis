import { describe, it, expect, beforeEach, vi } from 'vitest'
import { criarApp, tokenJwt } from '../../routes/__tests__/helpers/criarApp.js'
import { appAuthMiddleware, appContextoMiddleware } from '../index.js'
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import type { PrismaMock } from '../../services/__tests__/helpers/prisma-mock.js'

// Cria uma rota dummy protegida pelo appAuthMiddleware para testar redirects.
async function montarAuthApp() {
  const { app, prisma } = await criarApp({
    registrar: async (api) => {
      api.addHook('onRequest', appAuthMiddleware)
      api.get('/protegido', async (req) => ({ ok: true, sub: req.user.sub }))
    },
    comView: true,
  })
  return { app, prisma }
}

async function montarContextoApp() {
  const { app, prisma } = await criarApp({
    prefix: '/app',
    registrar: async (api) => {
      api.addHook('onRequest', async (req) => {
        req.user = { sub: 'u1', email: 'u@x.com' }
      })
      api.addHook('onRequest', appContextoMiddleware)
      api.get('/qualquer', async (req) => ({ contexto: req.contexto }))
      api.get('/contexto', async () => ({ rota: 'contexto' }))
    },
    comView: true,
  })
  return { app, prisma }
}

describe('appAuthMiddleware', () => {
  let app: FastifyInstance
  let prisma: PrismaMock

  beforeEach(async () => {
    ;({ app, prisma } = await montarAuthApp())
  })

  it('redireciona /app/login sem cookie', async () => {
    const res = await app.inject({ method: 'GET', url: '/protegido' })
    expect(res.statusCode).toBe(302)
    expect(res.headers.location).toBe('/app/login')
  })

  it('redireciona e limpa cookie quando token é inválido', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/protegido',
      cookies: { genesis_user_token: 'INVALIDO' },
    })
    expect(res.headers.location).toBe('/app/login')
    expect(String(res.headers['set-cookie'])).toContain('genesis_user_token=')
  })

  it('redireciona quando usuário não existe mais', async () => {
    prisma.usuario.findUnique.mockResolvedValue(null)
    const token = tokenJwt(app, { sub: 'u1', email: 'u@x.com' })
    const res = await app.inject({
      method: 'GET',
      url: '/protegido',
      cookies: { genesis_user_token: token },
    })
    expect(res.headers.location).toBe('/app/login')
  })

  it('redireciona quando email não está validado', async () => {
    prisma.usuario.findUnique.mockResolvedValue({ ativo: true, emailValidado: false })
    const token = tokenJwt(app, { sub: 'u1', email: 'u@x.com' })
    const res = await app.inject({
      method: 'GET',
      url: '/protegido',
      cookies: { genesis_user_token: token },
    })
    expect(res.headers.location).toBe('/app/login')
  })

  it('redireciona quando conta está inativa', async () => {
    prisma.usuario.findUnique.mockResolvedValue({ ativo: false, emailValidado: true })
    const token = tokenJwt(app, { sub: 'u1', email: 'u@x.com' })
    const res = await app.inject({
      method: 'GET',
      url: '/protegido',
      cookies: { genesis_user_token: token },
    })
    expect(res.headers.location).toBe('/app/login')
  })

  it('redireciona com "Acesso+revogado" quando perdeu acesso', async () => {
    prisma.usuario.findUnique.mockResolvedValue({ ativo: true, emailValidado: true })
    prisma.acessoEntidade.findFirst.mockResolvedValue(null)
    const token = tokenJwt(app, { sub: 'u1', email: 'u@x.com' })
    const res = await app.inject({
      method: 'GET',
      url: '/protegido',
      cookies: { genesis_user_token: token },
    })
    expect(res.headers.location).toContain('/app/login')
    expect(res.headers.location).toContain('Acesso+revogado')
  })

  it('passa quando tudo OK', async () => {
    prisma.usuario.findUnique.mockResolvedValue({ ativo: true, emailValidado: true })
    prisma.acessoEntidade.findFirst.mockResolvedValue({ id: 'a1' })
    const token = tokenJwt(app, { sub: 'u1', email: 'u@x.com' })
    const res = await app.inject({
      method: 'GET',
      url: '/protegido',
      cookies: { genesis_user_token: token },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true, sub: 'u1' })
  })
})

describe('appContextoMiddleware', () => {
  let app: FastifyInstance
  let prisma: PrismaMock

  beforeEach(async () => {
    ;({ app, prisma } = await montarContextoApp())
  })

  it('libera /contexto sem exigir cookie', async () => {
    const res = await app.inject({ method: 'GET', url: '/app/contexto' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ rota: 'contexto' })
  })

  it('redireciona /app/contexto quando não há cookie', async () => {
    const res = await app.inject({ method: 'GET', url: '/app/qualquer' })
    expect(res.statusCode).toBe(302)
    expect(res.headers.location).toBe('/app/contexto')
  })

  it('redireciona quando cookie inválido', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/app/qualquer',
      cookies: { genesis_exercicio: 'lixo' },
    })
    expect(res.headers.location).toBe('/app/contexto')
  })

  it('redireciona e limpa cookie quando acesso foi revogado', async () => {
    prisma.acessoEntidade.findUnique.mockResolvedValue(null)
    const res = await app.inject({
      method: 'GET',
      url: '/app/qualquer',
      cookies: { genesis_exercicio: 'ent1:2026' },
    })
    expect(res.headers.location).toBe('/app/contexto')
    expect(String(res.headers['set-cookie'])).toContain('genesis_exercicio=')
  })

  it('redireciona quando acesso está suspenso (ativo=false)', async () => {
    prisma.acessoEntidade.findUnique.mockResolvedValue({ ativo: false, nivel: 'LEITURA' })
    const res = await app.inject({
      method: 'GET',
      url: '/app/qualquer',
      cookies: { genesis_exercicio: 'ent1:2026' },
    })
    expect(res.headers.location).toBe('/app/contexto')
  })

  it('injeta req.contexto quando tudo válido', async () => {
    prisma.acessoEntidade.findUnique.mockResolvedValue({ ativo: true, nivel: 'ESCRITA' })
    const res = await app.inject({
      method: 'GET',
      url: '/app/qualquer',
      cookies: { genesis_exercicio: 'ent1:2026' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      contexto: { entidadeId: 'ent1', ano: 2026, nivel: 'ESCRITA' },
    })
  })
})

// Smoke do não-encontrado handler — importado ali junto.
describe('appNotFoundHandler', () => {
  it('responde 404 com view 404', async () => {
    const { appNotFoundHandler } = await import('../index.js')
    const reply = {
      status: vi.fn().mockReturnThis(),
      view: vi.fn().mockReturnThis(),
    } as unknown as FastifyReply
    const req = { url: '/app/inexistente' } as FastifyRequest
    appNotFoundHandler(req, reply)
    expect(reply.status).toHaveBeenCalledWith(404)
    expect(reply.view).toHaveBeenCalledWith('404', { caminho: '/app/inexistente' })
  })
})

// Smoke do appRoutes registrado em /app.
describe('appRoutes (montagem completa)', () => {
  it('rota raiz protegida redireciona para /app/login sem cookie', async () => {
    const { appRoutes } = await import('../index.js')
    const { app } = await criarApp({ registrar: appRoutes, prefix: '/app', comView: true })
    const res = await app.inject({ method: 'GET', url: '/app' })
    expect(res.statusCode).toBe(302)
    expect(res.headers.location).toBe('/app/login')
  })

  it('GET /app/login renderiza form sem auth', async () => {
    const { appRoutes } = await import('../index.js')
    const { app } = await criarApp({ registrar: appRoutes, prefix: '/app', comView: true })
    const res = await app.inject({ method: 'GET', url: '/app/login' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('Acesso ao sistema')
  })

  it('rota desconhecida retorna 404 com view', async () => {
    const { appRoutes } = await import('../index.js')
    const { app } = await criarApp({ registrar: appRoutes, prefix: '/app', comView: true })
    const res = await app.inject({ method: 'GET', url: '/app/inexistente' })
    expect(res.statusCode).toBe(404)
  })
})
