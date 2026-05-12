import Fastify, { type FastifyInstance } from 'fastify'
import cookie from '@fastify/cookie'
import formbody from '@fastify/formbody'
import fastifyJwt from '@fastify/jwt'
import view from '@fastify/view'
import ejs from 'ejs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { FastifyRequest, FastifyReply } from 'fastify'
import { erroHttp } from '../../../errors.js'
import { criarPrismaMock, type PrismaMock } from '../../../services/__tests__/helpers/prisma-mock.js'

export const JWT_SECRET = 'test-secret-only-for-vitest'
const __dirname = path.dirname(fileURLToPath(import.meta.url))

type Opcoes = {
  registrar: (app: FastifyInstance) => Promise<void> | void
  prefix?: string
  proteger?: boolean
  comView?: boolean
  // Simula admin autenticado via cookie: injeta req.user antes do handler.
  simularAdmin?: { sub: string; email: string }
}

// Fastify mínimo para testes: prisma mockado, JWT real, cookie+formbody, sem view engine.
// A view engine não é usada nas rotas API; nas rotas admin que renderizam EJS, os
// testes inspecionam apenas status/headers/HX-Trigger — não o HTML.
export async function criarApp(opcoes: Opcoes): Promise<{ app: FastifyInstance; prisma: PrismaMock }> {
  const app = Fastify({ logger: false })
  const prisma = criarPrismaMock()

  app.decorate('prisma', prisma as never)
  await app.register(cookie)
  await app.register(formbody)
  await app.register(fastifyJwt, { secret: JWT_SECRET })
  if (opcoes.comView) {
    await app.register(view, {
      engine: { ejs },
      root: path.join(__dirname, '..', '..', '..', 'views'),
      viewExt: 'ejs',
    })
  }

  app.decorate('authenticate', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      await req.jwtVerify()
    } catch {
      return reply.status(401).send(erroHttp('NAO_AUTENTICADO', 'Token inválido ou ausente.'))
    }
  })

  if (opcoes.proteger) {
    await app.register(async (api) => {
      api.addHook('onRequest', app.authenticate)
      await opcoes.registrar(api)
    }, opcoes.prefix ? { prefix: opcoes.prefix } : {})
  } else if (opcoes.simularAdmin) {
    const userFake = opcoes.simularAdmin
    await app.register(async (api) => {
      api.addHook('onRequest', async (req) => { req.user = userFake })
      await opcoes.registrar(api)
    }, opcoes.prefix ? { prefix: opcoes.prefix } : {})
  } else {
    await app.register(opcoes.registrar, opcoes.prefix ? { prefix: opcoes.prefix } : {})
  }

  return { app, prisma }
}

export function tokenJwt(app: FastifyInstance, payload: { sub: string; email: string }) {
  return app.jwt.sign(payload)
}
