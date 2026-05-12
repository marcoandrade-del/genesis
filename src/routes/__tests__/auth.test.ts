import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Prisma } from '@prisma/client'

vi.mock('argon2', () => ({
  hash: vi.fn().mockResolvedValue('$argon2id$hash'),
  verify: vi.fn().mockResolvedValue(true),
}))
vi.mock('../../services/email.js', () => ({ enviarCodigoEmail: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../../services/sms.js', () => ({ enviarCodigoSms: vi.fn().mockResolvedValue(undefined) }))

import { verify } from 'argon2'
import { criarApp } from './helpers/criarApp.js'
import { authRoutes } from '../auth.js'
import type { FastifyInstance } from 'fastify'
import type { PrismaMock } from '../../services/__tests__/helpers/prisma-mock.js'

const REGISTRO_VALIDO = {
  cpf: '52998224725',
  nomeCompleto: 'João Silva',
  nomeSocial: 'João',
  dataNascimento: '1990-01-15',
  emailPrincipal: 'joao@exemplo.com',
  telefonePrincipal: '44999990000',
  senha: 'senha1234',
}

const USUARIO_DB = {
  id: 'u1',
  cpf: '52998224725',
  idEstrangeiro: null,
  nomeCompleto: 'João Silva',
  nomeSocial: 'João',
  dataNascimento: new Date('1990-01-15'),
  emailPrincipal: 'joao@exemplo.com',
  emailAlternativo: null,
  telefonePrincipal: '44999990000',
  telefoneAlternativo: null,
  emailValidado: false,
  celularValidado: false,
  ativo: false,
  criadoEm: new Date(),
  atualizadoEm: new Date(),
}

const USUARIO_LOGIN_DB = {
  id: 'u1',
  emailPrincipal: 'joao@exemplo.com',
  senhaHash: '$argon2id$hash',
  emailValidado: true,
  ativo: true,
}

describe('POST /auth/registro', () => {
  let app: FastifyInstance
  let prisma: PrismaMock

  beforeEach(async () => {
    ({ app, prisma } = await criarApp({ registrar: authRoutes }))
  })

  it('retorna 201 com dados públicos do usuário', async () => {
    prisma.usuario.create.mockResolvedValue(USUARIO_DB)
    const res = await app.inject({ method: 'POST', url: '/auth/registro', payload: REGISTRO_VALIDO })
    expect(res.statusCode).toBe(201)
    const body = res.json()
    expect(body.data.id).toBe('u1')
    expect(body.data).not.toHaveProperty('senhaHash')
  })

  it('retorna 400 para senha curta (schema)', async () => {
    const res = await app.inject({
      method: 'POST', url: '/auth/registro',
      payload: { ...REGISTRO_VALIDO, senha: '1234567' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('retorna 400 quando CPF inválido (regra de negócio)', async () => {
    const res = await app.inject({
      method: 'POST', url: '/auth/registro',
      payload: { ...REGISTRO_VALIDO, cpf: '00000000000' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('REQUISICAO_INVALIDA')
  })

  it('retorna 409 quando CPF duplicado (P2002)', async () => {
    prisma.usuario.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '7.0', meta: { target: ['cpf'] } })
    )
    const res = await app.inject({ method: 'POST', url: '/auth/registro', payload: REGISTRO_VALIDO })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe('CONFLITO')
  })
})

describe('POST /auth/login', () => {
  let app: FastifyInstance
  let prisma: PrismaMock

  beforeEach(async () => {
    ({ app, prisma } = await criarApp({ registrar: authRoutes }))
    vi.mocked(verify).mockResolvedValue(true as never)
  })

  it('retorna 200 com token JWT válido', async () => {
    prisma.usuario.findUnique.mockResolvedValue(USUARIO_LOGIN_DB)
    const res = await app.inject({
      method: 'POST', url: '/auth/login',
      payload: { email: 'joao@exemplo.com', senha: 'senha1234' },
    })
    expect(res.statusCode).toBe(200)
    const { data } = res.json()
    expect(typeof data.token).toBe('string')
    const decoded = app.jwt.verify<{ sub: string; email: string }>(data.token)
    expect(decoded.sub).toBe('u1')
    expect(decoded.email).toBe('joao@exemplo.com')
  })

  it('retorna 400 quando credenciais incorretas (sem revelar qual campo)', async () => {
    prisma.usuario.findUnique.mockResolvedValue(null)
    const res = await app.inject({
      method: 'POST', url: '/auth/login',
      payload: { email: 'nao@existe.com', senha: 'qq' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('REQUISICAO_INVALIDA')
  })

  it('retorna 409 quando e-mail não validado', async () => {
    prisma.usuario.findUnique.mockResolvedValue({ ...USUARIO_LOGIN_DB, emailValidado: false })
    const res = await app.inject({
      method: 'POST', url: '/auth/login',
      payload: { email: 'joao@exemplo.com', senha: 'senha1234' },
    })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe('CONFLITO')
  })
})

describe('POST /auth/solicitar-validacao/:usuarioId', () => {
  let app: FastifyInstance
  let prisma: PrismaMock

  beforeEach(async () => {
    ({ app, prisma } = await criarApp({ registrar: authRoutes }))
  })

  it('retorna 201 quando código é solicitado', async () => {
    prisma.usuario.findUnique.mockResolvedValue({ ...USUARIO_DB, emailValidado: false })
    prisma.codigoValidacao.deleteMany.mockResolvedValue({ count: 0 })
    prisma.codigoValidacao.create.mockResolvedValue({ id: 'c1', expiradoEm: new Date(Date.now() + 900000) })

    const res = await app.inject({
      method: 'POST', url: '/auth/solicitar-validacao/u1',
      payload: { tipo: 'EMAIL' },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().data.id).toBe('c1')
  })

  it('retorna 404 quando usuário não existe', async () => {
    prisma.usuario.findUnique.mockResolvedValue(null)
    const res = await app.inject({
      method: 'POST', url: '/auth/solicitar-validacao/u1',
      payload: { tipo: 'EMAIL' },
    })
    expect(res.statusCode).toBe(404)
  })

  it('retorna 409 quando tipo já validado', async () => {
    prisma.usuario.findUnique.mockResolvedValue({ ...USUARIO_DB, emailValidado: true })
    const res = await app.inject({
      method: 'POST', url: '/auth/solicitar-validacao/u1',
      payload: { tipo: 'EMAIL' },
    })
    expect(res.statusCode).toBe(409)
  })

  it('retorna 400 quando body falha no schema (tipo inválido)', async () => {
    const res = await app.inject({
      method: 'POST', url: '/auth/solicitar-validacao/u1',
      payload: { tipo: 'OUTRO' },
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('POST /auth/validar/:usuarioId', () => {
  let app: FastifyInstance
  let prisma: PrismaMock

  beforeEach(async () => {
    ({ app, prisma } = await criarApp({ registrar: authRoutes }))
  })

  it('retorna 200 e marca emailValidado quando código é correto', async () => {
    prisma.usuario.findUnique.mockResolvedValue({ ...USUARIO_DB, emailValidado: false, celularValidado: false })
    prisma.codigoValidacao.findFirst.mockResolvedValue({
      id: 'c1', usuarioId: 'u1', tipo: 'EMAIL', codigo: '123456',
      usadoEm: null, expiradoEm: new Date(Date.now() + 60000),
    })
    const res = await app.inject({
      method: 'POST', url: '/auth/validar/u1',
      payload: { tipo: 'EMAIL', codigo: '123456' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toEqual({ emailValidado: true, celularValidado: false, ativo: false })
  })

  it('retorna 400 quando código está incorreto/expirado', async () => {
    prisma.usuario.findUnique.mockResolvedValue({ ...USUARIO_DB, emailValidado: false })
    prisma.codigoValidacao.findFirst.mockResolvedValue(null)
    const res = await app.inject({
      method: 'POST', url: '/auth/validar/u1',
      payload: { tipo: 'EMAIL', codigo: '999999' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('REQUISICAO_INVALIDA')
  })

  it('retorna 400 quando código não tem 6 dígitos (schema)', async () => {
    const res = await app.inject({
      method: 'POST', url: '/auth/validar/u1',
      payload: { tipo: 'EMAIL', codigo: '123' },
    })
    expect(res.statusCode).toBe(400)
  })
})
