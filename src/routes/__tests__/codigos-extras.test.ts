import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../../services/email.js', () => ({ enviarCodigoEmail: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../../services/sms.js', () => ({ enviarCodigoSms: vi.fn().mockResolvedValue(undefined) }))

import { criarApp, tokenJwt } from './helpers/criarApp.js'
import { codigosRoutes } from '../codigos.js'
import type { FastifyInstance } from 'fastify'
import type { PrismaMock } from '../../services/__tests__/helpers/prisma-mock.js'

describe('codigosRoutes — caminhos restantes', () => {
  let app: FastifyInstance
  let prisma: PrismaMock
  let auth: { authorization: string }

  beforeEach(async () => {
    ({ app, prisma } = await criarApp({ registrar: codigosRoutes, proteger: true }))
    auth = { authorization: `Bearer ${tokenJwt(app, { sub: 'u1', email: 'a@b.com' })}` }
  })

  // Line 31 — catch de POST /usuarios/:usuarioId/validar
  it('POST /usuarios/:usuarioId/validar retorna 404 quando usuário não existe', async () => {
    prisma.usuario.findUnique.mockResolvedValue(null)
    const res = await app.inject({
      method: 'POST', url: '/usuarios/u1/validar', headers: auth,
      payload: { tipo: 'EMAIL', codigo: '123456' },
    })
    expect(res.statusCode).toBe(404)
  })
})
