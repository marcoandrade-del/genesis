import type { FastifyInstance } from 'fastify'
import type { TipoPrograma, TipoAcao } from '@prisma/client'
import { ProgramasService } from '../services/programas.js'
import { AcoesService } from '../services/acoes.js'

const ANO_HOJE = new Date().getUTCFullYear()
function parseAno(v: string | undefined): number {
  const n = parseInt((v ?? '').trim(), 10)
  return Number.isFinite(n) && n >= 1900 && n <= 9999 ? n : ANO_HOJE
}

/**
 * Admin de Programas + Ações do PPA-LOA. Listagem cascata
 * Estado→Município→Entidade→Ano; drill-in para ver/editar Ações de cada
 * Programa.
 */
export async function adminProgramasRoutes(app: FastifyInstance) {
  const programas = new ProgramasService(app.prisma)
  const acoes = new AcoesService(app.prisma)

  // ── LIST (programas) ────────────────────────────────────────────────────────
  app.get<{
    Querystring: {
      estadoId?: string
      municipioId?: string
      entidadeId?: string
      ano?: string
    }
  }>('/', async (req, reply) => {
    const estadoId = req.query.estadoId?.trim() || ''
    const municipioId = req.query.municipioId?.trim() || ''
    const entidadeId = req.query.entidadeId?.trim() || ''
    const ano = parseAno(req.query.ano)

    const [estados, municipios, entidades] = await Promise.all([
      app.prisma.estado.findMany({ orderBy: { sigla: 'asc' }, select: { id: true, sigla: true, nome: true } }),
      estadoId
        ? app.prisma.municipio.findMany({
            where: { estadoId },
            orderBy: { nome: 'asc' },
            select: { id: true, nome: true },
          })
        : Promise.resolve([]),
      municipioId
        ? app.prisma.entidade.findMany({
            where: { municipioId, ativo: true },
            orderBy: { nome: 'asc' },
            select: { id: true, nome: true, tipo: true },
          })
        : Promise.resolve([]),
    ])

    const entidade = entidadeId
      ? await app.prisma.entidade.findUnique({
          where: { id: entidadeId },
          include: { municipio: { include: { estado: { select: { sigla: true, nome: true } } } } },
        })
      : null

    const lista = entidade ? await programas.listar(entidade.id, ano) : []

    return reply.view(
      'programas/index',
      {
        title: 'Programas (PPA-LOA) — Gênesis Admin',
        active: 'programas',
        userEmail: req.user.email,
        estados,
        municipios,
        entidades,
        estadoSelecionadoId: estadoId,
        municipioSelecionadoId: municipioId,
        entidade,
        ano,
        programas: lista,
      },
      { layout: 'layouts/main' },
    )
  })

  // ── FORM Programa (novo) ────────────────────────────────────────────────────
  app.get<{ Querystring: { entidadeId?: string; ano?: string } }>('/form', async (req, reply) => {
    const entidadeId = req.query.entidadeId?.trim() || ''
    const ano = parseAno(req.query.ano)
    if (!entidadeId) return reply.status(400).send('Entidade não informada.')
    return reply.view('programas/form', { programa: null, entidadeId, ano, erro: null })
  })

  // ── FORM Programa (editar) ──────────────────────────────────────────────────
  app.get<{ Params: { id: string } }>('/:id/form', async (req, reply) => {
    const prog = await app.prisma.programa.findUnique({ where: { id: req.params.id } })
    if (!prog) return reply.status(404).send('Programa não encontrado.')
    return reply.view('programas/form', { programa: prog, entidadeId: prog.entidadeId, ano: prog.ano, erro: null })
  })

  // ── CREATE Programa ─────────────────────────────────────────────────────────
  app.post<{
    Body: { entidadeId: string; ano: string; codigo: string; nome: string; objetivo?: string; tipo: string; ativo?: string }
  }>('/', async (req, reply) => {
    const { entidadeId, codigo, nome, objetivo, tipo, ativo } = req.body
    const ano = parseAno(req.body.ano)

    const reRender = (erro: string) =>
      reply.view('programas/form', {
        programa: { codigo, nome, objetivo: objetivo ?? '', tipo, ativo: ativo !== 'false' },
        entidadeId,
        ano,
        erro,
      })

    if (!entidadeId?.trim()) return reply.status(400).send('Entidade não informada.')

    try {
      await programas.criar(entidadeId, ano, {
        codigo,
        nome,
        objetivo,
        tipo: tipo as TipoPrograma,
        ativo: ativo !== 'false',
      })
      const qs = new URLSearchParams({ entidadeId, ano: String(ano) }).toString()
      return reply.header('HX-Redirect', `/admin/programas?${qs}`).status(204).send()
    } catch (e: unknown) {
      return reRender(e instanceof Error ? e.message : 'Erro ao criar programa.')
    }
  })

  // ── UPDATE Programa ─────────────────────────────────────────────────────────
  app.put<{
    Params: { id: string }
    Body: { codigo: string; nome: string; objetivo?: string; tipo: string; ativo?: string }
  }>('/:id', async (req, reply) => {
    const existente = await app.prisma.programa.findUnique({ where: { id: req.params.id } })
    if (!existente) return reply.status(404).send('Programa não encontrado.')

    const reRender = (erro: string) =>
      reply.view('programas/form', {
        programa: { ...existente, ...req.body, ativo: req.body.ativo !== 'false' },
        entidadeId: existente.entidadeId,
        ano: existente.ano,
        erro,
      })

    try {
      await programas.atualizar(req.params.id, {
        codigo: req.body.codigo,
        nome: req.body.nome,
        objetivo: req.body.objetivo,
        tipo: req.body.tipo as TipoPrograma,
        ativo: req.body.ativo !== 'false',
      })
      const qs = new URLSearchParams({
        entidadeId: existente.entidadeId,
        ano: String(existente.ano),
      }).toString()
      return reply.header('HX-Redirect', `/admin/programas?${qs}`).status(204).send()
    } catch (e: unknown) {
      return reRender(e instanceof Error ? e.message : 'Erro ao atualizar programa.')
    }
  })

  // ── DELETE Programa ─────────────────────────────────────────────────────────
  app.delete<{ Params: { id: string } }>('/:id', async (req, reply) => {
    try {
      await programas.excluir(req.params.id)
      return reply.status(200).send('')
    } catch (e: unknown) {
      return reply.status(400).send(e instanceof Error ? e.message : 'Erro ao excluir.')
    }
  })

  // ── DRILL Ações ─────────────────────────────────────────────────────────────
  // Página completa: lista as ações do programa + permite criar/editar.
  app.get<{ Params: { id: string } }>('/:id/acoes', async (req, reply) => {
    const programa = await programas.buscarPorId(req.params.id)
    if (!programa) return reply.status(404).send('Programa não encontrado.')
    const entidade = await app.prisma.entidade.findUnique({
      where: { id: programa.entidadeId },
      include: { municipio: { include: { estado: { select: { sigla: true, nome: true } } } } },
    })
    return reply.view(
      'programas/acoes',
      {
        title: 'Ações do Programa — Gênesis Admin',
        active: 'programas',
        userEmail: req.user.email,
        programa,
        entidade,
      },
      { layout: 'layouts/main' },
    )
  })

  // ── FORM Ação (novo) ────────────────────────────────────────────────────────
  app.get<{ Querystring: { programaId?: string } }>('/acoes/form', async (req, reply) => {
    const programaId = req.query.programaId?.trim() || ''
    if (!programaId) return reply.status(400).send('Programa não informado.')
    return reply.view('programas/acao_form', { acao: null, programaId, erro: null })
  })

  // ── FORM Ação (editar) ──────────────────────────────────────────────────────
  app.get<{ Params: { id: string } }>('/acoes/:id/form', async (req, reply) => {
    const acao = await acoes.buscarPorId(req.params.id)
    if (!acao) return reply.status(404).send('Ação não encontrada.')
    return reply.view('programas/acao_form', { acao, programaId: acao.programaId, erro: null })
  })

  // ── CREATE Ação ─────────────────────────────────────────────────────────────
  app.post<{
    Body: {
      programaId: string
      codigo: string
      nome: string
      tipo: string
      unidadeMedida?: string
      metaFisica?: string
      ativa?: string
    }
  }>('/acoes', async (req, reply) => {
    const { programaId, codigo, nome, tipo, unidadeMedida, metaFisica, ativa } = req.body
    if (!programaId?.trim()) return reply.status(400).send('Programa não informado.')

    const reRender = (erro: string) =>
      reply.view('programas/acao_form', {
        acao: { codigo, nome, tipo, unidadeMedida: unidadeMedida ?? '', metaFisica: metaFisica ?? '', ativa: ativa !== 'false' },
        programaId,
        erro,
      })

    try {
      await acoes.criar(programaId, {
        codigo,
        nome,
        tipo: tipo as TipoAcao,
        unidadeMedida,
        metaFisica: metaFisica ?? null,
        ativa: ativa !== 'false',
      })
      return reply.header('HX-Redirect', `/admin/programas/${programaId}/acoes`).status(204).send()
    } catch (e: unknown) {
      return reRender(e instanceof Error ? e.message : 'Erro ao criar ação.')
    }
  })

  // ── UPDATE Ação ─────────────────────────────────────────────────────────────
  app.put<{
    Params: { id: string }
    Body: { codigo: string; nome: string; tipo: string; unidadeMedida?: string; metaFisica?: string; ativa?: string }
  }>('/acoes/:id', async (req, reply) => {
    const existente = await acoes.buscarPorId(req.params.id)
    if (!existente) return reply.status(404).send('Ação não encontrada.')

    const reRender = (erro: string) =>
      reply.view('programas/acao_form', {
        acao: { ...existente, ...req.body, ativa: req.body.ativa !== 'false' },
        programaId: existente.programaId,
        erro,
      })

    try {
      await acoes.atualizar(req.params.id, {
        codigo: req.body.codigo,
        nome: req.body.nome,
        tipo: req.body.tipo as TipoAcao,
        unidadeMedida: req.body.unidadeMedida,
        metaFisica: req.body.metaFisica ?? null,
        ativa: req.body.ativa !== 'false',
      })
      return reply.header('HX-Redirect', `/admin/programas/${existente.programaId}/acoes`).status(204).send()
    } catch (e: unknown) {
      return reRender(e instanceof Error ? e.message : 'Erro ao atualizar ação.')
    }
  })

  // ── DELETE Ação ─────────────────────────────────────────────────────────────
  app.delete<{ Params: { id: string } }>('/acoes/:id', async (req, reply) => {
    try {
      await acoes.excluir(req.params.id)
      return reply.status(200).send('')
    } catch (e: unknown) {
      return reply.status(400).send(e instanceof Error ? e.message : 'Erro ao excluir.')
    }
  })
}
