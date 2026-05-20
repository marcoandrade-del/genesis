import type { FastifyInstance } from 'fastify'
import type { NivelAcesso } from '@prisma/client'
import { PermissoesService } from '../services/permissoes.js'
import { ErroNegocio, erroHttp, tratarErro } from '../errors.js'
import { sConcederPermissao, sAtualizarPermissao } from '../schemas.js'
import { assertAdminItem } from '../services/autorizacao.js'

export async function permissoesRoutes(app: FastifyInstance) {
  const service = new PermissoesService(app.prisma)

  app.get<{ Params: { usuarioId: string } }>(
    '/usuarios/:usuarioId/permissoes',
    async (req, reply) => {
      // Listar permissões do próprio usuário — sem-admin só vê as próprias.
      if (req.params.usuarioId !== req.user.sub) {
        return tratarErro(new ErroNegocio('NAO_AUTORIZADO', 'Só é possível consultar as próprias permissões.'), reply)
      }
      try {
        const data = await service.listarPorUsuario(req.params.usuarioId)
        return { data }
      } catch (e) {
        return tratarErro(e, reply)
      }
    }
  )

  app.get<{ Params: { itemId: string } }>(
    '/itens/:itemId/permissoes',
    async (req, reply) => {
      try {
        await assertAdminItem(app.prisma, req.user.sub, req.params.itemId)
        const data = await service.listarPorItem(req.params.itemId)
        return { data }
      } catch (e) {
        return tratarErro(e, reply)
      }
    }
  )

  app.post<{ Params: { usuarioId: string }; Body: { itemId: string; nivel: NivelAcesso } }>(
    '/usuarios/:usuarioId/permissoes',
    { schema: sConcederPermissao },
    async (req, reply) => {
      try {
        await assertAdminItem(app.prisma, req.user.sub, req.body.itemId)
        const data = await service.conceder(req.params.usuarioId, req.body)
        return reply.status(201).send({ data })
      } catch (e) {
        return tratarErro(e, reply)
      }
    }
  )

  app.put<{ Params: { id: string }; Body: { nivel: NivelAcesso } }>(
    '/permissoes/:id',
    { schema: sAtualizarPermissao },
    async (req, reply) => {
      const permissao = await service.buscarPorId(req.params.id)
      if (!permissao) return reply.status(404).send(erroHttp('RECURSO_NAO_ENCONTRADO', 'Permissão não encontrada.'))
      try {
        await assertAdminItem(app.prisma, req.user.sub, permissao.itemId)
        const data = await service.atualizar(req.params.id, req.body.nivel)
        return { data }
      } catch (e) {
        return tratarErro(e, reply)
      }
    }
  )

  app.delete<{ Params: { id: string } }>('/permissoes/:id', async (req, reply) => {
    const permissao = await service.buscarPorId(req.params.id)
    if (!permissao) return reply.status(404).send(erroHttp('RECURSO_NAO_ENCONTRADO', 'Permissão não encontrada.'))
    try {
      await assertAdminItem(app.prisma, req.user.sub, permissao.itemId)
      await service.revogar(req.params.id)
      return reply.status(204).send()
    } catch (e) {
      return tratarErro(e, reply)
    }
  })
}
