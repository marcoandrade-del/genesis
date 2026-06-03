import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mocka argon2 antes de importar o módulo testado.
vi.mock('argon2', () => ({
  default: {
    verify: vi.fn(),
  },
}))

import argon2 from 'argon2'
import { criarApp, tokenJwt, JWT_SECRET } from '../../routes/__tests__/helpers/criarApp.js'
import { appAuthRoutes } from '../auth.js'
import type { FastifyInstance } from 'fastify'
import type { PrismaMock } from '../../services/__tests__/helpers/prisma-mock.js'

const USUARIO_OK = {
  id: 'u1',
  emailPrincipal: 'fulano@ex.com',
  senhaHash: 'hash',
  emailValidado: true,
  ativo: true,
}

function form(obj: Record<string, string>) {
  return {
    payload: new URLSearchParams(obj).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  }
}

describe('appAuthRoutes', () => {
  let app: FastifyInstance
  let prisma: PrismaMock

  beforeEach(async () => {
    ;(argon2.verify as ReturnType<typeof vi.fn>).mockReset()
    ;({ app, prisma } = await criarApp({
      registrar: appAuthRoutes,
      comView: true,
    }))
  })

  describe('GET /login', () => {
    it('renderiza login sem token', async () => {
      const res = await app.inject({ method: 'GET', url: '/login' })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Acesso ao sistema')
    })

    it('renderiza erro via querystring', async () => {
      const res = await app.inject({ method: 'GET', url: '/login?erro=Acesso+revogado.' })
      expect(res.body).toContain('Acesso revogado.')
    })

    it('redireciona /app quando há token válido', async () => {
      const token = tokenJwt(app, { sub: 'u1', email: 'fulano@ex.com' })
      const res = await app.inject({
        method: 'GET',
        url: '/login',
        cookies: { genesis_user_token: token },
      })
      expect(res.statusCode).toBe(302)
      expect(res.headers.location).toBe('/app')
    })

    it('cai no form quando token é inválido', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/login',
        cookies: { genesis_user_token: 'INVALIDO' },
      })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Acesso ao sistema')
    })
  })

  describe('POST /login', () => {
    it('rejeita credenciais inválidas (usuário não existe)', async () => {
      prisma.usuario.findFirst.mockResolvedValue(null)
      const res = await app.inject({
        method: 'POST',
        url: '/login',
        ...form({ email: 'x@y.com', senha: 'wrong' }),
      })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('inválidos')
    })

    it('rejeita senha errada', async () => {
      prisma.usuario.findFirst.mockResolvedValue(USUARIO_OK)
      ;(argon2.verify as ReturnType<typeof vi.fn>).mockResolvedValue(false)
      const res = await app.inject({
        method: 'POST',
        url: '/login',
        ...form({ email: USUARIO_OK.emailPrincipal, senha: 'wrong' }),
      })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('inválidos')
    })

    it('rejeita usuário sem senhaHash', async () => {
      prisma.usuario.findFirst.mockResolvedValue({ ...USUARIO_OK, senhaHash: null })
      const res = await app.inject({
        method: 'POST',
        url: '/login',
        ...form({ email: USUARIO_OK.emailPrincipal, senha: 'x' }),
      })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('inválidos')
    })

    it('rejeita conta sem email validado', async () => {
      prisma.usuario.findFirst.mockResolvedValue({ ...USUARIO_OK, emailValidado: false })
      ;(argon2.verify as ReturnType<typeof vi.fn>).mockResolvedValue(true)
      const res = await app.inject({
        method: 'POST',
        url: '/login',
        ...form({ email: USUARIO_OK.emailPrincipal, senha: 'x' }),
      })
      expect(res.body).toContain('pendente de ativação')
    })

    it('rejeita conta inativa', async () => {
      prisma.usuario.findFirst.mockResolvedValue({ ...USUARIO_OK, ativo: false })
      ;(argon2.verify as ReturnType<typeof vi.fn>).mockResolvedValue(true)
      const res = await app.inject({
        method: 'POST',
        url: '/login',
        ...form({ email: USUARIO_OK.emailPrincipal, senha: 'x' }),
      })
      expect(res.body).toContain('pendente de ativação')
    })

    it('rejeita usuário sem nenhum AcessoEntidade ativo', async () => {
      prisma.usuario.findFirst.mockResolvedValue(USUARIO_OK)
      ;(argon2.verify as ReturnType<typeof vi.fn>).mockResolvedValue(true)
      prisma.acessoEntidade.findFirst.mockResolvedValue(null)
      const res = await app.inject({
        method: 'POST',
        url: '/login',
        ...form({ email: USUARIO_OK.emailPrincipal, senha: 'x' }),
      })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('não tem acesso a nenhuma entidade')
    })

    it('login feliz: seta cookie e redireciona para /app/contexto', async () => {
      prisma.usuario.findFirst.mockResolvedValue(USUARIO_OK)
      ;(argon2.verify as ReturnType<typeof vi.fn>).mockResolvedValue(true)
      prisma.acessoEntidade.findFirst.mockResolvedValue({ id: 'a1' })
      const res = await app.inject({
        method: 'POST',
        url: '/login',
        ...form({ email: USUARIO_OK.emailPrincipal, senha: 'x' }),
      })
      expect(res.statusCode).toBe(302)
      expect(res.headers.location).toBe('/app/contexto')
      const setCookie = String(res.headers['set-cookie'])
      expect(setCookie).toContain('genesis_user_token=')
    })
  })

  describe('GET /logout', () => {
    it('limpa cookies e redireciona para /app/login', async () => {
      const res = await app.inject({ method: 'GET', url: '/logout' })
      expect(res.statusCode).toBe(302)
      expect(res.headers.location).toBe('/app/login')
      const setCookies = String(res.headers['set-cookie'])
      expect(setCookies).toContain('genesis_user_token=')
      expect(setCookies).toContain('genesis_exercicio=')
    })
  })
})

// Garante que o JWT_SECRET é usado nas asserções acima.
void JWT_SECRET
