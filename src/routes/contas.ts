import type { FastifyInstance } from 'fastify'
import { ContasService } from '../services/contas.js'
import { erroHttp, tratarErro } from '../errors.js'
import { sCriarConta, sAtualizarConta } from '../schemas.js'

export async function contasRoutes(app: FastifyInstance) {
  const service = new ContasService(app.prisma)

  app.get<{ Params: { planoId: string } }>(
    '/planos-de-contas/:planoId/contas',
    async (req) => {
      const data = await service.listar(req.params.planoId)
      return { data }
    },
  )

  app.get<{ Params: { id: string } }>('/contas/:id', async (req, reply) => {
    const c = await service.buscarPorId(req.params.id)
    if (!c) return reply.status(404).send(erroHttp('RECURSO_NAO_ENCONTRADO', 'Conta não encontrada.'))
    return { data: c }
  })

  app.post<{
    Params: { planoId: string }
    Body: { codigo: string; descricao: string; parentId?: string }
  }>(
    '/planos-de-contas/:planoId/contas',
    { schema: sCriarConta },
    async (req, reply) => {
      try {
        const c = await service.criar({ planoId: req.params.planoId, ...req.body })
        return reply.status(201).send({ data: c })
      } catch (e) {
        return tratarErro(e, reply)
      }
    },
  )

  app.put<{ Params: { id: string }; Body: { codigo?: string; descricao?: string; admiteMovimento?: boolean } }>(
    '/contas/:id',
    { schema: sAtualizarConta },
    async (req, reply) => {
      try {
        const c = await service.atualizar(req.params.id, req.body)
        return { data: c }
      } catch (e) {
        return tratarErro(e, reply)
      }
    },
  )

  app.delete<{ Params: { id: string } }>('/contas/:id', async (req, reply) => {
    try {
      await service.excluir(req.params.id)
      return reply.status(204).send()
    } catch (e) {
      return tratarErro(e, reply)
    }
  })
}
