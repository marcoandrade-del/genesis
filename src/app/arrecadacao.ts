import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { ArrecadacoesService } from '../services/arrecadacoes.js'
import { ArrecadacaoDiariaService } from '../services/arrecadacao-diaria.js'
import { PrevisoesReceitaService } from '../services/previsoes-receita.js'
import { ContasBancariasService } from '../services/contas-bancarias.js'
import { ConfiguracaoDashboardService, aplicarGranularidade } from '../services/configuracao-dashboard.js'
import { parseFiltroConsulta, type FiltroConsultaQuery } from './filtro-consulta.js'
import { ErroNegocio, statusDeErro } from '../errors.js'

const podeEscrever = (nivel: string) => nivel === 'ESCRITA' || nivel === 'ADMIN'

const ERRO_LEITURA =
  'Seu nível de acesso nesta entidade é apenas leitura — você pode visualizar, mas não registrar arrecadações.'

/**
 * Arrecadação da receita (gap #5 PR-3) na área do operador, escopada ao
 * contexto entidade+exercício. Uma tela única: previsto × arrecadado (totais,
 * por fonte e por conta com roll-up) + registro de movimento (arrecadação ou
 * estorno) + movimentos recentes. Escrita exige ESCRITA/ADMIN; LEITURA só vê.
 */
export async function appArrecadacaoRoutes(app: FastifyInstance) {
  const svc = new ArrecadacoesService(app.prisma)
  const diariaSvc = new ArrecadacaoDiariaService(app.prisma)
  const previsoesSvc = new PrevisoesReceitaService(app.prisma)
  const contasBancSvc = new ContasBancariasService(app.prisma)
  const cfgDash = new ConfiguracaoDashboardService(app.prisma)

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

  const carregarOrcamento = (entidadeId: string, ano: number) =>
    app.prisma.orcamento.findUnique({ where: { entidadeId_ano: { entidadeId, ano } } })

  async function renderTela(
    req: FastifyRequest,
    reply: FastifyReply,
    entidade: unknown,
    opts: { erro?: string; status?: number; valores?: Record<string, unknown> } = {},
  ) {
    const { entidadeId, ano, nivel } = req.contexto
    const orcamento = await carregarOrcamento(entidadeId, ano)
    const [resumo, movimentos, previsoes, contasBanc] = await Promise.all([
      svc.resumo(entidadeId, ano),
      orcamento ? svc.listar(orcamento.id) : Promise.resolve([]),
      orcamento ? previsoesSvc.listar(orcamento.id) : Promise.resolve([]),
      contasBancSvc.listar(entidadeId, ano),
    ])
    const temDesdobramento = resumo.porConta.some((l) => l.origem === 'DESDOBRAMENTO')
    const g = (req.query as { g?: string } | undefined)?.g
    let granularidade: 'PADRAO' | 'DESDOBRADO'
    if (g === 'PADRAO' || g === 'DESDOBRADO') {
      await cfgDash.definirRelatorio(entidadeId, '/orcamento/arrecadacao', g)
      granularidade = g
    } else {
      granularidade = await cfgDash.granularidadeRelatorio(entidadeId, '/orcamento/arrecadacao')
    }
    resumo.porConta = aplicarGranularidade(resumo.porConta, granularidade)
    if (opts.status) reply.code(opts.status)
    return reply.view('app/arrecadacao', {
      entidade,
      ano,
      nivel,
      orcamento,
      resumo,
      granularidade,
      temDesdobramento,
      movimentos,
      previsoes,
      contasBancarias: contasBanc.filter((c) => c.ativa),
      valores: opts.valores ?? {},
      podeEscrever: podeEscrever(nivel),
      erro: opts.erro ?? null,
      layout: null,
    })
  }

  // ── Tela única: resumo + form + movimentos ───────────────────
  app.get('/orcamento/arrecadacao', async (req, reply) => {
    const entidade = await carregarEntidade(req, reply)
    if (!entidade) return
    return renderTela(req, reply, entidade)
  })

  // ── Acumulado diário da receita: evolução do arrecadado dia a dia vs previsto ─
  app.get<{ Querystring: FiltroConsultaQuery }>('/orcamento/arrecadacao/diario', async (req, reply) => {
    const entidade = await carregarEntidade(req, reply)
    if (!entidade) return
    const { entidadeId, ano } = req.contexto
    const filtro = parseFiltroConsulta(req.query, ano)
    const [serie, contasOpcoes] = await Promise.all([
      diariaSvc.serie(entidadeId, ano, { ...(filtro.de ? { de: filtro.de } : {}), ...(filtro.ate ? { ate: filtro.ate } : {}), contaIds: filtro.contaIds }),
      app.prisma.contaReceitaEntidade.findMany({
        where: { entidadeId, ano, admiteMovimento: true },
        orderBy: { codigo: 'asc' },
        select: { id: true, codigo: true, descricao: true },
      }),
    ])
    const n = (d: { toNumber(): number }) => d.toNumber()
    const dataBR = (d: Date) => d.toLocaleDateString('pt-BR', { timeZone: 'UTC' })
    return reply.view('app/arrecadacao-diario', {
      entidade,
      ano,
      filtro,
      contasOpcoes,
      temOrcamento: serie.temOrcamento,
      previstoTotal: n(serie.previstoTotal),
      arrecadadoTotal: n(serie.arrecadadoTotal),
      dias: serie.dias.map((d) => ({ data: dataBR(d.data), dia: n(d.arrecadadoDia), acumulado: n(d.arrecadadoAcumulado) })),
      layout: null,
    })
  })

  // ── Trilha contábil de um movimento (lançamentos gerados) ─────
  app.get<{ Params: { id: string } }>('/orcamento/arrecadacao/:id/lancamentos', async (req, reply) => {
    const entidade = await carregarEntidade(req, reply)
    if (!entidade) return
    try {
      const trilha = await svc.trilhaDoMovimento(req.params.id, req.contexto.entidadeId)
      return reply.view('app/arrecadacao-lancamentos', {
        entidade,
        ano: req.contexto.ano,
        movimento: trilha.movimento,
        eventos: trilha.eventos,
        layout: null,
      })
    } catch (e) {
      if (e instanceof ErroNegocio) return reply.code(statusDeErro(e.code)).view('404', { caminho: req.url })
      throw e
    }
  })

  // ── Registrar movimento (arrecadação ou estorno) ─────────────
  app.post('/orcamento/arrecadacao', async (req, reply) => {
    const { entidadeId, ano, nivel } = req.contexto
    const entidade = await carregarEntidade(req, reply)
    if (!entidade) return
    if (!podeEscrever(nivel)) {
      return renderTela(req, reply, entidade, { erro: ERRO_LEITURA, status: 403 })
    }
    const orcamento = await carregarOrcamento(entidadeId, ano)
    if (!orcamento) {
      return renderTela(req, reply, entidade, { erro: 'Não há orçamento (LOA) neste exercício.' })
    }

    const body = (req.body ?? {}) as Record<string, unknown>
    const dados = {
      previsaoId: String(body['previsaoId'] ?? ''),
      tipo: String(body['tipo'] ?? ''),
      data: String(body['data'] ?? ''),
      valor: String(body['valor'] ?? ''),
      historico: String(body['historico'] ?? ''),
      criadoPorId: req.user.sub,
      contaBancariaId: String(body['contaBancariaId'] ?? ''),
    }

    try {
      await svc.criar(orcamento.id, dados)
      return reply.redirect('/app/orcamento/arrecadacao')
    } catch (e) {
      if (e instanceof ErroNegocio) {
        return renderTela(req, reply, entidade, { erro: e.message, status: statusDeErro(e.code), valores: dados })
      }
      throw e
    }
  })
}
