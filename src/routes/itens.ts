import type { FastifyInstance } from 'fastify'
import type { TipoItem, TipoFuncionalidade } from '@prisma/client'
import { ItensService } from '../services/itens.js'
import { erroHttp, tratarErro } from '../errors.js'
import { sCriarItem, sAtualizarItem } from '../schemas.js'

type CriarBody = {
  nome: string
  descricao?: string
  tipo: TipoItem
  tipoFuncionalidade?: TipoFuncionalidade
  rota?: string
  icone?: string
  ordem?: number
  parentId?: string
}

type AtualizarBody = {
  nome?: string
  descricao?: string
  tipoFuncionalidade?: TipoFuncionalidade
  rota?: string
  icone?: string
  ordem?: number
  ativo?: boolean
}

export async function itensRoutes(app: FastifyInstance) {
  const service = new ItensService(app.prisma)

  app.get<{ Params: { menuId: string } }>(
    '/menus/:menuId/itens',
    async (req, reply) => {
      try {
        const data = await service.listar(req.params.menuId)
        return { data }
      } catch (e) {
        return tratarErro(e, reply)
      }
    }
  )

  app.get<{ Params: { id: string } }>('/itens/:id', async (req, reply) => {
    const item = await service.buscarPorId(req.params.id)
    if (!item) return reply.status(404).send(erroHttp('RECURSO_NAO_ENCONTRADO', 'Item não encontrado.'))
    return { data: item }
  })

  app.post<{ Params: { menuId: string }; Body: CriarBody }>(
    '/menus/:menuId/itens',
    { schema: sCriarItem },
    async (req, reply) => {
      try {
        const item = await service.criar(req.params.menuId, req.body)
        return reply.status(201).send({ data: item })
      } catch (e) {
        return tratarErro(e, reply)
      }
    }
  )

  app.put<{ Params: { id: string }; Body: AtualizarBody }>(
    '/itens/:id',
    { schema: sAtualizarItem },
    async (req, reply) => {
      const item = await service.buscarPorId(req.params.id)
      if (!item) return reply.status(404).send(erroHttp('RECURSO_NAO_ENCONTRADO', 'Item não encontrado.'))
      try {
        const atualizado = await service.atualizar(req.params.id, req.body)
        return { data: atualizado }
      } catch (e) {
        return tratarErro(e, reply)
      }
    }
  )

  app.delete<{ Params: { id: string } }>('/itens/:id', async (req, reply) => {
    const item = await service.buscarPorId(req.params.id)
    if (!item) return reply.status(404).send(erroHttp('RECURSO_NAO_ENCONTRADO', 'Item não encontrado.'))
    try {
      await service.excluir(req.params.id)
      return reply.status(204).send()
    } catch (e) {
      return tratarErro(e, reply)
    }
  })
}
