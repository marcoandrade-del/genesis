import type { FastifyInstance } from 'fastify'
import { ESCOPO, VISAO_GERAL, resumirEscopo } from '../services/escopo.js'

export async function adminEscopoRoutes(app: FastifyInstance) {
  app.get('/', async (req, reply) => {
    return reply.view(
      'escopo',
      {
        title: 'Escopo do Sistema — Gênesis Admin',
        active: 'escopo',
        userEmail: req.user.email,
        visaoGeral: VISAO_GERAL,
        areas: ESCOPO,
        resumo: resumirEscopo(ESCOPO),
      },
      { layout: 'layouts/main' },
    )
  })
}
