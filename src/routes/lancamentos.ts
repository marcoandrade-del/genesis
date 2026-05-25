import type { FastifyInstance } from 'fastify'
import { LancamentosService, type ItemDado } from '../services/lancamentos.js'
import { erroHttp, tratarErro } from '../errors.js'
import { sCriarLancamento } from '../schemas.js'

export async function lancamentosRoutes(app: FastifyInstance) {
  const service = new LancamentosService(app.prisma)

  app.get<{
    Params: { municipioId: string }
    Querystring: { dataInicio?: string; dataFim?: string }
  }>('/municipios/:municipioId/lancamentos', async (req) => {
    const data = await service.listar(req.params.municipioId, req.query)
    return { data }
  })

  app.get<{ Params: { id: string } }>('/lancamentos/:id', async (req, reply) => {
    const lanc = await service.buscarPorId(req.params.id)
    if (!lanc) return reply.status(404).send(erroHttp('RECURSO_NAO_ENCONTRADO', 'Lançamento não encontrado.'))
    return { data: lanc }
  })

  app.post<{
    Params: { municipioId: string }
    Body: { data: string; historico: string; itens: ItemDado[] }
  }>(
    '/municipios/:municipioId/lancamentos',
    { schema: sCriarLancamento },
    async (req, reply) => {
      try {
        const lanc = await service.criar({
          municipioId: req.params.municipioId,
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
