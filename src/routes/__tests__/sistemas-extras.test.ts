import { describe, it, expect, beforeEach } from 'vitest'
import { criarApp, tokenJwt } from './helpers/criarApp.js'
import { sistemasRoutes } from '../sistemas.js'
import type { FastifyInstance } from 'fastify'
import type { PrismaMock } from '../../services/__tests__/helpers/prisma-mock.js'

const SISTEMA = { id: 's1', nome: 'Sistema X', descricao: null, ativo: true, criadoEm: new Date(), atualizadoEm: new Date() }

describe('sistemasRoutes — branches restantes', () => {
  let app: FastifyInstance
  let prisma: PrismaMock
  let auth: { authorization: string }

  beforeEach(async () => {
    ;({ app, prisma } = await criarApp({ registrar: sistemasRoutes, proteger: true }))
    auth = { authorization: `Bearer ${tokenJwt(app, { sub: 'u1', email: 'a@b.com' })}` }
    prisma.adminSistema.findUnique.mockResolvedValue({ id: 'as0', ativo: true })
  })

  it('GET /sistemas/:id retorna o sistema quando existe', async () => {
    prisma.sistema.findUnique.mockResolvedValue(SISTEMA)
    const res = await app.inject({ method: 'GET', url: '/sistemas/s1', headers: auth })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.id).toBe('s1')
  })

  it('DELETE /sistemas/:id retorna 404 quando sistema não existe', async () => {
    prisma.sistema.findUnique.mockResolvedValue(null)
    const res = await app.inject({ method: 'DELETE', url: '/sistemas/s-x', headers: auth })
    expect(res.statusCode).toBe(404)
  })
})
