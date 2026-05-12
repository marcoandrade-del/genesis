import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../../services/email.js', () => ({ enviarCodigoEmail: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../../services/sms.js', () => ({ enviarCodigoSms: vi.fn().mockResolvedValue(undefined) }))

import { criarApp, tokenJwt } from './helpers/criarApp.js'
import { codigosRoutes } from '../codigos.js'
import type { FastifyInstance } from 'fastify'
import type { PrismaMock } from '../../services/__tests__/helpers/prisma-mock.js'

const USUARIO = {
  id: 'u1', emailPrincipal: 'a@b.com', telefonePrincipal: '44999990000',
  emailValidado: false, celularValidado: false, ativo: false,
}

describe('codigosRoutes (protegida)', () => {
  let app: FastifyInstance
  let prisma: PrismaMock
  let auth: { authorization: string }

  beforeEach(async () => {
    ({ app, prisma } = await criarApp({ registrar: codigosRoutes, proteger: true }))
    auth = { authorization: `Bearer ${tokenJwt(app, { sub: 'u1', email: 'a@b.com' })}` }
  })

  it('POST /usuarios/:usuarioId/solicitar-validacao exige auth', async () => {
    const res = await app.inject({
      method: 'POST', url: '/usuarios/u1/solicitar-validacao',
      payload: { tipo: 'EMAIL' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('POST /usuarios/:usuarioId/solicitar-validacao retorna 201', async () => {
    prisma.usuario.findUnique.mockResolvedValue(USUARIO)
    prisma.codigoValidacao.deleteMany.mockResolvedValue({ count: 0 })
    prisma.codigoValidacao.create.mockResolvedValue({ id: 'c1', expiradoEm: new Date(Date.now() + 900000) })

    const res = await app.inject({
      method: 'POST', url: '/usuarios/u1/solicitar-validacao', headers: auth,
      payload: { tipo: 'EMAIL' },
    })
    expect(res.statusCode).toBe(201)
  })

  it('POST /usuarios/:usuarioId/solicitar-validacao retorna 404 quando usuário não existe', async () => {
    prisma.usuario.findUnique.mockResolvedValue(null)
    const res = await app.inject({
      method: 'POST', url: '/usuarios/u1/solicitar-validacao', headers: auth,
      payload: { tipo: 'EMAIL' },
    })
    expect(res.statusCode).toBe(404)
  })

  it('POST /usuarios/:usuarioId/validar retorna 200 quando código é correto', async () => {
    prisma.usuario.findUnique.mockResolvedValue({ ...USUARIO, emailValidado: false })
    prisma.codigoValidacao.findFirst.mockResolvedValue({
      id: 'c1', usuarioId: 'u1', tipo: 'EMAIL', codigo: '123456',
      usadoEm: null, expiradoEm: new Date(Date.now() + 60000),
    })
    const res = await app.inject({
      method: 'POST', url: '/usuarios/u1/validar', headers: auth,
      payload: { tipo: 'EMAIL', codigo: '123456' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.emailValidado).toBe(true)
  })

  it('POST /usuarios/:usuarioId/validar retorna 400 quando código não tem 6 dígitos (schema)', async () => {
    const res = await app.inject({
      method: 'POST', url: '/usuarios/u1/validar', headers: auth,
      payload: { tipo: 'EMAIL', codigo: 'abc' },
    })
    expect(res.statusCode).toBe(400)
  })
})
