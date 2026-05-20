import type { FastifyInstance } from 'fastify'
import { FavoritosService } from '../services/favoritos.js'
import { erroHttp, tratarErro } from '../errors.js'
import { sCriarPasta, sAtualizarPasta, sAdicionarFavorito, sMoverFavorito } from '../schemas.js'

export async function favoritosRoutes(app: FastifyInstance) {
  const service = new FavoritosService(app.prisma)

  // ── Pastas ────────────────────────────────────────────────────

  app.get<{ Params: { usuarioId: string } }>(
    '/usuarios/:usuarioId/pastas',
    async (req, reply) => {
      if (req.params.usuarioId !== req.user.sub) {
        return reply.status(403).send(erroHttp('NAO_AUTORIZADO', 'Você só pode acessar suas próprias pastas.'))
      }
      try {
        const data = await service.listarPastas(req.params.usuarioId)
        return { data }
      } catch (e) {
        return tratarErro(e, reply)
      }
    }
  )

  app.post<{ Params: { usuarioId: string }; Body: { nome: string; ordem?: number; parentId?: string } }>(
    '/usuarios/:usuarioId/pastas',
    { schema: sCriarPasta },
    async (req, reply) => {
      if (req.params.usuarioId !== req.user.sub) {
        return reply.status(403).send(erroHttp('NAO_AUTORIZADO', 'Você só pode criar pastas na sua própria conta.'))
      }
      try {
        const data = await service.criarPasta(req.params.usuarioId, req.body)
        return reply.status(201).send({ data })
      } catch (e) {
        return tratarErro(e, reply)
      }
    }
  )

  app.put<{ Params: { id: string }; Body: { nome?: string; ordem?: number } }>(
    '/pastas/:id',
    { schema: sAtualizarPasta },
    async (req, reply) => {
      const pasta = await service.buscarPastaPorId(req.params.id)
      if (!pasta) return reply.status(404).send(erroHttp('RECURSO_NAO_ENCONTRADO', 'Pasta não encontrada.'))
      if (pasta.usuarioId !== req.user.sub) {
        return reply.status(403).send(erroHttp('NAO_AUTORIZADO', 'Você só pode alterar suas próprias pastas.'))
      }
      try {
        const data = await service.atualizarPasta(req.params.id, req.body)
        return { data }
      } catch (e) {
        return tratarErro(e, reply)
      }
    }
  )

  app.delete<{ Params: { id: string } }>('/pastas/:id', async (req, reply) => {
    const pasta = await service.buscarPastaPorId(req.params.id)
    if (!pasta) return reply.status(404).send(erroHttp('RECURSO_NAO_ENCONTRADO', 'Pasta não encontrada.'))
    if (pasta.usuarioId !== req.user.sub) {
      return reply.status(403).send(erroHttp('NAO_AUTORIZADO', 'Você só pode excluir suas próprias pastas.'))
    }
    try {
      await service.excluirPasta(req.params.id)
      return reply.status(204).send()
    } catch (e) {
      return tratarErro(e, reply)
    }
  })

  // ── Favoritos ─────────────────────────────────────────────────

  app.get<{ Params: { usuarioId: string } }>(
    '/usuarios/:usuarioId/favoritos',
    async (req, reply) => {
      if (req.params.usuarioId !== req.user.sub) {
        return reply.status(403).send(erroHttp('NAO_AUTORIZADO', 'Você só pode acessar seus próprios favoritos.'))
      }
      try {
        const data = await service.listarFavoritos(req.params.usuarioId)
        return { data }
      } catch (e) {
        return tratarErro(e, reply)
      }
    }
  )

  app.post<{
    Params: { usuarioId: string }
    Body: { pastaId?: string; relatorioFixoId?: string; relatorioPersonalizadoId?: string; ordem?: number }
  }>(
    '/usuarios/:usuarioId/favoritos',
    { schema: sAdicionarFavorito },
    async (req, reply) => {
      if (req.params.usuarioId !== req.user.sub) {
        return reply.status(403).send(erroHttp('NAO_AUTORIZADO', 'Você só pode criar favoritos na sua própria conta.'))
      }
      try {
        const data = await service.adicionarFavorito(req.params.usuarioId, req.body)
        return reply.status(201).send({ data })
      } catch (e) {
        return tratarErro(e, reply)
      }
    }
  )

  app.put<{ Params: { id: string }; Body: { pastaId?: string | null; ordem?: number } }>(
    '/favoritos/:id',
    { schema: sMoverFavorito },
    async (req, reply) => {
      const favorito = await service.buscarFavoritoPorId(req.params.id)
      if (!favorito) return reply.status(404).send(erroHttp('RECURSO_NAO_ENCONTRADO', 'Favorito não encontrado.'))
      if (favorito.usuarioId !== req.user.sub) {
        return reply.status(403).send(erroHttp('NAO_AUTORIZADO', 'Você só pode alterar seus próprios favoritos.'))
      }
      try {
        const data = await service.moverFavorito(req.params.id, req.body)
        return { data }
      } catch (e) {
        return tratarErro(e, reply)
      }
    }
  )

  app.delete<{ Params: { id: string } }>('/favoritos/:id', async (req, reply) => {
    const favorito = await service.buscarFavoritoPorId(req.params.id)
    if (!favorito) return reply.status(404).send(erroHttp('RECURSO_NAO_ENCONTRADO', 'Favorito não encontrado.'))
    if (favorito.usuarioId !== req.user.sub) {
      return reply.status(403).send(erroHttp('NAO_AUTORIZADO', 'Você só pode excluir seus próprios favoritos.'))
    }
    try {
      await service.removerFavorito(req.params.id)
      return reply.status(204).send()
    } catch (e) {
      return tratarErro(e, reply)
    }
  })
}
