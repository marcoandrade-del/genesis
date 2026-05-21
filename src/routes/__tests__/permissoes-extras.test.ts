import { describe, it, expect, beforeEach } from 'vitest'
import { criarApp, tokenJwt } from './helpers/criarApp.js'
import { permissoesRoutes } from '../permissoes.js'
import type { FastifyInstance } from 'fastify'
import type { PrismaMock } from '../../services/__tests__/helpers/prisma-mock.js'

const ITEM = {
  id: 'i1', menuId: 'me1', parentId: null, nome: 'Item', descricao: null,
  tipo: 'FUNCIONALIDADE', tipoFuncionalidade: 'CRUD', rota: '/x', icone: null, ordem: 0,
  ativo: true, criadoEm: new Date(), atualizadoEm: new Date(),
  menu: { moduloId: 'm1' },
}
const PERMISSAO = { id: 'p1', usuarioId: 'u1', itemId: 'i1', nivel: 'VISUALIZAR', criadoEm: new Date() }

describe('permissoesRoutes — caminhos restantes', () => {
  let app: FastifyInstance
  let prisma: PrismaMock
  let auth: { authorization: string }

  beforeEach(async () => {
    ({ app, prisma } = await criarApp({ registrar: permissoesRoutes, proteger: true }))
    auth = { authorization: `Bearer ${tokenJwt(app, { sub: 'u1', email: 'a@b.com' })}` }
    prisma.adminModulo.findUnique.mockResolvedValue({ id: 'am0', ativo: true })
  })

  // Lines 32-33 — GET /itens/:itemId/permissoes success
  it('GET /itens/:itemId/permissoes retorna lista quando usuário é admin', async () => {
    prisma.itemFuncionalidade.findUnique.mockResolvedValue(ITEM)
    prisma.permissaoAcesso.findMany.mockResolvedValue([PERMISSAO])
    const res = await app.inject({ method: 'GET', url: '/itens/i1/permissoes', headers: auth })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toHaveLength(1)
  })

  // Line 72 — DELETE /permissoes/:id 404 quando permissão não existe
  it('DELETE /permissoes/:id retorna 404 quando permissão não existe', async () => {
    prisma.permissaoAcesso.findUnique.mockResolvedValue(null)
    const res = await app.inject({ method: 'DELETE', url: '/permissoes/p1', headers: auth })
    expect(res.statusCode).toBe(404)
  })

  // Line 78 — DELETE /permissoes/:id catch (assertAdminItem falha)
  it('DELETE /permissoes/:id retorna 403 quando usuário não é admin do item', async () => {
    prisma.permissaoAcesso.findUnique.mockResolvedValue(PERMISSAO)
    prisma.itemFuncionalidade.findUnique.mockResolvedValue(ITEM)
    prisma.adminModulo.findUnique.mockResolvedValue(null)
    prisma.modulo.findUnique.mockResolvedValue({ id: 'm1', sistemaId: 's1' })
    prisma.adminSistema.findUnique.mockResolvedValue(null)
    const res = await app.inject({ method: 'DELETE', url: '/permissoes/p1', headers: auth })
    expect(res.statusCode).toBe(403)
  })
})
