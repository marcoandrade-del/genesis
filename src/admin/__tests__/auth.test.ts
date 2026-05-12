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

import { criarApp } from '../../routes/__tests__/helpers/criarApp.js'
import { adminAuthRoutes } from '../auth.js'
import type { FastifyInstance } from 'fastify'
import type { PrismaMock } from '../../services/__tests__/helpers/prisma-mock.js'

const USUARIO = {
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
  senhaHash: 'hashed:senha1234',
  emailValidado: false,
  celularValidado: false,
  ativo: false,
  criadoEm: new Date(),
  atualizadoEm: new Date(),
}

const REGISTRO_PAYLOAD = {
  nomeCompleto: 'João Silva',
  nomeSocial: 'João',
  cpf: '52998224725',
  dataNascimento: '1990-01-15',
  emailPrincipal: 'joao@exemplo.com',
  telefonePrincipal: '44999990000',
  senha: 'senha1234',
  confirmarSenha: 'senha1234',
}

function form(obj: Record<string, string>) {
  return {
    payload: new URLSearchParams(obj).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  }
}

describe('adminAuthRoutes — registro', () => {
  let app: FastifyInstance
  let prisma: PrismaMock

  beforeEach(async () => {
    ({ app, prisma } = await criarApp({ registrar: adminAuthRoutes, comView: true }))
  })

  it('GET /registro renderiza formulário', async () => {
    const res = await app.inject({ method: 'GET', url: '/registro' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('Criar Conta')
  })

  it('POST /registro com senhas diferentes re-renderiza com erro', async () => {
    const res = await app.inject({
      method: 'POST', url: '/registro',
      ...form({ ...REGISTRO_PAYLOAD, confirmarSenha: 'outraSenha' }),
    })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('As senhas não conferem')
    expect(prisma.usuario.create).not.toHaveBeenCalled()
  })

  it('POST /registro com sucesso redireciona para /admin/ativar/:id?passo=EMAIL', async () => {
    prisma.usuario.create.mockResolvedValue(USUARIO)
    prisma.usuario.findUnique.mockResolvedValue(USUARIO)
    prisma.codigoValidacao.deleteMany.mockResolvedValue({ count: 0 })
    prisma.codigoValidacao.create.mockResolvedValue({ id: 'c1', expiradoEm: new Date(Date.now() + 900000) })

    const res = await app.inject({ method: 'POST', url: '/registro', ...form(REGISTRO_PAYLOAD) })
    expect(res.statusCode).toBe(302)
    expect(res.headers['location']).toBe('/admin/ativar/u1?passo=EMAIL')
    expect(prisma.codigoValidacao.create).toHaveBeenCalledTimes(2)
  })

  it('POST /registro com erro do service re-renderiza com mensagem', async () => {
    const res = await app.inject({
      method: 'POST', url: '/registro',
      ...form({ ...REGISTRO_PAYLOAD, cpf: '12345678900' }),
    })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('CPF inválido')
  })
})

describe('adminAuthRoutes — ativação', () => {
  let app: FastifyInstance
  let prisma: PrismaMock

  beforeEach(async () => {
    ({ app, prisma } = await criarApp({ registrar: adminAuthRoutes, comView: true }))
  })

  it('GET /ativar/:usuarioId redireciona para /admin/login quando usuário não existe', async () => {
    prisma.usuario.findUnique.mockResolvedValue(null)
    const res = await app.inject({ method: 'GET', url: '/ativar/u1' })
    expect(res.statusCode).toBe(302)
    expect(res.headers['location']).toBe('/admin/login')
  })

  it('GET /ativar/:usuarioId renderiza view com passo=EMAIL por padrão', async () => {
    prisma.usuario.findUnique.mockResolvedValue(USUARIO)
    const res = await app.inject({ method: 'GET', url: '/ativar/u1' })
    expect(res.statusCode).toBe(200)
  })

  it('POST /ativar/:usuarioId com código EMAIL válido redireciona para passo=CELULAR', async () => {
    prisma.usuario.findUnique.mockResolvedValue(USUARIO)
    prisma.codigoValidacao.findFirst.mockResolvedValue({
      id: 'c1', usuarioId: 'u1', tipo: 'EMAIL', codigo: '123456',
      usadoEm: null, expiradoEm: new Date(Date.now() + 60000),
    })
    const res = await app.inject({
      method: 'POST', url: '/ativar/u1',
      ...form({ passo: 'EMAIL', codigo: '123456' }),
    })
    expect(res.statusCode).toBe(302)
    expect(res.headers['location']).toBe('/admin/ativar/u1?passo=CELULAR')
  })

  it('POST /ativar/:usuarioId com código CELULAR válido (email já validado) redireciona para /admin/login?ativado=1', async () => {
    prisma.usuario.findUnique.mockResolvedValue({ ...USUARIO, emailValidado: true })
    prisma.codigoValidacao.findFirst.mockResolvedValue({
      id: 'c2', usuarioId: 'u1', tipo: 'CELULAR', codigo: '654321',
      usadoEm: null, expiradoEm: new Date(Date.now() + 60000),
    })
    const res = await app.inject({
      method: 'POST', url: '/ativar/u1',
      ...form({ passo: 'CELULAR', codigo: '654321' }),
    })
    expect(res.statusCode).toBe(302)
    expect(res.headers['location']).toBe('/admin/login?ativado=1')
  })

  it('POST /ativar/:usuarioId com código inválido re-renderiza com erro', async () => {
    prisma.usuario.findUnique.mockResolvedValue(USUARIO)
    prisma.codigoValidacao.findFirst.mockResolvedValue(null)
    const res = await app.inject({
      method: 'POST', url: '/ativar/u1',
      ...form({ passo: 'EMAIL', codigo: '000000' }),
    })
    expect(res.statusCode).toBe(200)
    expect(res.body).toMatch(/Código inválido/i)
  })

  it('POST /reenviar/:usuarioId redireciona para login quando usuário não existe', async () => {
    prisma.usuario.findUnique.mockResolvedValue(null)
    const res = await app.inject({
      method: 'POST', url: '/reenviar/u1',
      ...form({ passo: 'EMAIL' }),
    })
    expect(res.statusCode).toBe(302)
    expect(res.headers['location']).toBe('/admin/login')
  })

  it('POST /reenviar/:usuarioId com sucesso re-renderiza com info', async () => {
    prisma.usuario.findUnique.mockResolvedValue(USUARIO)
    prisma.codigoValidacao.deleteMany.mockResolvedValue({ count: 0 })
    prisma.codigoValidacao.create.mockResolvedValue({ id: 'c1', expiradoEm: new Date(Date.now() + 900000) })
    const res = await app.inject({
      method: 'POST', url: '/reenviar/u1',
      ...form({ passo: 'EMAIL' }),
    })
    expect(res.statusCode).toBe(200)
    expect(res.body).toMatch(/reenviado/i)
  })
})

describe('adminAuthRoutes — login', () => {
  let app: FastifyInstance
  let prisma: PrismaMock

  beforeEach(async () => {
    ({ app, prisma } = await criarApp({ registrar: adminAuthRoutes, comView: true }))
  })

  it('GET /login renderiza tela', async () => {
    const res = await app.inject({ method: 'GET', url: '/login' })
    expect(res.statusCode).toBe(200)
  })

  it('POST /login com credenciais inválidas re-renderiza com erro', async () => {
    prisma.usuario.findFirst.mockResolvedValue(null)
    const res = await app.inject({
      method: 'POST', url: '/login',
      ...form({ email: 'nao@existe.com', senha: 'qualquer123' }),
    })
    expect(res.statusCode).toBe(200)
    expect(res.body).toMatch(/E-mail ou senha inválidos/i)
  })

  it('POST /login com emailValidado=false redireciona para ativar passo=EMAIL', async () => {
    prisma.usuario.findFirst.mockResolvedValue({ ...USUARIO, emailValidado: false, ativo: false })
    const res = await app.inject({
      method: 'POST', url: '/login',
      ...form({ email: 'joao@exemplo.com', senha: 'senha1234' }),
    })
    expect(res.statusCode).toBe(302)
    expect(res.headers['location']).toBe('/admin/ativar/u1?passo=EMAIL')
  })

  it('POST /login com ativo=false redireciona para ativar passo=CELULAR', async () => {
    prisma.usuario.findFirst.mockResolvedValue({ ...USUARIO, emailValidado: true, ativo: false })
    const res = await app.inject({
      method: 'POST', url: '/login',
      ...form({ email: 'joao@exemplo.com', senha: 'senha1234' }),
    })
    expect(res.statusCode).toBe(302)
    expect(res.headers['location']).toBe('/admin/ativar/u1?passo=CELULAR')
  })

  it('POST /login com usuário não-admin re-renderiza com erro', async () => {
    prisma.usuario.findFirst.mockResolvedValue({ ...USUARIO, emailValidado: true, ativo: true })
    prisma.adminSistema.findFirst.mockResolvedValue(null)
    const res = await app.inject({
      method: 'POST', url: '/login',
      ...form({ email: 'joao@exemplo.com', senha: 'senha1234' }),
    })
    expect(res.statusCode).toBe(200)
    expect(res.body).toMatch(/Acesso restrito/i)
  })

  it('POST /login com admin válido seta cookie e redireciona para /admin', async () => {
    prisma.usuario.findFirst.mockResolvedValue({ ...USUARIO, emailValidado: true, ativo: true })
    prisma.adminSistema.findFirst.mockResolvedValue({ id: 'as1', usuarioId: 'u1', ativo: true })
    const res = await app.inject({
      method: 'POST', url: '/login',
      ...form({ email: 'joao@exemplo.com', senha: 'senha1234' }),
    })
    expect(res.statusCode).toBe(302)
    expect(res.headers['location']).toBe('/admin')
    expect(res.headers['set-cookie']).toMatch(/genesis_admin_token=/)
  })

  it('GET /logout limpa cookie e redireciona para /admin/login', async () => {
    const res = await app.inject({ method: 'GET', url: '/logout' })
    expect(res.statusCode).toBe(302)
    expect(res.headers['location']).toBe('/admin/login')
    expect(res.headers['set-cookie']).toMatch(/genesis_admin_token=;/)
  })

  it('POST /verificar-sessao com credenciais válidas retorna ok:true', async () => {
    prisma.usuario.findFirst.mockResolvedValue({ ...USUARIO, emailValidado: true, ativo: true })
    const res = await app.inject({
      method: 'POST', url: '/verificar-sessao',
      payload: { email: 'joao@exemplo.com', senha: 'senha1234' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })
  })

  it('POST /verificar-sessao com credenciais inválidas retorna 401', async () => {
    prisma.usuario.findFirst.mockResolvedValue(null)
    const res = await app.inject({
      method: 'POST', url: '/verificar-sessao',
      payload: { email: 'x@y.com', senha: 'errada123' },
    })
    expect(res.statusCode).toBe(401)
  })
})
