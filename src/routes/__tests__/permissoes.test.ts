import { describe, it, expect, beforeEach } from 'vitest'
import { criarApp, tokenJwt } from './helpers/criarApp.js'
import { permissoesRoutes } from '../permissoes.js'
import type { FastifyInstance } from 'fastify'
import type { PrismaMock } from '../../services/__tests__/helpers/prisma-mock.js'

const USUARIO = { id: 'u1', nomeCompleto: 'A', ativo: true }
const ITEM = {
  id: 'i1', menuId: 'me1', parentId: null, nome: 'Item', descricao: null,
  tipo: 'FUNCIONALIDADE', tipoFuncionalidade: 'CRUD', rota: '/x', icone: null, ordem: 0,
  ativo: true, criadoEm: new Date(), atualizadoEm: new Date(),
}
const PERMISSAO = { id: 'p1', usuarioId: 'u1', itemId: 'i1', nivel: 'VISUALIZAR', criadoEm: new Date() }
const ITEM_UUID = '00000000-0000-0000-0000-000000000abc'

describe('permissoesRoutes', () => {
  let app: FastifyInstance
  let prisma: PrismaMock
  let auth: { authorization: string }

  beforeEach(async () => {
    ({ app, prisma } = await criarApp({ registrar: permissoesRoutes, proteger: true }))
    auth = { authorization: `Bearer ${tokenJwt(app, { sub: 'u1', email: 'a@b.com' })}` }
  })

  it('GET /usuarios/:usuarioId/permissoes exige auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/usuarios/u1/permissoes' })
    expect(res.statusCode).toBe(401)
  })

  it('GET /usuarios/:usuarioId/permissoes retorna 404 quando usuário não existe', async () => {
    prisma.usuario.findUnique.mockResolvedValue(null)
    const res = await app.inject({ method: 'GET', url: '/usuarios/u1/permissoes', headers: auth })
    expect(res.statusCode).toBe(404)
  })

  it('GET /usuarios/:usuarioId/permissoes retorna lista', async () => {
    prisma.usuario.findUnique.mockResolvedValue(USUARIO)
    prisma.permissaoAcesso.findMany.mockResolvedValue([PERMISSAO])
    const res = await app.inject({ method: 'GET', url: '/usuarios/u1/permissoes', headers: auth })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toHaveLength(1)
  })

  it('GET /itens/:itemId/permissoes retorna 404 quando item não existe', async () => {
    prisma.itemFuncionalidade.findUnique.mockResolvedValue(null)
    const res = await app.inject({ method: 'GET', url: '/itens/i1/permissoes', headers: auth })
    expect(res.statusCode).toBe(404)
  })

  it('POST /usuarios/:usuarioId/permissoes retorna 201', async () => {
    prisma.usuario.findUnique.mockResolvedValue(USUARIO)
    prisma.itemFuncionalidade.findUnique.mockResolvedValue(ITEM)
    prisma.permissaoAcesso.create.mockResolvedValue(PERMISSAO)
    const res = await app.inject({
      method: 'POST', url: '/usuarios/u1/permissoes', headers: auth,
      payload: { itemId: ITEM_UUID, nivel: 'VISUALIZAR' },
    })
    expect(res.statusCode).toBe(201)
  })

  it('POST /usuarios/:usuarioId/permissoes retorna 409 quando usuário inativo', async () => {
    prisma.usuario.findUnique.mockResolvedValue({ ...USUARIO, ativo: false })
    prisma.itemFuncionalidade.findUnique.mockResolvedValue(ITEM)
    const res = await app.inject({
      method: 'POST', url: '/usuarios/u1/permissoes', headers: auth,
      payload: { itemId: ITEM_UUID, nivel: 'VISUALIZAR' },
    })
    expect(res.statusCode).toBe(409)
  })

  it('POST /usuarios/:usuarioId/permissoes retorna 400 para nível inválido (schema)', async () => {
    const res = await app.inject({
      method: 'POST', url: '/usuarios/u1/permissoes', headers: auth,
      payload: { itemId: ITEM_UUID, nivel: 'OUTRO' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('PUT /permissoes/:id retorna 404 quando não existe', async () => {
    prisma.permissaoAcesso.findUnique.mockResolvedValue(null)
    const res = await app.inject({
      method: 'PUT', url: '/permissoes/p1', headers: auth,
      payload: { nivel: 'EDITAR' },
    })
    expect(res.statusCode).toBe(404)
  })

  it('PUT /permissoes/:id atualiza com sucesso', async () => {
    prisma.permissaoAcesso.findUnique.mockResolvedValue(PERMISSAO)
    prisma.permissaoAcesso.update.mockResolvedValue({ ...PERMISSAO, nivel: 'EDITAR' })
    const res = await app.inject({
      method: 'PUT', url: '/permissoes/p1', headers: auth,
      payload: { nivel: 'EDITAR' },
    })
    expect(res.statusCode).toBe(200)
  })

  it('DELETE /permissoes/:id retorna 204', async () => {
    prisma.permissaoAcesso.findUnique.mockResolvedValue(PERMISSAO)
    prisma.permissaoAcesso.delete.mockResolvedValue(PERMISSAO)
    const res = await app.inject({ method: 'DELETE', url: '/permissoes/p1', headers: auth })
    expect(res.statusCode).toBe(204)
  })
})
