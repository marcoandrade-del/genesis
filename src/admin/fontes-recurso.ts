import type { FastifyInstance } from 'fastify'
import { FontesRecursoService } from '../services/fontes-recurso.js'

export async function adminFontesRecursoRoutes(app: FastifyInstance) {
  const service = new FontesRecursoService(app.prisma)

  const parseAno = (ano: string) => {
    const n = parseInt(ano, 10)
    return Number.isNaN(n) || n < 1900 || n > 9999 ? null : n
  }

  // ── LIST ────────────────────────────────────────────────────────────────────
  app.get<{ Querystring: { modeloContabilId?: string; ano?: string } }>('/', async (req, reply) => {
    const modeloContabilId = req.query.modeloContabilId?.trim() || ''
    const anoFiltro = parseAno(req.query.ano?.trim() || '')
    const [modelos, fontes] = await Promise.all([
      app.prisma.modeloContabil.findMany({
        orderBy: { descricao: 'asc' },
        select: { id: true, descricao: true, ativo: true },
      }),
      service.listar({
        ...(modeloContabilId ? { modeloContabilId } : {}),
        ...(anoFiltro !== null ? { ano: anoFiltro } : {}),
      }),
    ])
    return reply.view(
      'fontes-recurso/index',
      {
        title: 'Fontes de Recursos — Gênesis Admin',
        active: 'fontes-recurso',
        userEmail: req.user.email,
        modelos,
        fontes,
        modeloSelecionado: modeloContabilId,
        anoSelecionado: anoFiltro !== null ? String(anoFiltro) : '',
      },
      { layout: 'layouts/main' },
    )
  })

  // ── FORM (novo) ─────────────────────────────────────────────────────────────
  app.get('/form', async (_req, reply) => {
    const modelos = await app.prisma.modeloContabil.findMany({
      where: { ativo: true },
      orderBy: { descricao: 'asc' },
      select: { id: true, descricao: true },
    })
    return reply.view('fontes-recurso/form', { fonte: null, modelos, erro: null })
  })

  // ── FORM (editar) ───────────────────────────────────────────────────────────
  app.get<{ Params: { id: string } }>('/:id/form', async (req, reply) => {
    const fonte = await app.prisma.fonteRecurso.findUnique({
      where: { id: req.params.id },
      include: { modeloContabil: { select: { descricao: true } } },
    })
    if (!fonte) return reply.status(404).send('Fonte de recurso não encontrada.')
    return reply.view('fontes-recurso/form', { fonte, modelos: [], erro: null })
  })

  // ── CREATE ──────────────────────────────────────────────────────────────────
  app.post<{ Body: { modeloContabilId: string; ano: string; codigo: string; nomenclatura: string; especificacao: string; vinculada?: string; grupo: string } }>(
    '/',
    async (req, reply) => {
      const { modeloContabilId, ano, codigo, nomenclatura, especificacao, vinculada, grupo } = req.body
      const reRenderErro = async (erro: string) => {
        const modelos = await app.prisma.modeloContabil.findMany({
          where: { ativo: true }, orderBy: { descricao: 'asc' }, select: { id: true, descricao: true },
        })
        return reply.view('fontes-recurso/form', { fonte: null, modelos, erro })
      }
      if (!modeloContabilId?.trim()) return reRenderErro('Selecione um modelo contábil.')
      const anoNum = parseAno(ano)
      if (anoNum === null) return reRenderErro('Ano inválido (use um ano entre 1900 e 9999).')
      if (!codigo?.trim()) return reRenderErro('O código é obrigatório.')
      if (!nomenclatura?.trim()) return reRenderErro('A nomenclatura é obrigatória.')

      try {
        await service.criar({
          modeloContabilId,
          ano: anoNum,
          codigo: codigo.trim(),
          nomenclatura: nomenclatura.trim(),
          vinculada: vinculada === 'true',
          ...(especificacao.trim() ? { especificacao: especificacao.trim() } : {}),
          ...(grupo.trim() ? { grupo: grupo.trim() } : {}),
        })
        return reply.header('HX-Redirect', '/admin/fontes-recurso').status(204).send()
      } catch (e: unknown) {
        return reRenderErro(e instanceof Error ? e.message : 'Erro ao criar fonte de recurso.')
      }
    },
  )

  // ── UPDATE ──────────────────────────────────────────────────────────────────
  app.put<{ Params: { id: string }; Body: { nomenclatura: string; especificacao: string; vinculada?: string; grupo: string } }>(
    '/:id',
    async (req, reply) => {
      const { nomenclatura, especificacao, vinculada, grupo } = req.body
      const reRenderErro = async (erro: string) => {
        const fonte = await app.prisma.fonteRecurso.findUnique({
          where: { id: req.params.id },
          include: { modeloContabil: { select: { descricao: true } } },
        })
        return reply.view('fontes-recurso/form', { fonte, modelos: [], erro })
      }
      if (!nomenclatura?.trim()) return reRenderErro('A nomenclatura é obrigatória.')

      try {
        await service.atualizar(req.params.id, {
          nomenclatura: nomenclatura.trim(),
          vinculada: vinculada === 'true',
          especificacao: especificacao.trim(),
          grupo: grupo.trim(),
        })
        return reply.header('HX-Redirect', '/admin/fontes-recurso').status(204).send()
      } catch (e: unknown) {
        return reRenderErro(e instanceof Error ? e.message : 'Erro ao atualizar fonte de recurso.')
      }
    },
  )

  // ── DELETE ──────────────────────────────────────────────────────────────────
  app.delete<{ Params: { id: string } }>('/:id', async (req, reply) => {
    try {
      await service.excluir(req.params.id)
      return reply.status(200).send('')
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Erro ao excluir.'
      return reply.status(400).send(msg)
    }
  })
}
