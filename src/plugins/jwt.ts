import fp from 'fastify-plugin'
import fastifyJwt from '@fastify/jwt'
import type { FastifyRequest, FastifyReply } from 'fastify'
import { erroHttp } from '../errors.js'

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string; email: string }
    user: { sub: string; email: string }
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>
  }
}

export default fp(async (app) => {
  const secret = process.env['JWT_SECRET']
  if (!secret) throw new Error('JWT_SECRET não configurado no .env')

  await app.register(fastifyJwt, { secret })

  app.decorate('authenticate', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      await req.jwtVerify()
    } catch {
      return reply.status(401).send(erroHttp('NAO_AUTENTICADO', 'Token inválido ou ausente.'))
    }
  })
})
