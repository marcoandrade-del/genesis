import { describe, it, expect, beforeEach } from 'vitest'
import { criarApp, tokenJwt } from './helpers/criarApp.js'
import { itensRoutes } from '../itens.js'
import type { FastifyInstance } from 'fastify'
import type { PrismaMock } from '../../services/__tests__/helpers/prisma-mock.js'

const MENU = { id: 'me1', moduloId: 'mo1', nome: 'Menu', icone: null, ordem: 0, ativo: true, criadoEm: new Date(), atualizadoEm: new Date() }
const ITEM = {
  id: 'i1', menuId: 'me1', parentId: null, nome: 'Item', descricao: null,
  tipo: 'FUNCIONALIDADE', tipoFuncionalidade: 'CRUD', rota: '/x', icone: null, ordem: 0,
  ativo: true, criadoEm: new Date(), atualizadoEm: new Date(),
}

describe('itensRoutes', () => {
  let app: FastifyInstance
  let prisma: PrismaMock
  let auth: { authorization: string }

  beforeEach(async () => {
    ({ app, prisma } = await criarApp({ registrar: itensRoutes, proteger: true }))
    auth = { authorization: `Bearer ${tokenJwt(app, { sub: 'u1', email: 'a@b.com' })}` }
  })

  it('GET /menus/:menuId/itens exige auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/menus/me1/itens' })
    expect(res.statusCode).toBe(401)
  })

  it('GET /menus/:menuId/itens retorna 404 quando menu não existe', async () => {
    prisma.menu.findUnique.mockResolvedValue(null)
    const res = await app.inject({ method: 'GET', url: '/menus/me1/itens', headers: auth })
    expect(res.statusCode).toBe(404)
  })

  it('GET /menus/:menuId/itens retorna lista', async () => {
    prisma.menu.findUnique.mockResolvedValue(MENU)
    prisma.itemFuncionalidade.findMany.mockResolvedValue([ITEM])
    const res = await app.inject({ method: 'GET', url: '/menus/me1/itens', headers: auth })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toHaveLength(1)
  })

  it('POST /menus/:menuId/itens retorna 201 para FUNCIONALIDADE com tipoFuncionalidade', async () => {
    prisma.menu.findUnique.mockResolvedValue(MENU)
    prisma.itemFuncionalidade.create.mockResolvedValue(ITEM)
    const res = await app.inject({
      method: 'POST', url: '/menus/me1/itens', headers: auth,
      payload: { nome: 'Item', tipo: 'FUNCIONALIDADE', tipoFuncionalidade: 'CRUD' },
    })
    expect(res.statusCode).toBe(201)
  })

  it('POST /menus/:menuId/itens retorna 400 quando FUNCIONALIDADE sem tipoFuncionalidade', async () => {
    prisma.menu.findUnique.mockResolvedValue(MENU)
    const res = await app.inject({
      method: 'POST', url: '/menus/me1/itens', headers: auth,
      payload: { nome: 'Item', tipo: 'FUNCIONALIDADE' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('REQUISICAO_INVALIDA')
  })

  it('POST /menus/:menuId/itens retorna 400 quando SUBMENU com tipoFuncionalidade', async () => {
    prisma.menu.findUnique.mockResolvedValue(MENU)
    const res = await app.inject({
      method: 'POST', url: '/menus/me1/itens', headers: auth,
      payload: { nome: 'Item', tipo: 'SUBMENU', tipoFuncionalidade: 'CRUD' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('PUT /itens/:id atualiza com sucesso', async () => {
    prisma.itemFuncionalidade.findUnique.mockResolvedValue(ITEM)
    prisma.itemFuncionalidade.update.mockResolvedValue({ ...ITEM, nome: 'Novo' })
    const res = await app.inject({
      method: 'PUT', url: '/itens/i1', headers: auth,
      payload: { nome: 'Novo' },
    })
    expect(res.statusCode).toBe(200)
  })

  it('DELETE /itens/:id retorna 404 quando não existe', async () => {
    prisma.itemFuncionalidade.findUnique.mockResolvedValue(null)
    const res = await app.inject({ method: 'DELETE', url: '/itens/i1', headers: auth })
    expect(res.statusCode).toBe(404)
  })
})
