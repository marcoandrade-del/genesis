import type { FastifyInstance } from 'fastify'
import { PlanosDeContasService } from '../services/planos-de-contas.js'
import { ImportadorPlanoContasService } from '../services/importador-plano-contas.js'
import { erroHttp, tratarErro } from '../errors.js'
import {
  sCriarPlanoDeContas,
  sAtualizarPlanoDeContas,
  sImportarPlanoDeContas,
} from '../schemas.js'

// PCASP Estendido oficial ocupa ~640 KB; folga de ~8× para crescimento.
const LIMITE_CSV_IMPORTACAO = 5 * 1024 * 1024

export async function planosDeContasRoutes(app: FastifyInstance) {
  const service = new PlanosDeContasService(app.prisma)
  const importador = new ImportadorPlanoContasService(app.prisma)

  app.get<{ Querystring: { modeloContabilId?: string } }>('/planos-de-contas', async (req) => {
    const data = await service.listar(req.query.modeloContabilId)
    return { data }
  })

  app.get<{ Params: { id: string } }>('/planos-de-contas/:id', async (req, reply) => {
    const p = await service.buscarPorId(req.params.id)
    if (!p) return reply.status(404).send(erroHttp('RECURSO_NAO_ENCONTRADO', 'Plano de contas não encontrado.'))
    return { data: p }
  })

  app.post<{ Body: { descricao: string; ano: number; modeloContabilId: string } }>(
    '/planos-de-contas',
    { schema: sCriarPlanoDeContas },
    async (req, reply) => {
      try {
        const p = await service.criar(req.body)
        return reply.status(201).send({ data: p })
      } catch (e) {
        return tratarErro(e, reply)
      }
    },
  )

  app.put<{ Params: { id: string }; Body: { descricao?: string; ano?: number } }>(
    '/planos-de-contas/:id',
    { schema: sAtualizarPlanoDeContas },
    async (req, reply) => {
      const p = await service.buscarPorId(req.params.id)
      if (!p) return reply.status(404).send(erroHttp('RECURSO_NAO_ENCONTRADO', 'Plano de contas não encontrado.'))
      try {
        const atualizado = await service.atualizar(req.params.id, req.body)
        return { data: atualizado }
      } catch (e) {
        return tratarErro(e, reply)
      }
    },
  )

  app.delete<{ Params: { id: string } }>('/planos-de-contas/:id', async (req, reply) => {
    try {
      await service.excluir(req.params.id)
      return reply.status(204).send()
    } catch (e) {
      return tratarErro(e, reply)
    }
  })

  app.post<{ Params: { id: string }; Body: { csv: string } }>(
    '/planos-de-contas/:id/importar',
    { schema: sImportarPlanoDeContas, bodyLimit: LIMITE_CSV_IMPORTACAO },
    async (req, reply) => {
      try {
        const resultado = await importador.importar(req.params.id, req.body.csv)
        return reply.status(201).send({ data: resultado })
      } catch (e) {
        return tratarErro(e, reply)
      }
    },
  )
}
