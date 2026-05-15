import type { FastifyInstance } from 'fastify'
import { SistemasService } from '../services/sistemas.js'
import { erroHttp, tratarErro } from '../errors.js'
import { sCriarSistema, sAtualizarSistema } from '../schemas.js'

export async function sistemasRoutes(app: FastifyInstance) {
  const service = new SistemasService(app.prisma)

  app.get('/sistemas', async () => {
    const data = await service.listar()
    return { data }
  })

  app.get<{ Params: { id: string } }>('/sistemas/:id', async (req, reply) => {
    const sistema = await service.buscarPorId(req.params.id)
    if (!sistema) return reply.status(404).send(erroHttp('RECURSO_NAO_ENCONTRADO', 'Sistema não encontrado.'))
    return { data: sistema }
  })

  app.post<{ Body: { nome: string; descricao?: string; adminUsuarioId: string } }>(
    '/sistemas',
    { schema: sCriarSistema },
    async (req, reply) => {
      try {
        const sistema = await service.criar(req.body)
        return reply.status(201).send({ data: sistema })
      } catch (e) {
        return tratarErro(e, reply)
      }
    }
  )

  app.put<{ Params: { id: string }; Body: { nome?: string; descricao?: string; ativo?: boolean } }>(
    '/sistemas/:id',
    { schema: sAtualizarSistema },
    async (req, reply) => {
      const sistema = await service.buscarPorId(req.params.id)
      if (!sistema) return reply.status(404).send(erroHttp('RECURSO_NAO_ENCONTRADO', 'Sistema não encontrado.'))
      try {
        const atualizado = await service.atualizar(req.params.id, req.body)
        return { data: atualizado }
      } catch (e) {
        return tratarErro(e, reply)
      }
    }
  )

  app.delete<{ Params: { id: string } }>('/sistemas/:id', async (req, reply) => {
    const sistema = await service.buscarPorId(req.params.id)
    if (!sistema) return reply.status(404).send(erroHttp('RECURSO_NAO_ENCONTRADO', 'Sistema não encontrado.'))
    try {
      await service.excluir(req.params.id, req.user.sub)
      return reply.status(204).send()
    } catch (e) {
      return tratarErro(e, reply)
    }
  })
}
