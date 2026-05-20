import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Prisma } from '@prisma/client'

vi.mock('argon2', () => ({ hash: vi.fn(async (s: string) => `hashed:${s}`) }))

import { criarApp, tokenJwt } from './helpers/criarApp.js'
import { usuariosRoutes } from '../usuarios.js'
import type { FastifyInstance } from 'fastify'
import type { PrismaMock } from '../../services/__tests__/helpers/prisma-mock.js'

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
  emailValidado: true,
  celularValidado: true,
  ativo: true,
  criadoEm: new Date(),
  atualizadoEm: new Date(),
}

describe('usuariosRoutes (autenticadas via Bearer JWT)', () => {
  let app: FastifyInstance
  let prisma: PrismaMock
  let auth: { authorization: string }

  beforeEach(async () => {
    ({ app, prisma } = await criarApp({ registrar: usuariosRoutes, proteger: true }))
    auth = { authorization: `Bearer ${tokenJwt(app, { sub: 'u1', email: 'joao@exemplo.com' })}` }
  })

  it('GET /usuarios retorna 401 sem token', async () => {
    const res = await app.inject({ method: 'GET', url: '/usuarios' })
    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe('NAO_AUTENTICADO')
  })

  it('GET /usuarios retorna lista com token válido', async () => {
    prisma.usuario.findMany.mockResolvedValue([USUARIO_DB])
    const res = await app.inject({ method: 'GET', url: '/usuarios', headers: auth })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toHaveLength(1)
    expect(prisma.usuario.findMany).toHaveBeenCalled()
  })

  it('GET /usuarios/:id retorna 404 quando usuário não existe', async () => {
    prisma.usuario.findUnique.mockResolvedValue(null)
    const res = await app.inject({ method: 'GET', url: '/usuarios/u1', headers: auth })
    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe('RECURSO_NAO_ENCONTRADO')
  })

  it('GET /usuarios/:id retorna usuário', async () => {
    prisma.usuario.findUnique.mockResolvedValue(USUARIO_DB)
    const res = await app.inject({ method: 'GET', url: '/usuarios/u1', headers: auth })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.id).toBe('u1')
  })

  it('PUT /usuarios/:id retorna 404 quando usuário não existe', async () => {
    prisma.usuario.findUnique.mockResolvedValue(null)
    const res = await app.inject({
      method: 'PUT', url: '/usuarios/u1', headers: auth,
      payload: { nomeCompleto: 'Novo Nome' },
    })
    expect(res.statusCode).toBe(404)
  })

  it('PUT /usuarios/:id atualiza e retorna dados públicos', async () => {
    prisma.usuario.findUnique.mockResolvedValue(USUARIO_DB)
    prisma.usuario.update.mockResolvedValue({ ...USUARIO_DB, nomeCompleto: 'Novo Nome' })
    const res = await app.inject({
      method: 'PUT', url: '/usuarios/u1', headers: auth,
      payload: { nomeCompleto: 'Novo Nome' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.nomeCompleto).toBe('Novo Nome')
  })

  it('PUT /usuarios/:id retorna 400 quando schema falha (email inválido)', async () => {
    const res = await app.inject({
      method: 'PUT', url: '/usuarios/u1', headers: auth,
      payload: { emailAlternativo: 'nao-é-email' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('PUT /usuarios/:id retorna 404 quando Prisma lança P2025', async () => {
    prisma.usuario.findUnique.mockResolvedValue(USUARIO_DB)
    prisma.usuario.update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('not found', { code: 'P2025', clientVersion: '7.0' })
    )
    const res = await app.inject({
      method: 'PUT', url: '/usuarios/u1', headers: auth,
      payload: { nomeCompleto: 'Novo Nome' },
    })
    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe('RECURSO_NAO_ENCONTRADO')
  })

  it('DELETE /usuarios/:id retorna 404 quando não existe', async () => {
    prisma.usuario.findUnique.mockResolvedValue(null)
    const res = await app.inject({ method: 'DELETE', url: '/usuarios/u1', headers: auth })
    expect(res.statusCode).toBe(404)
  })

  it('DELETE /usuarios/:id retorna 204 quando exclusão é permitida', async () => {
    prisma.usuario.findUnique.mockResolvedValue(USUARIO_DB)
    prisma.adminSistema.count.mockResolvedValue(0)
    prisma.adminModulo.count.mockResolvedValue(0)
    prisma.permissaoAcesso.count.mockResolvedValue(0)
    prisma.relatorioPersonalizado.count.mockResolvedValue(0)
    prisma.pastaFavorito.count.mockResolvedValue(0)
    prisma.favoritoRelatorio.count.mockResolvedValue(0)
    prisma.usuario.delete.mockResolvedValue(USUARIO_DB)
    const res = await app.inject({ method: 'DELETE', url: '/usuarios/u1', headers: auth })
    expect(res.statusCode).toBe(204)
  })

  it('DELETE /usuarios/:id retorna 409 quando usuário é admin de sistema', async () => {
    prisma.usuario.findUnique.mockResolvedValue(USUARIO_DB)
    prisma.adminSistema.count.mockResolvedValue(1)
    prisma.adminModulo.count.mockResolvedValue(0)
    prisma.permissaoAcesso.count.mockResolvedValue(0)
    prisma.relatorioPersonalizado.count.mockResolvedValue(0)
    prisma.pastaFavorito.count.mockResolvedValue(0)
    prisma.favoritoRelatorio.count.mockResolvedValue(0)
    const res = await app.inject({ method: 'DELETE', url: '/usuarios/u1', headers: auth })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe('CONFLITO')
  })

  it('PUT /usuarios/:id retorna 403 quando id ≠ sub do token (IDOR)', async () => {
    const res = await app.inject({
      method: 'PUT', url: '/usuarios/u2', headers: auth,
      payload: { nomeCompleto: 'Novo' },
    })
    expect(res.statusCode).toBe(403)
  })

  it('DELETE /usuarios/:id retorna 403 quando id ≠ sub do token (IDOR)', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/usuarios/u2', headers: auth })
    expect(res.statusCode).toBe(403)
  })
})
