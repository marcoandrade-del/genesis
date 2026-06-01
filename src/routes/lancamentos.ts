import type { FastifyInstance } from 'fastify'
import { LancamentosService, type ItemDado } from '../services/lancamentos.js'
import { erroHttp, tratarErro } from '../errors.js'
import { sCriarLancamento } from '../schemas.js'

export async function lancamentosRoutes(app: FastifyInstance) {
  const service = new LancamentosService(app.prisma)

  app.get<{
    Params: { entidadeId: string }
    Querystring: { dataInicio?: string; dataFim?: string }
  }>('/entidades/:entidadeId/lancamentos', async (req) => {
    const data = await service.listar(req.params.entidadeId, req.query)
    return { data }
  })

  app.get<{ Params: { id: string } }>('/lancamentos/:id', async (req, reply) => {
    const lanc = await service.buscarPorId(req.params.id)
    if (!lanc) return reply.status(404).send(erroHttp('RECURSO_NAO_ENCONTRADO', 'Lançamento não encontrado.'))
    return { data: lanc }
  })

  app.post<{
    Params: { entidadeId: string }
    Body: { data: string; historico: string; itens: ItemDado[] }
  }>(
    '/entidades/:entidadeId/lancamentos',
    { schema: sCriarLancamento },
    async (req, reply) => {
      try {
        const lanc = await service.criar({
          entidadeId: req.params.entidadeId,
          ...req.body,
          criadoPorId: req.user.sub,
        })
        return reply.status(201).send({ data: lanc })
      } catch (e) {
        return tratarErro(e, reply)
      }
    },
  )

  app.delete<{ Params: { id: string } }>('/lancamentos/:id', async (req, reply) => {
    try {
      await service.excluir(req.params.id)
      return reply.status(204).send()
    } catch (e) {
      return tratarErro(e, reply)
    }
  })
}
