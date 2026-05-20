import type { FastifyInstance } from 'fastify'
import { MenusService } from '../services/menus.js'
import { erroHttp, tratarErro } from '../errors.js'
import { sCriarMenu, sAtualizarMenu } from '../schemas.js'
import { assertAdminModulo } from '../services/autorizacao.js'

export async function menusRoutes(app: FastifyInstance) {
  const service = new MenusService(app.prisma)

  app.get<{ Params: { moduloId: string } }>(
    '/modulos/:moduloId/menus',
    async (req, reply) => {
      try {
        const data = await service.listar(req.params.moduloId)
        return { data }
      } catch (e) {
        return tratarErro(e, reply)
      }
    }
  )

  app.get<{ Params: { id: string } }>('/menus/:id', async (req, reply) => {
    const menu = await service.buscarPorId(req.params.id)
    if (!menu) return reply.status(404).send(erroHttp('RECURSO_NAO_ENCONTRADO', 'Menu não encontrado.'))
    return { data: menu }
  })

  app.post<{ Params: { moduloId: string }; Body: { nome: string; icone?: string; ordem?: number } }>(
    '/modulos/:moduloId/menus',
    { schema: sCriarMenu },
    async (req, reply) => {
      try {
        await assertAdminModulo(app.prisma, req.user.sub, req.params.moduloId)
        const menu = await service.criar(req.params.moduloId, req.body)
        return reply.status(201).send({ data: menu })
      } catch (e) {
        return tratarErro(e, reply)
      }
    }
  )

  app.put<{ Params: { id: string }; Body: { nome?: string; icone?: string; ordem?: number; ativo?: boolean } }>(
    '/menus/:id',
    { schema: sAtualizarMenu },
    async (req, reply) => {
      const menu = await service.buscarPorId(req.params.id)
      if (!menu) return reply.status(404).send(erroHttp('RECURSO_NAO_ENCONTRADO', 'Menu não encontrado.'))
      try {
        await assertAdminModulo(app.prisma, req.user.sub, menu.moduloId)
        const atualizado = await service.atualizar(req.params.id, req.body)
        return { data: atualizado }
      } catch (e) {
        return tratarErro(e, reply)
      }
    }
  )

  app.delete<{ Params: { id: string } }>('/menus/:id', async (req, reply) => {
    const menu = await service.buscarPorId(req.params.id)
    if (!menu) return reply.status(404).send(erroHttp('RECURSO_NAO_ENCONTRADO', 'Menu não encontrado.'))
    try {
      await service.excluir(req.params.id, req.user.sub)
      return reply.status(204).send()
    } catch (e) {
      return tratarErro(e, reply)
    }
  })
}
