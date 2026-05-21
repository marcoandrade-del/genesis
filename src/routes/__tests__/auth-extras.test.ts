import { describe, it, expect, vi } from 'vitest'

vi.mock('../../services/email.js', () => ({ enviarCodigoEmail: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../../services/sms.js', () => ({ enviarCodigoSms: vi.fn().mockResolvedValue(undefined) }))

import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import formbody from '@fastify/formbody'
import fastifyJwt from '@fastify/jwt'
import rateLimit from '@fastify/rate-limit'
import { authRoutes } from '../auth.js'
import { criarPrismaMock } from '../../services/__tests__/helpers/prisma-mock.js'

const USUARIO = {
  id: 'u1', emailPrincipal: 'a@b.com', telefonePrincipal: '44999990000',
  emailValidado: false, celularValidado: false, ativo: false,
}

describe('authRoutes — keyGenerator do rate-limit', () => {
  // Line 65 — keyGenerator só é chamado quando @fastify/rate-limit está registrado
  it('POST /auth/solicitar-validacao/:usuarioId aciona o keyGenerator com usuarioId', async () => {
    const app = Fastify({ logger: false })
    const prisma = criarPrismaMock()
    app.decorate('prisma', prisma as never)
    await app.register(cookie)
    await app.register(formbody)
    await app.register(fastifyJwt, { secret: 'test-secret' })
    await app.register(rateLimit, { global: false })
    await app.register(authRoutes)

    prisma.usuario.findUnique.mockResolvedValue(USUARIO)
    prisma.codigoValidacao.deleteMany.mockResolvedValue({ count: 0 })
    prisma.codigoValidacao.create.mockResolvedValue({ id: 'c1', expiradoEm: new Date(Date.now() + 900000) })

    const res = await app.inject({
      method: 'POST', url: '/auth/solicitar-validacao/u1',
      payload: { tipo: 'EMAIL' },
    })

    expect(res.statusCode).toBe(201)
    expect(res.headers['x-ratelimit-limit']).toBeDefined()
    await app.close()
  })
})
