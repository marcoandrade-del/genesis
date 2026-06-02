import type { FastifyInstance } from 'fastify'
import type { StatusPca } from '@prisma/client'
import { PlanosContratacaoService } from '../services/planos-contratacao.js'

const STATUS_VALIDOS: ReadonlyArray<StatusPca> = ['RASCUNHO', 'APROVADO']

type ItemForm = { itemCatalogoId: string; quantidadeEstimada: string; valorUnitarioEstimado: string }

/** Lê o campo itensJson (lista serializada pelo editor de linhas). */
function parseItens(itensJson: string | undefined): ItemForm[] {
  if (!itensJson?.trim()) return []
  try {
    const arr = JSON.parse(itensJson)
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

function carregarCatalogo(app: FastifyInstance) {
  return app.prisma.itemCatalogo.findMany({
    where: { ativo: true },
    orderBy: [{ tipo: 'asc' }, { codigo: 'asc' }],
    select: { id: true, tipo: true, codigo: true, descricao: true, unidadeMedida: true },
  })
}

/**
 * Admin do PCA — Plano de Contratações Anual por entidade × ano. Picker cascata;
 * lista por entidade; form modal com editor de itens (catálogo × quantidade ×
 * valor) serializado em JSON; ciclo de status RASCUNHO ⇄ APROVADO.
 */
export async function adminPlanosContratacaoRoutes(app: FastifyInstance) {
  const service = new PlanosContratacaoService(app.prisma)

  // ── LIST (cascata + PCAs da entidade) ───────────────────────────────────────
  app.get<{
    Querystring: { estadoId?: string; municipioId?: string; entidadeId?: string }
  }>('/', async (req, reply) => {
    const estadoId = req.query.estadoId?.trim() || ''
    const municipioId = req.query.municipioId?.trim() || ''
    const entidadeId = req.query.entidadeId?.trim() || ''

    const [estados, municipios, entidades] = await Promise.all([
      app.prisma.estado.findMany({ orderBy: { sigla: 'asc' }, select: { id: true, sigla: true, nome: true } }),
      estadoId
        ? app.prisma.municipio.findMany({ where: { estadoId }, orderBy: { nome: 'asc' }, select: { id: true, nome: true } })
        : Promise.resolve([]),
      municipioId
        ? app.prisma.entidade.findMany({ where: { municipioId, ativo: true }, orderBy: { nome: 'asc' }, select: { id: true, nome: true } })
        : Promise.resolve([]),
    ])

    const entidade = entidadeId
      ? await app.prisma.entidade.findUnique({
          where: { id: entidadeId },
          include: { municipio: { include: { estado: { select: { sigla: true, nome: true } } } } },
        })
      : null

    const planos = entidade ? await service.listar(entidade.id) : []

    return reply.view(
      'planos-contratacao/index',
      {
        title: 'Plano de Contratações (PCA) — Gênesis Admin',
        active: 'planos-contratacao',
        userEmail: req.user.email,
        estados,
        municipios,
        entidades,
        estadoSelecionadoId: estadoId,
        municipioSelecionadoId: municipioId,
        entidade,
        planos,
      },
      { layout: 'layouts/main' },
    )
  })

  // ── FORM (novo) ─────────────────────────────────────────────────────────────
  app.get<{ Querystring: { entidadeId?: string } }>('/form', async (req, reply) => {
    const entidadeId = req.query.entidadeId?.trim() || ''
    if (!entidadeId) return reply.status(400).send('Entidade não informada.')
    const catalogo = await carregarCatalogo(app)
    return reply.view('planos-contratacao/form', { entidadeId, pca: null, itens: [], catalogo, erro: null })
  })

  // ── FORM (editar) ───────────────────────────────────────────────────────────
  app.get<{ Params: { id: string } }>('/:id/form', async (req, reply) => {
    const pca = await service.buscarPorId(req.params.id)
    if (!pca) return reply.status(404).send('PCA não encontrado.')
    const catalogo = await carregarCatalogo(app)
    const itens = pca.itens.map((i) => ({
      itemCatalogoId: i.itemCatalogoId,
      quantidadeEstimada: String(i.quantidadeEstimada),
      valorUnitarioEstimado: String(i.valorUnitarioEstimado),
    }))
    return reply.view('planos-contratacao/form', { entidadeId: pca.entidadeId, pca, itens, catalogo, erro: null })
  })

  // ── CREATE ────────────────────────────────────────────────────────────────
  app.post<{
    Body: { entidadeId: string; ano: string; observacoes?: string; itensJson?: string }
  }>('/', async (req, reply) => {
    const { entidadeId, observacoes, itensJson } = req.body
    if (!entidadeId?.trim()) return reply.status(400).send('Entidade não informada.')
    const ano = parseInt((req.body.ano ?? '').trim(), 10)
    const itens = parseItens(itensJson)
    try {
      await service.criar(entidadeId, ano, { observacoes, itens })
      const qs = new URLSearchParams({ entidadeId }).toString()
      return reply.header('HX-Redirect', `/admin/planos-contratacao?${qs}`).status(204).send()
    } catch (e: unknown) {
      const catalogo = await carregarCatalogo(app)
      const msg = e instanceof Error ? e.message : 'Erro ao criar PCA.'
      return reply.view('planos-contratacao/form', { entidadeId, pca: { ano, observacoes }, itens, catalogo, erro: msg })
    }
  })

  // ── UPDATE ────────────────────────────────────────────────────────────────
  app.put<{ Params: { id: string }; Body: { observacoes?: string; itensJson?: string } }>(
    '/:id',
    async (req, reply) => {
      const existente = await service.buscarPorId(req.params.id)
      if (!existente) return reply.status(404).send('PCA não encontrado.')
      const itens = parseItens(req.body.itensJson)
      try {
        await service.atualizar(req.params.id, { observacoes: req.body.observacoes, itens })
        const qs = new URLSearchParams({ entidadeId: existente.entidadeId }).toString()
        return reply.header('HX-Redirect', `/admin/planos-contratacao?${qs}`).status(204).send()
      } catch (e: unknown) {
        const catalogo = await carregarCatalogo(app)
        const msg = e instanceof Error ? e.message : 'Erro ao atualizar PCA.'
        return reply.view('planos-contratacao/form', {
          entidadeId: existente.entidadeId,
          pca: existente,
          itens,
          catalogo,
          erro: msg,
        })
      }
    },
  )

  // ── STATUS (RASCUNHO ⇄ APROVADO) ────────────────────────────────────────────
  app.post<{ Params: { id: string }; Body: { status: string } }>('/:id/status', async (req, reply) => {
    const novoStatus = req.body.status as StatusPca
    if (!STATUS_VALIDOS.includes(novoStatus)) return reply.status(400).send('Status inválido.')
    const pca = await app.prisma.planoContratacaoAnual.findUnique({ where: { id: req.params.id } })
    if (!pca) return reply.status(404).send('PCA não encontrado.')
    try {
      await service.alterarStatus(req.params.id, novoStatus)
      const qs = new URLSearchParams({ entidadeId: pca.entidadeId }).toString()
      return reply.header('HX-Redirect', `/admin/planos-contratacao?${qs}`).status(204).send()
    } catch (e: unknown) {
      return reply.status(400).send(e instanceof Error ? e.message : 'Erro ao alterar status.')
    }
  })

  // ── DELETE ────────────────────────────────────────────────────────────────
  app.delete<{ Params: { id: string } }>('/:id', async (req, reply) => {
    try {
      await service.excluir(req.params.id)
      return reply.status(200).send('')
    } catch (e: unknown) {
      return reply.status(400).send(e instanceof Error ? e.message : 'Erro ao excluir.')
    }
  })
}
