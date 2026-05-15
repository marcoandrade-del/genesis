import type { FastifyInstance } from 'fastify'
import { ModulosService } from '../services/modulos.js'
import { erroHttp, tratarErro } from '../errors.js'
import { sCriarModulo, sAtualizarModulo } from '../schemas.js'

export async function modulosRoutes(app: FastifyInstance) {
  const service = new ModulosService(app.prisma)

  app.get<{ Params: { sistemaId: string } }>(
    '/sistemas/:sistemaId/modulos',
    async (req, reply) => {
      try {
        const data = await service.listar(req.params.sistemaId)
        return { data }
      } catch (e) {
        return tratarErro(e, reply)
      }
    }
  )

  app.get<{ Params: { id: string } }>('/modulos/:id', async (req, reply) => {
    const modulo = await service.buscarPorId(req.params.id)
    if (!modulo) return reply.status(404).send(erroHttp('RECURSO_NAO_ENCONTRADO', 'Módulo não encontrado.'))
    return { data: modulo }
  })

  app.post<{ Params: { sistemaId: string }; Body: { nome: string; descricao?: string; adminUsuarioId: string } }>(
    '/sistemas/:sistemaId/modulos',
    { schema: sCriarModulo },
    async (req, reply) => {
      try {
        const modulo = await service.criar(req.params.sistemaId, req.body)
        return reply.status(201).send({ data: modulo })
      } catch (e) {
        return tratarErro(e, reply)
      }
    }
  )

  app.put<{ Params: { id: string }; Body: { nome?: string; descricao?: string; ativo?: boolean } }>(
    '/modulos/:id',
    { schema: sAtualizarModulo },
    async (req, reply) => {
      const modulo = await service.buscarPorId(req.params.id)
      if (!modulo) return reply.status(404).send(erroHttp('RECURSO_NAO_ENCONTRADO', 'Módulo não encontrado.'))
      try {
        const atualizado = await service.atualizar(req.params.id, req.body)
        return { data: atualizado }
      } catch (e) {
        return tratarErro(e, reply)
      }
    }
  )

  app.delete<{ Params: { id: string } }>('/modulos/:id', async (req, reply) => {
    const modulo = await service.buscarPorId(req.params.id)
    if (!modulo) return reply.status(404).send(erroHttp('RECURSO_NAO_ENCONTRADO', 'Módulo não encontrado.'))
    try {
      await service.excluir(req.params.id, req.user.sub)
      return reply.status(204).send()
    } catch (e) {
      return tratarErro(e, reply)
    }
  })
}
