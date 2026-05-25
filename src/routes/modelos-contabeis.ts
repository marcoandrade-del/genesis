import type { FastifyInstance } from 'fastify'
import { ModelosContabeisService } from '../services/modelos-contabeis.js'
import { erroHttp, tratarErro } from '../errors.js'
import { sCriarModeloContabil, sAtualizarModeloContabil } from '../schemas.js'

export async function modelosContabeisRoutes(app: FastifyInstance) {
  const service = new ModelosContabeisService(app.prisma)

  app.get('/modelos-contabeis', async () => {
    const data = await service.listar()
    return { data }
  })

  app.get<{ Params: { id: string } }>('/modelos-contabeis/:id', async (req, reply) => {
    const modelo = await service.buscarPorId(req.params.id)
    if (!modelo) return reply.status(404).send(erroHttp('RECURSO_NAO_ENCONTRADO', 'Modelo contábil não encontrado.'))
    return { data: modelo }
  })

  app.post<{ Body: { descricao: string; ativo?: boolean } }>(
    '/modelos-contabeis',
    { schema: sCriarModeloContabil },
    async (req, reply) => {
      try {
        const modelo = await service.criar(req.body)
        return reply.status(201).send({ data: modelo })
      } catch (e) {
        return tratarErro(e, reply)
      }
    },
  )

  app.put<{ Params: { id: string }; Body: { descricao?: string; ativo?: boolean } }>(
    '/modelos-contabeis/:id',
    { schema: sAtualizarModeloContabil },
    async (req, reply) => {
      const modelo = await service.buscarPorId(req.params.id)
      if (!modelo) return reply.status(404).send(erroHttp('RECURSO_NAO_ENCONTRADO', 'Modelo contábil não encontrado.'))
      try {
        const atualizado = await service.atualizar(req.params.id, req.body)
        return { data: atualizado }
      } catch (e) {
        return tratarErro(e, reply)
      }
    },
  )

  app.delete<{ Params: { id: string } }>('/modelos-contabeis/:id', async (req, reply) => {
    try {
      await service.excluir(req.params.id)
      return reply.status(204).send()
    } catch (e) {
      return tratarErro(e, reply)
    }
  })
}
