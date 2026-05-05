import type { FastifyInstance } from 'fastify'
import type { TipoValidacao } from '@prisma/client'
import { CodigosService } from '../services/codigos.js'
import { tratarErro } from '../errors.js'
import { sSolicitarValidacao, sValidarCodigo } from '../schemas.js'

export async function codigosRoutes(app: FastifyInstance) {
  const service = new CodigosService(app.prisma)

  app.post<{ Params: { usuarioId: string }; Body: { tipo: TipoValidacao } }>(
    '/usuarios/:usuarioId/solicitar-validacao',
    { schema: sSolicitarValidacao },
    async (req, reply) => {
      try {
        const data = await service.solicitar(req.params.usuarioId, req.body.tipo)
        return reply.status(201).send({ data })
      } catch (e) {
        return tratarErro(e, reply)
      }
    }
  )

  app.post<{ Params: { usuarioId: string }; Body: { tipo: TipoValidacao; codigo: string } }>(
    '/usuarios/:usuarioId/validar',
    { schema: sValidarCodigo },
    async (req, reply) => {
      try {
        const data = await service.validar(req.params.usuarioId, req.body.tipo, req.body.codigo)
        return { data }
      } catch (e) {
        return tratarErro(e, reply)
      }
    }
  )
}
