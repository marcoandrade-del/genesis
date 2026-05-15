import { describe, it, expect, beforeEach } from 'vitest'
import { criarApp, tokenJwt } from './helpers/criarApp.js'
import { sistemasRoutes } from '../sistemas.js'
import type { FastifyInstance } from 'fastify'
import type { PrismaMock } from '../../services/__tests__/helpers/prisma-mock.js'

const SISTEMA = { id: 's1', nome: 'Sistema X', descricao: null, ativo: true, criadoEm: new Date(), atualizadoEm: new Date() }
const ADMIN_USER = { id: 'u1', nomeCompleto: 'Admin', ativo: true }

describe('sistemasRoutes', () => {
  let app: FastifyInstance
  let prisma: PrismaMock
  let auth: { authorization: string }

  beforeEach(async () => {
    ({ app, prisma } = await criarApp({ registrar: sistemasRoutes, proteger: true }))
    auth = { authorization: `Bearer ${tokenJwt(app, { sub: 'u1', email: 'a@b.com' })}` }
  })

  it('GET /sistemas exige autenticação', async () => {
    const res = await app.inject({ method: 'GET', url: '/sistemas' })
    expect(res.statusCode).toBe(401)
  })

  it('GET /sistemas retorna lista', async () => {
    prisma.sistema.findMany.mockResolvedValue([SISTEMA])
    const res = await app.inject({ method: 'GET', url: '/sistemas', headers: auth })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toHaveLength(1)
  })

  it('GET /sistemas/:id retorna 404 quando não existe', async () => {
    prisma.sistema.findUnique.mockResolvedValue(null)
    const res = await app.inject({ method: 'GET', url: '/sistemas/s1', headers: auth })
    expect(res.statusCode).toBe(404)
  })

  it('POST /sistemas retorna 400 quando body falha no schema', async () => {
    const res = await app.inject({
      method: 'POST', url: '/sistemas', headers: auth,
      payload: { nome: 'X' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('POST /sistemas retorna 201 com sucesso', async () => {
    prisma.usuario.findUnique.mockResolvedValue(ADMIN_USER)
    prisma.sistema.create.mockResolvedValue(SISTEMA)
    prisma.adminSistema.create.mockResolvedValue({})

    const res = await app.inject({
      method: 'POST', url: '/sistemas', headers: auth,
      payload: { nome: 'Sistema X', adminUsuarioId: '00000000-0000-0000-0000-000000000001' },
    })
    expect(res.statusCode).toBe(201)
  })

  it('POST /sistemas retorna 404 quando admin não existe', async () => {
    prisma.usuario.findUnique.mockResolvedValue(null)
    const res = await app.inject({
      method: 'POST', url: '/sistemas', headers: auth,
      payload: { nome: 'Sistema X', adminUsuarioId: '00000000-0000-0000-0000-000000000001' },
    })
    expect(res.statusCode).toBe(404)
  })

  it('PUT /sistemas/:id retorna 404 quando não existe', async () => {
    prisma.sistema.findUnique.mockResolvedValue(null)
    const res = await app.inject({
      method: 'PUT', url: '/sistemas/s1', headers: auth,
      payload: { nome: 'Novo Nome' },
    })
    expect(res.statusCode).toBe(404)
  })

  it('PUT /sistemas/:id atualiza com sucesso', async () => {
    prisma.sistema.findUnique.mockResolvedValue(SISTEMA)
    prisma.sistema.update.mockResolvedValue({ ...SISTEMA, nome: 'Novo' })
    const res = await app.inject({
      method: 'PUT', url: '/sistemas/s1', headers: auth,
      payload: { nome: 'Novo' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.nome).toBe('Novo')
  })

  it('DELETE /sistemas/:id retorna 204 com sucesso', async () => {
    prisma.sistema.findUnique.mockResolvedValue(SISTEMA)
    prisma.adminSistema.findUnique.mockResolvedValue({ ativo: true })
    prisma.relatorioFixo.count.mockResolvedValue(0)
    const res = await app.inject({ method: 'DELETE', url: '/sistemas/s1', headers: auth })
    expect(res.statusCode).toBe(204)
  })

  it('DELETE /sistemas/:id retorna 409 quando há relatórios vinculados', async () => {
    prisma.sistema.findUnique.mockResolvedValue(SISTEMA)
    prisma.adminSistema.findUnique.mockResolvedValue({ ativo: true })
    prisma.relatorioFixo.count.mockResolvedValue(3)
    const res = await app.inject({ method: 'DELETE', url: '/sistemas/s1', headers: auth })
    expect(res.statusCode).toBe(409)
  })

  it('DELETE /sistemas/:id retorna 403 quando usuário não é admin do sistema', async () => {
    prisma.sistema.findUnique.mockResolvedValue(SISTEMA)
    prisma.adminSistema.findUnique.mockResolvedValue(null)
    const res = await app.inject({ method: 'DELETE', url: '/sistemas/s1', headers: auth })
    expect(res.statusCode).toBe(403)
  })
})
