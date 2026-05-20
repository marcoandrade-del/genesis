import { describe, it, expect, beforeEach } from 'vitest'
import { criarApp, tokenJwt } from './helpers/criarApp.js'
import { modulosRoutes } from '../modulos.js'
import type { FastifyInstance } from 'fastify'
import type { PrismaMock } from '../../services/__tests__/helpers/prisma-mock.js'

const MODULO = { id: 'm1', sistemaId: 's1', nome: 'Mod', descricao: null, ativo: true, criadoEm: new Date(), atualizadoEm: new Date() }

describe('modulosRoutes — branches restantes', () => {
  let app: FastifyInstance
  let prisma: PrismaMock
  let auth: { authorization: string }

  beforeEach(async () => {
    ;({ app, prisma } = await criarApp({ registrar: modulosRoutes, proteger: true }))
    auth = { authorization: `Bearer ${tokenJwt(app, { sub: 'u1', email: 'a@b.com' })}` }
    prisma.adminSistema.findUnique.mockResolvedValue({ id: 'as0', ativo: true })
    prisma.adminModulo.findUnique.mockResolvedValue({ id: 'am0', ativo: true })
  })

  it('GET /modulos/:id retorna o módulo quando existe', async () => {
    prisma.modulo.findUnique.mockResolvedValue(MODULO)
    const res = await app.inject({ method: 'GET', url: '/modulos/m1', headers: auth })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.id).toBe('m1')
  })

  it('DELETE /modulos/:id retorna 204 ao excluir com sucesso', async () => {
    prisma.modulo.findUnique.mockResolvedValue(MODULO)
    prisma.modulo.delete.mockResolvedValue(MODULO)
    const res = await app.inject({ method: 'DELETE', url: '/modulos/m1', headers: auth })
    expect(res.statusCode).toBe(204)
  })

  it('DELETE /modulos/:id retorna 403 quando usuário não é admin do módulo', async () => {
    prisma.modulo.findUnique.mockResolvedValue(MODULO)
    prisma.adminModulo.findUnique.mockResolvedValue(null)
    prisma.adminSistema.findUnique.mockResolvedValue(null)
    const res = await app.inject({ method: 'DELETE', url: '/modulos/m1', headers: auth })
    expect(res.statusCode).toBe(403)
  })
})
