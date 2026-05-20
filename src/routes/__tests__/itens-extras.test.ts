import { describe, it, expect, beforeEach } from 'vitest'
import { criarApp, tokenJwt } from './helpers/criarApp.js'
import { itensRoutes } from '../itens.js'
import type { FastifyInstance } from 'fastify'
import type { PrismaMock } from '../../services/__tests__/helpers/prisma-mock.js'

const ITEM = {
  id: 'i1', menuId: 'me1', parentId: null, nome: 'Item', descricao: null,
  tipo: 'FUNCIONALIDADE', tipoFuncionalidade: 'CRUD', rota: '/x', icone: null, ordem: 0,
  ativo: true, criadoEm: new Date(), atualizadoEm: new Date(),
  menu: { moduloId: 'mo1' },
}

describe('itensRoutes — branches restantes', () => {
  let app: FastifyInstance
  let prisma: PrismaMock
  let auth: { authorization: string }

  beforeEach(async () => {
    ({ app, prisma } = await criarApp({ registrar: itensRoutes, proteger: true }))
    auth = { authorization: `Bearer ${tokenJwt(app, { sub: 'u1', email: 'a@b.com' })}` }
    prisma.adminModulo.findUnique.mockResolvedValue({ id: 'am0', ativo: true })
  })

  describe('GET /itens/:id', () => {
    it('retorna 404 quando item não existe', async () => {
      prisma.itemFuncionalidade.findUnique.mockResolvedValue(null)
      const res = await app.inject({ method: 'GET', url: '/itens/i-x', headers: auth })
      expect(res.statusCode).toBe(404)
      expect(res.json().error.code).toBe('RECURSO_NAO_ENCONTRADO')
    })

    it('retorna 200 com item', async () => {
      prisma.itemFuncionalidade.findUnique.mockResolvedValue(ITEM)
      const res = await app.inject({ method: 'GET', url: '/itens/i1', headers: auth })
      expect(res.statusCode).toBe(200)
      expect(res.json().data.id).toBe('i1')
    })
  })

  describe('PUT /itens/:id', () => {
    it('retorna 404 quando item não existe', async () => {
      prisma.itemFuncionalidade.findUnique.mockResolvedValue(null)
      const res = await app.inject({
        method: 'PUT', url: '/itens/i-x', headers: auth,
        payload: { nome: 'Novo' },
      })
      expect(res.statusCode).toBe(404)
    })
  })

  describe('DELETE /itens/:id', () => {
    it('exclui com sucesso e retorna 204', async () => {
      prisma.itemFuncionalidade.findUnique.mockResolvedValue(ITEM)
      prisma.itemFuncionalidade.delete.mockResolvedValue(ITEM)
      const res = await app.inject({ method: 'DELETE', url: '/itens/i1', headers: auth })
      expect(res.statusCode).toBe(204)
    })

    it('retorna 403 quando usuário não é admin do módulo', async () => {
      prisma.itemFuncionalidade.findUnique.mockResolvedValue(ITEM)
      prisma.adminModulo.findUnique.mockResolvedValue(null)
      prisma.adminSistema.findUnique.mockResolvedValue(null)
      prisma.modulo.findUnique.mockResolvedValue({ id: 'mo1', sistemaId: 's1' })
      const res = await app.inject({ method: 'DELETE', url: '/itens/i1', headers: auth })
      expect(res.statusCode).toBe(403)
    })
  })
})
