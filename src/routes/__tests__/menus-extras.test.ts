import { describe, it, expect, beforeEach } from 'vitest'
import { criarApp, tokenJwt } from './helpers/criarApp.js'
import { menusRoutes } from '../menus.js'
import type { FastifyInstance } from 'fastify'
import type { PrismaMock } from '../../services/__tests__/helpers/prisma-mock.js'

const MENU = { id: 'me1', moduloId: 'mo1', nome: 'Menu', icone: null, ordem: 0, ativo: true, criadoEm: new Date(), atualizadoEm: new Date() }

describe('menusRoutes — branches restantes', () => {
  let app: FastifyInstance
  let prisma: PrismaMock
  let auth: { authorization: string }

  beforeEach(async () => {
    ;({ app, prisma } = await criarApp({ registrar: menusRoutes, proteger: true }))
    auth = { authorization: `Bearer ${tokenJwt(app, { sub: 'u1', email: 'a@b.com' })}` }
    prisma.adminModulo.findUnique.mockResolvedValue({ id: 'am0', ativo: true })
  })

  it('GET /menus/:id retorna o menu quando existe', async () => {
    prisma.menu.findUnique.mockResolvedValue(MENU)
    const res = await app.inject({ method: 'GET', url: '/menus/me1', headers: auth })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.id).toBe('me1')
  })

  it('PUT /menus/:id retorna 404 quando menu não existe', async () => {
    prisma.menu.findUnique.mockResolvedValue(null)
    const res = await app.inject({
      method: 'PUT', url: '/menus/me-x', headers: auth, payload: { nome: 'X' },
    })
    expect(res.statusCode).toBe(404)
  })

  it('DELETE /menus/:id retorna 204 ao excluir com sucesso', async () => {
    prisma.menu.findUnique.mockResolvedValue(MENU)
    prisma.menu.delete.mockResolvedValue(MENU)
    const res = await app.inject({ method: 'DELETE', url: '/menus/me1', headers: auth })
    expect(res.statusCode).toBe(204)
  })

  it('DELETE /menus/:id retorna 403 quando usuário não é admin do módulo', async () => {
    prisma.menu.findUnique.mockResolvedValue(MENU)
    prisma.adminModulo.findUnique.mockResolvedValue(null)
    prisma.adminSistema.findUnique.mockResolvedValue(null)
    const res = await app.inject({ method: 'DELETE', url: '/menus/me1', headers: auth })
    expect(res.statusCode).toBe(403)
  })
})
