import type { FastifyInstance } from 'fastify'
import type { TipoItemCatalogo } from '@prisma/client'
import { ItensCatalogoService } from '../services/itens-catalogo.js'
import { erroHttp, tratarErro } from '../errors.js'

const TIPOS: ReadonlyArray<TipoItemCatalogo> = ['MATERIAL', 'SERVICO']
// O CATMAT completo em CSV ocupa ~28 MB; folga de ~2× para crescimento.
const LIMITE_CSV_IMPORTACAO = 64 * 1024 * 1024

/**
 * Admin do Catálogo de Itens (CATMAT/CATSER) — cadastro global de materiais e
 * serviços reutilizado por PCA, DOD e TR. CRUD simples com filtro por tipo.
 */
export async function adminItensCatalogoRoutes(app: FastifyInstance) {
  const service = new ItensCatalogoService(app.prisma)

  // ── LIST ──────────────────────────────────────────────────────────────────
  app.get<{ Querystring: { tipo?: string; q?: string; pagina?: string } }>('/', async (req, reply) => {
    const tipoFiltro = TIPOS.includes(req.query.tipo as TipoItemCatalogo)
      ? (req.query.tipo as TipoItemCatalogo)
      : ''
    const busca = (req.query.q ?? '').trim()
    const pagina = Math.max(parseInt(req.query.pagina ?? '1', 10) || 1, 1)
    const r = await service.listarPaginado({ ...(tipoFiltro ? { tipo: tipoFiltro } : {}), busca, pagina, porPagina: 50 })
    return reply.view(
      'itens-catalogo/index',
      {
        title: 'Catálogo de Itens — Gênesis Admin',
        active: 'itens-catalogo',
        userEmail: req.user.email,
        items: r.itens,
        tipoFiltro,
        busca,
        pagina: r.pagina,
        totalPaginas: r.totalPaginas,
        total: r.total,
      },
      { layout: 'layouts/main' },
    )
  })

  // ── IMPORTAR (modal de upload) ──────────────────────────────────────────────
  app.get('/importar', async (_req, reply) => {
    return reply.view('itens-catalogo/importar', {})
  })

  // ── IMPORT submit (JSON body { csv, tipo, unidadeMedida }) ──────────────────
  // O CSV é lido no cliente (FileReader) e enviado como JSON. Reaproveita o service.
  app.post<{ Body: { csv?: string; tipo?: string; unidadeMedida?: string } }>(
    '/importar',
    { bodyLimit: LIMITE_CSV_IMPORTACAO },
    async (req, reply) => {
      const { csv, tipo, unidadeMedida } = req.body
      if (typeof csv !== 'string' || !csv.trim()) {
        return reply.status(400).send(erroHttp('REQUISICAO_INVALIDA', 'CSV vazio.'))
      }
      try {
        const resultado = await service.importarCsv(csv, {
          tipo: tipo as TipoItemCatalogo,
          unidadeMedida: unidadeMedida ?? '',
        })
        return reply.send({ data: resultado })
      } catch (e) {
        return tratarErro(e, reply)
      }
    },
  )

  // ── FORM (novo) ─────────────────────────────────────────────────────────────
  app.get('/form', async (_req, reply) => {
    return reply.view('itens-catalogo/form', { item: null, erro: null })
  })

  // ── FORM (editar) ───────────────────────────────────────────────────────────
  app.get<{ Params: { id: string } }>('/:id/form', async (req, reply) => {
    const item = await service.buscarPorId(req.params.id)
    if (!item) return reply.status(404).send('Item não encontrado.')
    return reply.view('itens-catalogo/form', { item, erro: null })
  })

  // ── CREATE ────────────────────────────────────────────────────────────────
  app.post<{
    Body: { tipo: string; codigo: string; descricao: string; unidadeMedida: string }
  }>('/', async (req, reply) => {
    const { tipo, codigo, descricao, unidadeMedida } = req.body
    try {
      await service.criar({ tipo: tipo as TipoItemCatalogo, codigo, descricao, unidadeMedida })
      return reply.header('HX-Redirect', '/admin/itens-catalogo').status(204).send()
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Erro ao criar item.'
      return reply.view('itens-catalogo/form', { item: { tipo, codigo, descricao, unidadeMedida }, erro: msg })
    }
  })

  // ── UPDATE ────────────────────────────────────────────────────────────────
  app.put<{
    Params: { id: string }
    Body: { tipo: string; codigo: string; descricao: string; unidadeMedida: string; ativo?: string }
  }>('/:id', async (req, reply) => {
    const { tipo, codigo, descricao, unidadeMedida, ativo } = req.body
    try {
      await service.atualizar(req.params.id, {
        tipo: tipo as TipoItemCatalogo,
        codigo,
        descricao,
        unidadeMedida,
        ativo: ativo === 'true',
      })
      return reply.header('HX-Redirect', '/admin/itens-catalogo').status(204).send()
    } catch (e: unknown) {
      const item = { id: req.params.id, tipo, codigo, descricao, unidadeMedida, ativo: ativo === 'true' }
      const msg = e instanceof Error ? e.message : 'Erro ao atualizar item.'
      return reply.view('itens-catalogo/form', { item, erro: msg })
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
