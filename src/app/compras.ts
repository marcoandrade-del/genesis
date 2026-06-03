import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { ItensCatalogoService } from '../services/itens-catalogo.js'
import { PlanosContratacaoService } from '../services/planos-contratacao.js'
import { DocumentosDemandaService } from '../services/documentos-demanda.js'
import { ReservasDotacaoService } from '../services/reservas-dotacao.js'

/**
 * Área "Compras" do operador (Lei 14.133), fase de Planejamento — read-only
 * (C-App-1). Diferente do /admin, NÃO há picker de entidade: o escopo (entidade
 * + exercício) vem de `req.contexto`. Reusa os services do módulo de compras.
 *
 * Escopo por exercício: PCA e DOD têm `ano` próprio (filtrados ao ano do
 * contexto); Catálogo é global; Reservas amarram em dotação (sem `ano` próprio),
 * então listam por entidade.
 */
export async function appComprasRoutes(app: FastifyInstance) {
  const catalogo = new ItensCatalogoService(app.prisma)
  const pcas = new PlanosContratacaoService(app.prisma)
  const demandas = new DocumentosDemandaService(app.prisma)
  const reservas = new ReservasDotacaoService(app.prisma)

  /** Carrega a entidade do contexto; se sumiu, limpa cookie e manda escolher contexto. */
  async function carregarEntidade(req: FastifyRequest, reply: FastifyReply) {
    const entidade = await app.prisma.entidade.findUnique({
      where: { id: req.contexto.entidadeId },
      include: { municipio: { include: { estado: { select: { sigla: true, nome: true } } } } },
    })
    if (!entidade) {
      reply.clearCookie('genesis_exercicio', { path: '/' }).redirect('/app/contexto')
      return null
    }
    return entidade
  }

  // ── Hub: visão geral do planejamento de compras do exercício ─────────────────
  app.get('/compras', async (req, reply) => {
    const entidade = await carregarEntidade(req, reply)
    if (!entidade) return
    const { entidadeId, ano, nivel } = req.contexto
    const [catalogoTotal, listaPca, listaDod, listaReservas] = await Promise.all([
      catalogo.contar({ apenasAtivos: true }),
      pcas.listar(entidadeId),
      demandas.listar(entidadeId),
      reservas.listar(entidadeId),
    ])
    const pca = listaPca.find((p) => p.ano === ano) ?? null
    const counts = {
      catalogo: catalogoTotal,
      pcaExiste: !!pca,
      pcaItens: pca ? pca._count.itens : 0,
      demandas: listaDod.filter((d) => d.ano === ano).length,
      reservas: listaReservas.length,
    }
    return reply.view('app/compras', { entidade, ano, nivel, counts, layout: null })
  })

  // ── Catálogo de itens (CATMAT/CATSER) — global ───────────────────────────────
  app.get<{ Querystring: { q?: string; pagina?: string } }>('/compras/catalogo', async (req, reply) => {
    const entidade = await carregarEntidade(req, reply)
    if (!entidade) return
    const busca = (req.query.q ?? '').trim()
    const pagina = Math.max(parseInt(req.query.pagina ?? '1', 10) || 1, 1)
    const r = await catalogo.listarPaginado({ apenasAtivos: true, busca, pagina, porPagina: 50 })
    return reply.view('app/compras-catalogo', { entidade, ano: req.contexto.ano, busca, ...r, layout: null })
  })

  // ── PCA do exercício (0 ou 1 por entidade × ano) ─────────────────────────────
  app.get('/compras/pca', async (req, reply) => {
    const entidade = await carregarEntidade(req, reply)
    if (!entidade) return
    const { entidadeId, ano } = req.contexto
    const todos = await pcas.listar(entidadeId)
    const resumo = todos.find((p) => p.ano === ano) ?? null
    const pca = resumo ? await pcas.buscarPorId(resumo.id) : null
    return reply.view('app/compras-pca', { entidade, ano, pca, layout: null })
  })

  // ── Demandas (DOD) do exercício ──────────────────────────────────────────────
  app.get('/compras/demandas', async (req, reply) => {
    const entidade = await carregarEntidade(req, reply)
    if (!entidade) return
    const { entidadeId, ano } = req.contexto
    const todas = await demandas.listar(entidadeId)
    const lista = todas.filter((d) => d.ano === ano)
    return reply.view('app/compras-demandas', { entidade, ano, lista, layout: null })
  })

  // ── Reservas de dotação da entidade (pré-empenho) ────────────────────────────
  app.get('/compras/reservas', async (req, reply) => {
    const entidade = await carregarEntidade(req, reply)
    if (!entidade) return
    const lista = await reservas.listar(req.contexto.entidadeId)
    return reply.view('app/compras-reservas', { entidade, ano: req.contexto.ano, lista, layout: null })
  })
}
