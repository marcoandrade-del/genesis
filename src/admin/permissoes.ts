import type { FastifyInstance } from 'fastify'
import { NivelAcesso } from '@prisma/client'
import { PermissoesService } from '../services/permissoes.js'
import { ErroNegocio } from '../errors.js'

export async function adminPermissoesRoutes(app: FastifyInstance) {
  const svc = new PermissoesService(app.prisma)

  // ── Página principal ─────────────────────────────────────────────────────────
  app.get<{ Querystring: { busca?: string } }>('/', async (req, reply) => {
    const { busca = '' } = req.query
    const where = busca
      ? {
          OR: [
            { nomeCompleto: { contains: busca, mode: 'insensitive' as const } },
            { emailPrincipal: { contains: busca, mode: 'insensitive' as const } },
          ],
        }
      : {}

    const [usuarios, total] = await Promise.all([
      app.prisma.usuario.findMany({
        where,
        orderBy: { nomeCompleto: 'asc' },
        take: 100,
        include: { _count: { select: { permissoes: true } } },
      }),
      app.prisma.usuario.count({ where }),
    ])

    return reply.view(
      'permissoes/index',
      { title: 'Permissões — Gênesis Admin', active: 'permissoes', userEmail: req.user.email, usuarios, total, busca },
      { layout: 'layouts/main' },
    )
  })

  // ── Modal: permissões de um usuário ──────────────────────────────────────────
  app.get<{ Params: { usuarioId: string } }>('/:usuarioId/modal', async (req, reply) => {
    const usuario = await app.prisma.usuario.findUnique({
      where: { id: req.params.usuarioId },
      select: { id: true, nomeCompleto: true, emailPrincipal: true },
    })
    if (!usuario) return reply.status(404).send('Usuário não encontrado.')
    const permissoes = await svc.listarPorUsuario(req.params.usuarioId)
    return reply.view('permissoes/modal-usuario', { usuario, permissoes })
  })

  // ── Parcial HTMX: só as linhas (refresh após add/revogar/atualizar) ──────────
  app.get<{ Params: { usuarioId: string } }>('/:usuarioId/linhas', async (req, reply) => {
    const permissoes = await svc.listarPorUsuario(req.params.usuarioId)
    return reply.view('permissoes/linhas-permissoes', { permissoes, usuarioId: req.params.usuarioId })
  })

  // ── Formulário: adicionar permissão ──────────────────────────────────────────
  app.get<{ Params: { usuarioId: string } }>('/:usuarioId/form', async (req, reply) => {
    const usuario = await app.prisma.usuario.findUnique({
      where: { id: req.params.usuarioId },
      select: { id: true, nomeCompleto: true, emailPrincipal: true },
    })
    if (!usuario) return reply.status(404).send('Usuário não encontrado.')
    return reply.view('permissoes/form-adicionar', { usuario, erro: null })
  })

  // ── Conceder permissão ────────────────────────────────────────────────────────
  app.post<{ Params: { usuarioId: string }; Body: { itemId: string; nivel: string } }>(
    '/:usuarioId',
    async (req, reply) => {
      const { itemId, nivel } = req.body
      const usuario = await app.prisma.usuario.findUnique({
        where: { id: req.params.usuarioId },
        select: { id: true, nomeCompleto: true, emailPrincipal: true },
      })
      if (!usuario) return reply.status(404).send('Usuário não encontrado.')
      if (!itemId) return reply.view('permissoes/form-adicionar', { usuario, erro: 'Selecione um item.' })
      if (!nivel) return reply.view('permissoes/form-adicionar', { usuario, erro: 'Selecione um nível de acesso.' })
      try {
        await svc.conceder(req.params.usuarioId, { itemId, nivel: nivel as NivelAcesso })
        const permissoes = await svc.listarPorUsuario(req.params.usuarioId)
        return reply.view('permissoes/modal-usuario', { usuario, permissoes })
      } catch (e: unknown) {
        const msg = e instanceof ErroNegocio ? e.message : 'Erro ao conceder permissão.'
        return reply.view('permissoes/form-adicionar', { usuario, erro: msg })
      }
    },
  )

  // ── Atualizar nível (inline) ──────────────────────────────────────────────────
  app.put<{ Params: { id: string }; Body: { nivel: string; usuarioId: string } }>(
    '/perm/:id',
    async (req, reply) => {
      const { nivel, usuarioId } = req.body
      try {
        await svc.atualizar(req.params.id, nivel as NivelAcesso)
        const permissoes = await svc.listarPorUsuario(usuarioId)
        return reply.view('permissoes/linhas-permissoes', { permissoes, usuarioId })
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Erro ao atualizar permissão.'
        return reply.status(400).send(msg)
      }
    },
  )

  // ── Revogar permissão ─────────────────────────────────────────────────────────
  app.delete<{ Params: { id: string }; Querystring: { usuarioId: string } }>(
    '/perm/:id',
    async (req, reply) => {
      const { usuarioId } = req.query
      try {
        await svc.revogar(req.params.id)
        const permissoes = await svc.listarPorUsuario(usuarioId)
        return reply.view('permissoes/linhas-permissoes', { permissoes, usuarioId })
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Erro ao revogar permissão.'
        return reply.status(400).send(msg)
      }
    },
  )
}
