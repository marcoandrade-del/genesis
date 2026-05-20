import type { FastifyInstance } from 'fastify'
import { AdminsService } from '../services/admins.js'
import { tratarErro } from '../errors.js'
import { sAdicionarAdmin } from '../schemas.js'
import { assertAdminSistema, assertAdminModulo } from '../services/autorizacao.js'

export async function adminsRoutes(app: FastifyInstance) {
  const service = new AdminsService(app.prisma)

  // ── AdminSistema ──────────────────────────────────────────────

  app.get<{ Params: { sistemaId: string } }>(
    '/sistemas/:sistemaId/admins',
    async (req, reply) => {
      try {
        await assertAdminSistema(app.prisma, req.user.sub, req.params.sistemaId)
        const data = await service.listarAdminsSistema(req.params.sistemaId)
        return { data }
      } catch (e) {
        return tratarErro(e, reply)
      }
    }
  )

  app.post<{ Params: { sistemaId: string }; Body: { usuarioId: string } }>(
    '/sistemas/:sistemaId/admins',
    { schema: sAdicionarAdmin },
    async (req, reply) => {
      try {
        await assertAdminSistema(app.prisma, req.user.sub, req.params.sistemaId)
        const data = await service.adicionarAdminSistema(req.params.sistemaId, req.body.usuarioId)
        return reply.status(201).send({ data })
      } catch (e) {
        return tratarErro(e, reply)
      }
    }
  )

  app.delete<{ Params: { sistemaId: string; usuarioId: string } }>(
    '/sistemas/:sistemaId/admins/:usuarioId',
    async (req, reply) => {
      try {
        await assertAdminSistema(app.prisma, req.user.sub, req.params.sistemaId)
        await service.removerAdminSistema(req.params.sistemaId, req.params.usuarioId)
        return reply.status(204).send()
      } catch (e) {
        return tratarErro(e, reply)
      }
    }
  )

  // ── AdminModulo ───────────────────────────────────────────────

  app.get<{ Params: { moduloId: string } }>(
    '/modulos/:moduloId/admins',
    async (req, reply) => {
      try {
        await assertAdminModulo(app.prisma, req.user.sub, req.params.moduloId)
        const data = await service.listarAdminsModulo(req.params.moduloId)
        return { data }
      } catch (e) {
        return tratarErro(e, reply)
      }
    }
  )

  app.post<{ Params: { moduloId: string }; Body: { usuarioId: string } }>(
    '/modulos/:moduloId/admins',
    { schema: sAdicionarAdmin },
    async (req, reply) => {
      try {
        await assertAdminModulo(app.prisma, req.user.sub, req.params.moduloId)
        const data = await service.adicionarAdminModulo(req.params.moduloId, req.body.usuarioId)
        return reply.status(201).send({ data })
      } catch (e) {
        return tratarErro(e, reply)
      }
    }
  )

  app.delete<{ Params: { moduloId: string; usuarioId: string } }>(
    '/modulos/:moduloId/admins/:usuarioId',
    async (req, reply) => {
      try {
        await assertAdminModulo(app.prisma, req.user.sub, req.params.moduloId)
        await service.removerAdminModulo(req.params.moduloId, req.params.usuarioId)
        return reply.status(204).send()
      } catch (e) {
        return tratarErro(e, reply)
      }
    }
  )
}
