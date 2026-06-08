import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { ItensCatalogoService } from '../services/itens-catalogo.js'
import { PlanosContratacaoService } from '../services/planos-contratacao.js'
import { DocumentosDemandaService } from '../services/documentos-demanda.js'
import { ReservasDotacaoService } from '../services/reservas-dotacao.js'
import { FornecedoresService } from '../services/fornecedores.js'
import { ProcessosService } from '../services/processos.js'
import { ContratosService } from '../services/contratos.js'
import { AtasRegistroPrecoService } from '../services/atas-registro-preco.js'
import { EmpenhosService } from '../services/empenhos.js'
import { LiquidacoesService } from '../services/liquidacoes.js'
import { OrdensPagamentoService } from '../services/ordens-pagamento.js'

/**
 * Área "Compras" do operador (Lei 14.133) — read-only (C-App-1/2/3). Diferente
 * do /admin, NÃO há picker de entidade: o escopo (entidade + exercício) vem de
 * `req.contexto`. Reusa os services do módulo de compras (só os métodos de
 * leitura `listar`); criação/edição segue no /admin.
 *
 * Três fases da Lei 14.133:
 * - Planejamento: Catálogo (global), PCA e DOD (têm `ano`, filtrados ao
 *   exercício), Reservas (amarram em dotação, listadas por entidade).
 * - Seleção: Fornecedores (cadastro global), Processos, Contratos e Atas
 *   (escopados por entidade).
 * - Execução: Empenhos, Liquidações e Ordens de Pagamento (por entidade).
 */
export async function appComprasRoutes(app: FastifyInstance) {
  const catalogo = new ItensCatalogoService(app.prisma)
  const pcas = new PlanosContratacaoService(app.prisma)
  const demandas = new DocumentosDemandaService(app.prisma)
  const reservas = new ReservasDotacaoService(app.prisma)
  const fornecedores = new FornecedoresService(app.prisma)
  const processos = new ProcessosService(app.prisma)
  const contratos = new ContratosService(app.prisma)
  const atas = new AtasRegistroPrecoService(app.prisma)
  const empenhos = new EmpenhosService(app.prisma)
  const liquidacoes = new LiquidacoesService(app.prisma)
  const ordensPagamento = new OrdensPagamentoService(app.prisma)

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

  // ── Hub: visão geral das três fases de compras do exercício ──────────────────
  app.get('/compras', async (req, reply) => {
    const entidade = await carregarEntidade(req, reply)
    if (!entidade) return
    const { entidadeId, ano, nivel } = req.contexto
    const [
      catalogoTotal, listaPca, listaDod, listaReservas,
      listaFornecedores, listaProcessos, listaContratos, listaAtas,
      listaEmpenhos, listaLiquidacoes, listaOrdens,
    ] = await Promise.all([
      catalogo.contar({ apenasAtivos: true }),
      pcas.listar(entidadeId),
      demandas.listar(entidadeId),
      reservas.listar(entidadeId),
      fornecedores.listar(),
      processos.listar(entidadeId),
      contratos.listar(entidadeId),
      atas.listar(entidadeId),
      empenhos.listar(entidadeId),
      liquidacoes.listar(entidadeId),
      ordensPagamento.listar(entidadeId),
    ])
    const pca = listaPca.find((p) => p.ano === ano) ?? null
    const counts = {
      // Planejamento
      catalogo: catalogoTotal,
      pcaExiste: !!pca,
      pcaItens: pca ? pca._count.itens : 0,
      demandas: listaDod.filter((d) => d.ano === ano).length,
      reservas: listaReservas.length,
      // Seleção
      fornecedores: listaFornecedores.length,
      processos: listaProcessos.length,
      contratos: listaContratos.length,
      atas: listaAtas.length,
      // Execução
      empenhos: listaEmpenhos.length,
      liquidacoes: listaLiquidacoes.length,
      ordensPagamento: listaOrdens.length,
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

  // ── Fase 2: Seleção ──────────────────────────────────────────────────────────

  // Fornecedores — cadastro GLOBAL (compartilhado entre entidades).
  app.get('/compras/fornecedores', async (req, reply) => {
    const entidade = await carregarEntidade(req, reply)
    if (!entidade) return
    const lista = await fornecedores.listar()
    return reply.view('app/compras-fornecedores', { entidade, ano: req.contexto.ano, lista, layout: null })
  })

  // Processos licitatórios da entidade.
  app.get('/compras/processos', async (req, reply) => {
    const entidade = await carregarEntidade(req, reply)
    if (!entidade) return
    const lista = await processos.listar(req.contexto.entidadeId)
    return reply.view('app/compras-processos', { entidade, ano: req.contexto.ano, lista, layout: null })
  })

  // Contratos da entidade.
  app.get('/compras/contratos', async (req, reply) => {
    const entidade = await carregarEntidade(req, reply)
    if (!entidade) return
    const lista = await contratos.listar(req.contexto.entidadeId)
    return reply.view('app/compras-contratos', { entidade, ano: req.contexto.ano, lista, layout: null })
  })

  // Atas de registro de preço da entidade.
  app.get('/compras/atas', async (req, reply) => {
    const entidade = await carregarEntidade(req, reply)
    if (!entidade) return
    const lista = await atas.listar(req.contexto.entidadeId)
    return reply.view('app/compras-atas', { entidade, ano: req.contexto.ano, lista, layout: null })
  })

  // ── Fase 3: Execução (três estágios da despesa) ──────────────────────────────

  // Empenhos da entidade.
  app.get('/compras/empenhos', async (req, reply) => {
    const entidade = await carregarEntidade(req, reply)
    if (!entidade) return
    const lista = await empenhos.listar(req.contexto.entidadeId)
    return reply.view('app/compras-empenhos', { entidade, ano: req.contexto.ano, lista, layout: null })
  })

  // Liquidações da entidade.
  app.get('/compras/liquidacoes', async (req, reply) => {
    const entidade = await carregarEntidade(req, reply)
    if (!entidade) return
    const lista = await liquidacoes.listar(req.contexto.entidadeId)
    return reply.view('app/compras-liquidacoes', { entidade, ano: req.contexto.ano, lista, layout: null })
  })

  // Ordens de pagamento da entidade.
  app.get('/compras/ordens-pagamento', async (req, reply) => {
    const entidade = await carregarEntidade(req, reply)
    if (!entidade) return
    const lista = await ordensPagamento.listar(req.contexto.entidadeId)
    return reply.view('app/compras-ordens-pagamento', { entidade, ano: req.contexto.ano, lista, layout: null })
  })
}
