import { describe, it, expect, beforeEach } from 'vitest'
import { criarApp, tokenJwt } from './helpers/criarApp.js'
import { menusRoutes } from '../menus.js'
import type { FastifyInstance } from 'fastify'
import type { PrismaMock } from '../../services/__tests__/helpers/prisma-mock.js'

const MODULO = { id: 'mo1', sistemaId: 's1', nome: 'Mod', descricao: null, ativo: true, criadoEm: new Date(), atualizadoEm: new Date() }
const MENU = { id: 'me1', moduloId: 'mo1', nome: 'Menu', icone: null, ordem: 0, ativo: true, criadoEm: new Date(), atualizadoEm: new Date() }

describe('menusRoutes', () => {
  let app: FastifyInstance
  let prisma: PrismaMock
  let auth: { authorization: string }

  beforeEach(async () => {
    ({ app, prisma } = await criarApp({ registrar: menusRoutes, proteger: true }))
    auth = { authorization: `Bearer ${tokenJwt(app, { sub: 'u1', email: 'a@b.com' })}` }
    prisma.adminModulo.findUnique.mockResolvedValue({ id: 'am0', ativo: true })
  })

  it('GET /modulos/:moduloId/menus exige auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/modulos/mo1/menus' })
    expect(res.statusCode).toBe(401)
  })

  it('GET /modulos/:moduloId/menus retorna 404 quando módulo não existe', async () => {
    prisma.modulo.findUnique.mockResolvedValue(null)
    const res = await app.inject({ method: 'GET', url: '/modulos/mo1/menus', headers: auth })
    expect(res.statusCode).toBe(404)
  })

  it('GET /modulos/:moduloId/menus retorna lista', async () => {
    prisma.modulo.findUnique.mockResolvedValue(MODULO)
    prisma.menu.findMany.mockResolvedValue([MENU])
    const res = await app.inject({ method: 'GET', url: '/modulos/mo1/menus', headers: auth })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toHaveLength(1)
  })

  it('GET /menus/:id retorna 404 quando não existe', async () => {
    prisma.menu.findUnique.mockResolvedValue(null)
    const res = await app.inject({ method: 'GET', url: '/menus/me1', headers: auth })
    expect(res.statusCode).toBe(404)
  })

  it('POST /modulos/:moduloId/menus retorna 201', async () => {
    prisma.modulo.findUnique.mockResolvedValue(MODULO)
    prisma.menu.create.mockResolvedValue(MENU)
    const res = await app.inject({
      method: 'POST', url: '/modulos/mo1/menus', headers: auth,
      payload: { nome: 'Menu' },
    })
    expect(res.statusCode).toBe(201)
  })

  it('POST /modulos/:moduloId/menus retorna 409 quando módulo inativo', async () => {
    prisma.modulo.findUnique.mockResolvedValue({ ...MODULO, ativo: false })
    const res = await app.inject({
      method: 'POST', url: '/modulos/mo1/menus', headers: auth,
      payload: { nome: 'Menu' },
    })
    expect(res.statusCode).toBe(409)
  })

  it('PUT /menus/:id atualiza com sucesso', async () => {
    prisma.menu.findUnique.mockResolvedValue(MENU)
    prisma.menu.update.mockResolvedValue({ ...MENU, nome: 'Novo' })
    const res = await app.inject({
      method: 'PUT', url: '/menus/me1', headers: auth,
      payload: { nome: 'Novo' },
    })
    expect(res.statusCode).toBe(200)
  })

  it('DELETE /menus/:id retorna 404 quando não existe', async () => {
    prisma.menu.findUnique.mockResolvedValue(null)
    const res = await app.inject({ method: 'DELETE', url: '/menus/me1', headers: auth })
    expect(res.statusCode).toBe(404)
  })

  it('POST /modulos/:moduloId/menus retorna 403 quando usuário não é admin do módulo', async () => {
    prisma.adminModulo.findUnique.mockResolvedValue(null)
    prisma.modulo.findUnique.mockResolvedValue(MODULO)
    prisma.adminSistema.findUnique.mockResolvedValue(null)
    const res = await app.inject({
      method: 'POST', url: '/modulos/mo1/menus', headers: auth,
      payload: { nome: 'Menu' },
    })
    expect(res.statusCode).toBe(403)
  })

  it('PUT /menus/:id retorna 403 quando usuário não é admin do módulo', async () => {
    prisma.menu.findUnique.mockResolvedValue(MENU)
    prisma.adminModulo.findUnique.mockResolvedValue(null)
    prisma.modulo.findUnique.mockResolvedValue(MODULO)
    prisma.adminSistema.findUnique.mockResolvedValue(null)
    const res = await app.inject({
      method: 'PUT', url: '/menus/me1', headers: auth,
      payload: { nome: 'Novo' },
    })
    expect(res.statusCode).toBe(403)
  })
})
