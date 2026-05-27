import { describe, it, expect, beforeEach } from 'vitest'

import { criarApp } from '../../routes/__tests__/helpers/criarApp.js'
import { adminNotFoundHandler } from '../index.js'
import type { FastifyInstance } from 'fastify'

describe('adminNotFoundHandler', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    ;({ app } = await criarApp({
      registrar: async (api) => {
        api.setNotFoundHandler(adminNotFoundHandler)
        // Pelo menos uma rota válida pra contraprova; qualquer outra cai no 404.
        api.get('/existo', async (_req, reply) => reply.send('ok'))
      },
      comView: true,
    }))
  })

  it('rota existente segue normal', async () => {
    const res = await app.inject({ method: 'GET', url: '/existo' })
    expect(res.statusCode).toBe(200)
  })

  it('rota inexistente devolve HTML 404 com o caminho ecoado e link de volta', async () => {
    const res = await app.inject({ method: 'GET', url: '/nao-existe-mesmo' })
    expect(res.statusCode).toBe(404)
    expect(res.headers['content-type']).toMatch(/text\/html/)
    expect(res.body).toContain('Página não encontrada')
    expect(res.body).toContain('/nao-existe-mesmo')
    expect(res.body).toContain('/admin') // link Voltar
  })
})
