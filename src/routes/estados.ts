import type { FastifyInstance } from 'fastify'
import { EstadosService } from '../services/estados.js'
import { erroHttp, tratarErro } from '../errors.js'
import { sAtualizarEstado } from '../schemas.js'

export async function estadosRoutes(app: FastifyInstance) {
  const service = new EstadosService(app.prisma)

  app.get('/estados', async () => {
    const data = await service.listar()
    return { data }
  })

  app.get<{ Params: { id: string } }>('/estados/:id', async (req, reply) => {
    const estado = await service.buscarPorId(req.params.id)
    if (!estado) return reply.status(404).send(erroHttp('RECURSO_NAO_ENCONTRADO', 'Estado não encontrado.'))
    return { data: estado }
  })

  /**
   * PUT define/limpa o modelo contábil do estado e propaga aos municípios.
   * Não há POST/DELETE: os 27 UFs vêm do seed e não devem ser criados/excluídos pela API.
   */
  app.put<{ Params: { id: string }; Body: { modeloContabilId?: string | null } }>(
    '/estados/:id',
    { schema: sAtualizarEstado },
    async (req, reply) => {
      try {
        const modeloId = req.body.modeloContabilId ?? null
        const r = await service.definirModelo(req.params.id, modeloId)
        return { data: r }
      } catch (e) {
        return tratarErro(e, reply)
      }
    },
  )
}
