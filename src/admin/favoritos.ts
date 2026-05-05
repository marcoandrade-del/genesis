import type { FastifyInstance } from 'fastify'
import { FavoritosService } from '../services/favoritos.js'

type PastaPlana = { id: string; label: string }

function aplanarPastas(pastas: any[], prefixo = ''): PastaPlana[] {
  const resultado: PastaPlana[] = []
  for (const p of pastas) {
    resultado.push({ id: p.id, label: prefixo + p.nome })
    if (p.subPastas?.length) {
      resultado.push(...aplanarPastas(p.subPastas, prefixo + p.nome + ' / '))
    }
  }
  return resultado
}

async function carregarArvore(app: FastifyInstance, usuarioId: string) {
  const relFav = {
    relatorioFixo: { select: { nome: true } },
    relatorioPersonalizado: { select: { nome: true } },
  }
  const [pastas, favoritosRaiz] = await Promise.all([
    app.prisma.pastaFavorito.findMany({
      where: { usuarioId, parentId: null },
      orderBy: [{ ordem: 'asc' }, { nome: 'asc' }],
      include: {
        favoritos: { include: relFav, orderBy: { ordem: 'asc' } },
        subPastas: {
          orderBy: [{ ordem: 'asc' }, { nome: 'asc' }],
          include: { favoritos: { include: relFav, orderBy: { ordem: 'asc' } } },
        },
      },
    }),
    app.prisma.favoritoRelatorio.findMany({
      where: { usuarioId, pastaId: null },
      include: relFav,
      orderBy: { ordem: 'asc' },
    }),
  ])
  return { pastas, favoritosRaiz, pastasPlanas: aplanarPastas(pastas) }
}

async function getUsuario(app: FastifyInstance, usuarioId: string) {
  return app.prisma.usuario.findUnique({
    where: { id: usuarioId },
    select: { id: true, nomeCompleto: true, emailPrincipal: true },
  })
}

export async function adminFavoritosRoutes(app: FastifyInstance) {
  const svc = new FavoritosService(app.prisma)

  // ── Lista de usuários ─────────────────────────────────────────
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
        include: { _count: { select: { pastas: true, favoritos: true } } },
      }),
      app.prisma.usuario.count({ where }),
    ])

    return reply.view(
      'favoritos/index',
      { title: 'Favoritos — Gênesis Admin', active: 'favoritos', userEmail: req.user.email, usuarios, total, busca },
      { layout: 'layouts/main' },
    )
  })

  // ── Modal: árvore de favoritos ────────────────────────────────
  app.get<{ Params: { usuarioId: string } }>('/:usuarioId/modal', async (req, reply) => {
    const usuario = await getUsuario(app, req.params.usuarioId)
    if (!usuario) return reply.status(404).send('Usuário não encontrado.')
    const { pastas, favoritosRaiz, pastasPlanas } = await carregarArvore(app, req.params.usuarioId)
    return reply.view('favoritos/modal-usuario', { usuario, pastas, favoritosRaiz, pastasPlanas })
  })

  // ── Form: nova pasta ──────────────────────────────────────────
  app.get<{ Params: { usuarioId: string } }>('/:usuarioId/form-pasta', async (req, reply) => {
    const usuario = await getUsuario(app, req.params.usuarioId)
    if (!usuario) return reply.status(404).send('Usuário não encontrado.')
    const todasPastas = await app.prisma.pastaFavorito.findMany({
      where: { usuarioId: req.params.usuarioId },
      orderBy: { nome: 'asc' },
      select: { id: true, nome: true },
    })
    return reply.view('favoritos/form-pasta', { usuario, todasPastas, erro: null })
  })

  // ── Form: adicionar favorito ──────────────────────────────────
  app.get<{ Params: { usuarioId: string } }>('/:usuarioId/form-favorito', async (req, reply) => {
    const usuario = await getUsuario(app, req.params.usuarioId)
    if (!usuario) return reply.status(404).send('Usuário não encontrado.')
    const [relatoriosFixos, relatoriosPersonalizados, todasPastas] = await Promise.all([
      app.prisma.relatorioFixo.findMany({
        where: { ativo: true },
        orderBy: [{ sistema: { nome: 'asc' } }, { nome: 'asc' }],
        include: { sistema: { select: { nome: true } } },
      }),
      app.prisma.relatorioPersonalizado.findMany({
        where: { usuarioId: req.params.usuarioId, ativo: true },
        orderBy: { nome: 'asc' },
      }),
      app.prisma.pastaFavorito.findMany({
        where: { usuarioId: req.params.usuarioId },
        orderBy: { nome: 'asc' },
        select: { id: true, nome: true },
      }),
    ])
    return reply.view('favoritos/form-favorito', {
      usuario, relatoriosFixos, relatoriosPersonalizados, todasPastas, erro: null,
    })
  })

  // ── POST: criar pasta ─────────────────────────────────────────
  app.post<{ Params: { usuarioId: string }; Body: { nome: string; parentId?: string } }>(
    '/:usuarioId/pasta',
    async (req, reply) => {
      const { nome, parentId } = req.body
      const usuario = await getUsuario(app, req.params.usuarioId)
      if (!usuario) return reply.status(404).send('Usuário não encontrado.')

      if (!nome?.trim()) {
        const todasPastas = await app.prisma.pastaFavorito.findMany({ where: { usuarioId: req.params.usuarioId }, orderBy: { nome: 'asc' }, select: { id: true, nome: true } })
        return reply.view('favoritos/form-pasta', { usuario, todasPastas, erro: 'O nome é obrigatório.' })
      }

      try {
        await svc.criarPasta(req.params.usuarioId, { nome, ...(parentId ? { parentId } : {}) })
        const { pastas, favoritosRaiz, pastasPlanas } = await carregarArvore(app, req.params.usuarioId)
        return reply.view('favoritos/modal-usuario', { usuario, pastas, favoritosRaiz, pastasPlanas })
      } catch (e: unknown) {
        const todasPastas = await app.prisma.pastaFavorito.findMany({ where: { usuarioId: req.params.usuarioId }, orderBy: { nome: 'asc' }, select: { id: true, nome: true } })
        const msg = e instanceof Error ? e.message : 'Erro ao criar pasta.'
        return reply.view('favoritos/form-pasta', { usuario, todasPastas, erro: msg })
      }
    },
  )

  // ── POST: adicionar favorito ──────────────────────────────────
  app.post<{
    Params: { usuarioId: string }
    Body: { relatorioFixoId?: string; relatorioPersonalizadoId?: string; pastaId?: string }
  }>('/:usuarioId/add', async (req, reply) => {
    const { relatorioFixoId, relatorioPersonalizadoId, pastaId } = req.body
    const usuario = await getUsuario(app, req.params.usuarioId)
    if (!usuario) return reply.status(404).send('Usuário não encontrado.')

    if (!relatorioFixoId && !relatorioPersonalizadoId) {
      const [relatoriosFixos, relatoriosPersonalizados, todasPastas] = await Promise.all([
        app.prisma.relatorioFixo.findMany({ where: { ativo: true }, orderBy: [{ sistema: { nome: 'asc' } }, { nome: 'asc' }], include: { sistema: { select: { nome: true } } } }),
        app.prisma.relatorioPersonalizado.findMany({ where: { usuarioId: req.params.usuarioId, ativo: true }, orderBy: { nome: 'asc' } }),
        app.prisma.pastaFavorito.findMany({ where: { usuarioId: req.params.usuarioId }, orderBy: { nome: 'asc' }, select: { id: true, nome: true } }),
      ])
      return reply.view('favoritos/form-favorito', { usuario, relatoriosFixos, relatoriosPersonalizados, todasPastas, erro: 'Selecione um relatório.' })
    }

    try {
      await svc.adicionarFavorito(req.params.usuarioId, {
        ...(relatorioFixoId ? { relatorioFixoId } : {}),
        ...(relatorioPersonalizadoId ? { relatorioPersonalizadoId } : {}),
        ...(pastaId ? { pastaId } : {}),
      })
      const { pastas, favoritosRaiz, pastasPlanas } = await carregarArvore(app, req.params.usuarioId)
      return reply.view('favoritos/modal-usuario', { usuario, pastas, favoritosRaiz, pastasPlanas })
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Erro ao adicionar favorito.'
      const [relatoriosFixos, relatoriosPersonalizados, todasPastas] = await Promise.all([
        app.prisma.relatorioFixo.findMany({ where: { ativo: true }, orderBy: [{ sistema: { nome: 'asc' } }, { nome: 'asc' }], include: { sistema: { select: { nome: true } } } }),
        app.prisma.relatorioPersonalizado.findMany({ where: { usuarioId: req.params.usuarioId, ativo: true }, orderBy: { nome: 'asc' } }),
        app.prisma.pastaFavorito.findMany({ where: { usuarioId: req.params.usuarioId }, orderBy: { nome: 'asc' }, select: { id: true, nome: true } }),
      ])
      return reply.view('favoritos/form-favorito', { usuario, relatoriosFixos, relatoriosPersonalizados, todasPastas, erro: msg })
    }
  })

  // ── PUT: mover favorito para outra pasta ──────────────────────
  app.put<{ Params: { id: string }; Body: { pastaId: string; usuarioId: string } }>(
    '/fav/:id/mover',
    async (req, reply) => {
      const { pastaId, usuarioId } = req.body
      try {
        await svc.moverFavorito(req.params.id, { pastaId: pastaId || null })
        const usuario = await getUsuario(app, usuarioId)
        const { pastas, favoritosRaiz, pastasPlanas } = await carregarArvore(app, usuarioId)
        return reply.view('favoritos/modal-usuario', { usuario, pastas, favoritosRaiz, pastasPlanas })
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Erro ao mover favorito.'
        return reply.status(400).send(msg)
      }
    },
  )

  // ── DELETE: remover favorito ──────────────────────────────────
  app.delete<{ Params: { id: string }; Querystring: { usuarioId: string } }>(
    '/fav/:id',
    async (req, reply) => {
      const { usuarioId } = req.query
      try {
        await svc.removerFavorito(req.params.id)
        const usuario = await getUsuario(app, usuarioId)
        const { pastas, favoritosRaiz, pastasPlanas } = await carregarArvore(app, usuarioId)
        return reply.view('favoritos/modal-usuario', { usuario, pastas, favoritosRaiz, pastasPlanas })
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Erro ao remover favorito.'
        return reply.status(400).send(msg)
      }
    },
  )

  // ── DELETE: excluir pasta ─────────────────────────────────────
  app.delete<{ Params: { id: string }; Querystring: { usuarioId: string } }>(
    '/pasta/:id',
    async (req, reply) => {
      const { usuarioId } = req.query
      try {
        await svc.excluirPasta(req.params.id)
        const usuario = await getUsuario(app, usuarioId)
        const { pastas, favoritosRaiz, pastasPlanas } = await carregarArvore(app, usuarioId)
        return reply.view('favoritos/modal-usuario', { usuario, pastas, favoritosRaiz, pastasPlanas })
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Erro ao excluir pasta.'
        return reply.status(400).send(msg)
      }
    },
  )
}
