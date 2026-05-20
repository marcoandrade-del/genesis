import type { FastifyInstance } from 'fastify'
import { RelatoriosService } from '../services/relatorios.js'
import { erroHttp, tratarErro } from '../errors.js'
import {
  sCriarRelatorioFixo,
  sAtualizarRelatorioFixo,
  sCriarRelatorioPersonalizado,
  sAtualizarRelatorioPersonalizado,
} from '../schemas.js'
import { assertAdminSistema } from '../services/autorizacao.js'

export async function relatoriosRoutes(app: FastifyInstance) {
  const service = new RelatoriosService(app.prisma)

  // ── Relatórios Fixos ──────────────────────────────────────────

  app.get<{ Params: { sistemaId: string } }>(
    '/sistemas/:sistemaId/relatorios',
    async (req, reply) => {
      try {
        const data = await service.listarFixos(req.params.sistemaId)
        return { data }
      } catch (e) {
        return tratarErro(e, reply)
      }
    }
  )

  app.post<{ Params: { sistemaId: string }; Body: { nome: string; descricao?: string; rota: string } }>(
    '/sistemas/:sistemaId/relatorios',
    { schema: sCriarRelatorioFixo },
    async (req, reply) => {
      try {
        await assertAdminSistema(app.prisma, req.user.sub, req.params.sistemaId)
        const data = await service.criarFixo(req.params.sistemaId, req.body)
        return reply.status(201).send({ data })
      } catch (e) {
        return tratarErro(e, reply)
      }
    }
  )

  app.put<{ Params: { id: string }; Body: { nome?: string; descricao?: string; rota?: string; ativo?: boolean } }>(
    '/relatorios/:id',
    { schema: sAtualizarRelatorioFixo },
    async (req, reply) => {
      const relatorio = await service.buscarFixoPorId(req.params.id)
      if (!relatorio) return reply.status(404).send(erroHttp('RECURSO_NAO_ENCONTRADO', 'Relatório não encontrado.'))
      try {
        await assertAdminSistema(app.prisma, req.user.sub, relatorio.sistemaId)
        const data = await service.atualizarFixo(req.params.id, req.body)
        return { data }
      } catch (e) {
        return tratarErro(e, reply)
      }
    }
  )

  app.delete<{ Params: { id: string } }>('/relatorios/:id', async (req, reply) => {
    const relatorio = await service.buscarFixoPorId(req.params.id)
    if (!relatorio) return reply.status(404).send(erroHttp('RECURSO_NAO_ENCONTRADO', 'Relatório não encontrado.'))
    try {
      await assertAdminSistema(app.prisma, req.user.sub, relatorio.sistemaId)
      await service.excluirFixo(req.params.id)
      return reply.status(204).send()
    } catch (e) {
      return tratarErro(e, reply)
    }
  })

  // ── Relatórios Personalizados ─────────────────────────────────

  app.get<{ Params: { usuarioId: string } }>(
    '/usuarios/:usuarioId/relatorios-personalizados',
    async (req, reply) => {
      if (req.params.usuarioId !== req.user.sub) {
        return reply.status(403).send(erroHttp('NAO_AUTORIZADO', 'Você só pode acessar seus próprios relatórios personalizados.'))
      }
      try {
        const data = await service.listarPersonalizados(req.params.usuarioId)
        return { data }
      } catch (e) {
        return tratarErro(e, reply)
      }
    }
  )

  app.post<{ Params: { usuarioId: string }; Body: { nome: string; descricao?: string; configuracao: object } }>(
    '/usuarios/:usuarioId/relatorios-personalizados',
    { schema: sCriarRelatorioPersonalizado },
    async (req, reply) => {
      if (req.params.usuarioId !== req.user.sub) {
        return reply.status(403).send(erroHttp('NAO_AUTORIZADO', 'Você só pode criar relatórios personalizados na sua própria conta.'))
      }
      try {
        const data = await service.criarPersonalizado(req.params.usuarioId, req.body)
        return reply.status(201).send({ data })
      } catch (e) {
        return tratarErro(e, reply)
      }
    }
  )

  app.put<{ Params: { id: string }; Body: { nome?: string; descricao?: string; configuracao?: object; ativo?: boolean } }>(
    '/relatorios-personalizados/:id',
    { schema: sAtualizarRelatorioPersonalizado },
    async (req, reply) => {
      const relatorio = await service.buscarPersonalizadoPorId(req.params.id)
      if (!relatorio) return reply.status(404).send(erroHttp('RECURSO_NAO_ENCONTRADO', 'Relatório não encontrado.'))
      if (relatorio.usuarioId !== req.user.sub) {
        return reply.status(403).send(erroHttp('NAO_AUTORIZADO', 'Você só pode alterar seus próprios relatórios personalizados.'))
      }
      try {
        const data = await service.atualizarPersonalizado(req.params.id, req.body)
        return { data }
      } catch (e) {
        return tratarErro(e, reply)
      }
    }
  )

  app.delete<{ Params: { id: string } }>('/relatorios-personalizados/:id', async (req, reply) => {
    const relatorio = await service.buscarPersonalizadoPorId(req.params.id)
    if (!relatorio) return reply.status(404).send(erroHttp('RECURSO_NAO_ENCONTRADO', 'Relatório não encontrado.'))
    if (relatorio.usuarioId !== req.user.sub) {
      return reply.status(403).send(erroHttp('NAO_AUTORIZADO', 'Você só pode excluir seus próprios relatórios personalizados.'))
    }
    try {
      await service.excluirPersonalizado(req.params.id)
      return reply.status(204).send()
    } catch (e) {
      return tratarErro(e, reply)
    }
  })
}
