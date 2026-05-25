import type { FastifyInstance } from 'fastify'
import { MunicipiosService } from '../services/municipios.js'
import { erroHttp, tratarErro } from '../errors.js'
import { sCriarMunicipio, sAtualizarMunicipio } from '../schemas.js'

export async function municipiosRoutes(app: FastifyInstance) {
  const service = new MunicipiosService(app.prisma)

  // Lista geral, opcionalmente filtrada por estadoId via querystring.
  app.get<{ Querystring: { estadoId?: string } }>('/municipios', async (req) => {
    const data = await service.listar(req.query.estadoId)
    return { data }
  })

  app.get<{ Params: { id: string } }>('/municipios/:id', async (req, reply) => {
    const m = await service.buscarComModeloEfetivo(req.params.id)
    if (!m) return reply.status(404).send(erroHttp('RECURSO_NAO_ENCONTRADO', 'Município não encontrado.'))
    return { data: m }
  })

  app.post<{ Body: { nome: string; estadoId: string; modeloContabilId?: string } }>(
    '/municipios',
    { schema: sCriarMunicipio },
    async (req, reply) => {
      try {
        const m = await service.criar(req.body)
        return reply.status(201).send({ data: m })
      } catch (e) {
        return tratarErro(e, reply)
      }
    },
  )

  app.put<{ Params: { id: string }; Body: { nome?: string; modeloContabilId?: string | null } }>(
    '/municipios/:id',
    { schema: sAtualizarMunicipio },
    async (req, reply) => {
      const m = await service.buscarPorId(req.params.id)
      if (!m) return reply.status(404).send(erroHttp('RECURSO_NAO_ENCONTRADO', 'Município não encontrado.'))
      try {
        const atualizado = await service.atualizar(req.params.id, req.body)
        return { data: atualizado }
      } catch (e) {
        return tratarErro(e, reply)
      }
    },
  )

  app.delete<{ Params: { id: string } }>('/municipios/:id', async (req, reply) => {
    try {
      await service.excluir(req.params.id)
      return reply.status(204).send()
    } catch (e) {
      return tratarErro(e, reply)
    }
  })
}
