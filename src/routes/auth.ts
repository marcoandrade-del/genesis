import type { FastifyInstance } from 'fastify'
import type { TipoValidacao } from '@prisma/client'
import { AuthService } from '../services/auth.js'
import { CodigosService } from '../services/codigos.js'
import { tratarErro } from '../errors.js'
import { sLogin, sRegistro, sSolicitarValidacao, sValidarCodigo } from '../schemas.js'

// Rotas públicas — não exigem token JWT

export async function authRoutes(app: FastifyInstance) {
  const authService = new AuthService(app.prisma)
  const codigosService = new CodigosService(app.prisma)

  app.post<{
    Body: {
      cpf?: string
      idEstrangeiro?: string
      nomeCompleto: string
      nomeSocial: string
      dataNascimento: string
      emailPrincipal: string
      emailAlternativo?: string
      telefonePrincipal: string
      telefoneAlternativo?: string
      senha: string
    }
  }>('/auth/registro', { schema: sRegistro }, async (req, reply) => {
    try {
      const data = await authService.registrar(req.body)
      return reply.status(201).send({ data })
    } catch (e) {
      return tratarErro(e, reply)
    }
  })

  app.post<{ Body: { email: string; senha: string } }>(
    '/auth/login',
    {
      schema: sLogin,
      config: { rateLimit: { max: 10, timeWindow: '5 minutes' } },
    },
    async (req, reply) => {
      try {
        const payload = await authService.login(req.body.email, req.body.senha)
        const token = app.jwt.sign(payload, { expiresIn: '8h' })
        return { data: { token } }
      } catch (e) {
        return tratarErro(e, reply)
      }
    }
  )

  // Ativação de conta — pública porque o usuário ainda não tem token
  app.post<{ Params: { usuarioId: string }; Body: { tipo: TipoValidacao } }>(
    '/auth/solicitar-validacao/:usuarioId',
    { schema: sSolicitarValidacao },
    async (req, reply) => {
      try {
        const data = await codigosService.solicitar(req.params.usuarioId, req.body.tipo)
        return reply.status(201).send({ data })
      } catch (e) {
        return tratarErro(e, reply)
      }
    }
  )

  app.post<{ Params: { usuarioId: string }; Body: { tipo: TipoValidacao; codigo: string } }>(
    '/auth/validar/:usuarioId',
    { schema: sValidarCodigo },
    async (req, reply) => {
      try {
        const data = await codigosService.validar(req.params.usuarioId, req.body.tipo, req.body.codigo)
        return { data }
      } catch (e) {
        return tratarErro(e, reply)
      }
    }
  )
}
