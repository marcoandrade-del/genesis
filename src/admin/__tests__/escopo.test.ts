import { describe, it, expect, beforeEach } from 'vitest'

import { criarApp } from '../../routes/__tests__/helpers/criarApp.js'
import { adminEscopoRoutes } from '../escopo.js'
import type { FastifyInstance } from 'fastify'

describe('adminEscopoRoutes', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    ;({ app } = await criarApp({
      registrar: adminEscopoRoutes,
      comView: true,
      simularAdmin: { sub: 'admin1', email: 'admin@exemplo.com' },
    }))
  })

  it('GET / renderiza o painel de escopo com KPIs e áreas', async () => {
    const res = await app.inject({ method: 'GET', url: '/' })

    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('Escopo do Sistema')
    expect(res.body).toContain('Concluído')
    expect(res.body).toContain('Compras Públicas (Lei 14.133)')
  })

  it('GET / repassa o email do admin autenticado para a view', async () => {
    const res = await app.inject({ method: 'GET', url: '/' })

    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('admin@exemplo.com')
  })
})
