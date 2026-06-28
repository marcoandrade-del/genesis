import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { ErroNegocio, statusDeErro } from '../errors.js'
import type { SaldoContabilService } from '../services/saldo-contabil.js'
import { ConfiguracaoDashboardService, aplicarGranularidade } from '../services/configuracao-dashboard.js'

const podeEscrever = (nivel: string) => nivel === 'ESCRITA' || nivel === 'ADMIN'

const ERRO_LEITURA =
  'Seu nível de acesso nesta entidade é apenas leitura — você pode visualizar, mas não desdobrar contas.'

/** Conta escopada por entidade — campos comuns aos 3 planos (contábil/receita/despesa). */
export type ContaEntidade = {
  id: string
  codigo: string
  descricao: string
  nivel: number
  admiteMovimento: boolean
  origem: string
  parentId: string | null
}

/** Interface comum dos 3 services (ContasContabil/Receita/DespesaEntidadeService). */
export type ServicoPlano = {
  buscarPorId(id: string): Promise<{ id: string; entidadeId: string; admiteMovimento: boolean; origem: string; descricao: string } | null>
  sugerirCodigo(parentId: string): Promise<string>
  desdobrar(contaId: string, dados: { codigo: string; descricao: string }): Promise<unknown>
  editarDescricao(id: string, descricao: string): Promise<unknown>
  excluir(id: string): Promise<unknown>
}

export type ConfigPlano = {
  /** Rota Fastify SEM o prefixo `/app` (ex.: `/contas`). */
  rota: string
  titulo: string
  descricao: string
  servico: ServicoPlano
  listarFlat: (entidadeId: string, ano: number) => Promise<ContaEntidade[]>
  /** Só o plano contábil tem saldos (lançamentos). Quando presente, a tela
   *  exibe saldo inicial/débito/crédito/saldo atual por conta. */
  saldos?: SaldoContabilService
  /** Saldo GENÉRICO por conta (receita/despesa): colunas + valores por conta,
   *  na posição da data de referência. Renderiza colunas simples (sem natureza). */
  saldoColunas?: { chave: string; rotulo: string }[]
  saldoMapa?: (entidadeId: string, ano: number, dataRef: Date) => Promise<Map<string, Record<string, number>>>
}

type RenderOpts = {
  erro?: string
  status?: number
  desdobrar?: { id: string; codigo?: string; descricao?: string } | null
  sugestao?: string
  editar?: { id: string; descricao: string } | null
}

/** Data de referência do saldo: `?data=YYYY-MM-DD` ou hoje (data de login). */
function dataRefDe(req: FastifyRequest): Date {
  const raw = (req.query as { data?: string } | undefined)?.data?.trim()
  if (raw) {
    const d = new Date(`${raw}T00:00:00`)
    if (!Number.isNaN(d.getTime())) return d
  }
  return new Date()
}

const isoData = (d: Date) => d.toISOString().slice(0, 10)

/**
 * Registra as rotas de um "plano de contas da entidade" no `/app`. Os 3 planos
 * (contábil, receita, despesa) têm regras de desdobramento idênticas — esta
 * factory evita triplicar o boilerplate. Toda a lógica de negócio (só folha
 * analítica desdobra, modelo TCE imutável, etc.) vive nos services reusados.
 *
 * Escopo (entidade+ano) vem de `req.contexto`, sem picker. Escrita exige
 * ESCRITA/ADMIN; LEITURA só visualiza. Mutações validam que a conta pertence à
 * entidade do contexto (impede operar conta de outra entidade por ID).
 */
export function registrarRotasPlano(app: FastifyInstance, cfg: ConfigPlano) {
  const url = `/app${cfg.rota}` // usado em links/redirects das views
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

  async function renderLista(req: FastifyRequest, reply: FastifyReply, entidade: unknown, opts: RenderOpts = {}) {
    const { entidadeId, ano, nivel } = req.contexto
    const contas = await cfg.listarFlat(entidadeId, ano)
    // Estrutura (temFilhos/pode-desdobrar) usa a árvore completa; o que se EXIBE
    // depende da granularidade do dashboard (PADRAO esconde os desdobramentos locais).
    const idsPais = new Set(contas.map((c) => c.parentId).filter(Boolean))
    // Contas que já são "desdobramento-pai" podem receber mais filhos (várias).
    const idsPaisDesdobramento = new Set(
      contas.filter((c) => c.origem === 'DESDOBRAMENTO').map((c) => c.parentId).filter(Boolean),
    )

    // Granularidade do relatório: o seletor da tela manda `?g=...` (memoriza só se
    // diferir do default da entidade); sem param, usa o override do relatório → default.
    const temDesdobramento = contas.some((c) => c.origem === 'DESDOBRAMENTO')
    const g = (req.query as { g?: string } | undefined)?.g
    let granularidade: 'PADRAO' | 'DESDOBRADO'
    if (g === 'PADRAO' || g === 'DESDOBRADO') {
      await cfgDash.definirRelatorio(entidadeId, cfg.rota, g)
      granularidade = g
    } else {
      granularidade = await cfgDash.granularidadeRelatorio(entidadeId, cfg.rota)
    }
    const contasVisiveis = aplicarGranularidade(contas, granularidade)

    const dataRef = dataRefDe(req)
    const saldos = cfg.saldos ? await cfg.saldos.calcular(entidadeId, ano, dataRef) : null
    const saldoGenMap = cfg.saldoMapa ? await cfg.saldoMapa(entidadeId, ano, dataRef) : null

    const linhas = contasVisiveis.map((c) => {
      const s = saldos?.get(c.id)
      return {
        ...c,
        saldoGen: saldoGenMap?.get(c.id) ?? null,
        temFilhos: idsPais.has(c.id),
        // Redutora/retificadora do PCASP: marcada com "(-)" no título (subtrai do grupo).
        redutora: c.descricao.trim().startsWith('(-)'),
        // Desdobra analítica (1º filho) OU conta que já é desdobramento-pai (+ filhos).
        podeDesdobrar: c.admiteMovimento || idsPaisDesdobramento.has(c.id),
        podeEditar: c.origem === 'DESDOBRAMENTO',
        saldo: s
          ? {
              inicial: s.saldoInicial.toNumber(),
              debito: s.totalDebito.toNumber(),
              credito: s.totalCredito.toNumber(),
              atual: s.saldoAtual.toNumber(),
              natureza: s.natureza,
              naturezaInformacao: s.naturezaInformacao,
              superavit: s.superavitFinanceiro,
              funcao: s.funcao,
            }
          : null,
      }
    })

    if (opts.status) reply.code(opts.status)
    return reply.view('app/plano-entidade', {
      base: url,
      titulo: cfg.titulo,
      descricao: cfg.descricao,
      entidade,
      ano,
      nivel,
      contas: linhas,
      granularidade,
      temDesdobramento,
      podeEscrever: podeEscrever(nivel),
      comSaldos: !!cfg.saldos,
      saldoColunas: cfg.saldoColunas ?? null,
      dataRef: isoData(dataRef),
      desdobrar: opts.desdobrar ?? null,
      sugestao: opts.sugestao ?? '',
      editar: opts.editar ?? null,
      erro: opts.erro ?? null,
      layout: null,
    })
  }

  /** Busca a conta garantindo que pertence à entidade do contexto (senão null). */
  async function buscarNoEscopo(id: string, entidadeId: string) {
    const conta = await cfg.servico.buscarPorId(id)
    return conta && conta.entidadeId === entidadeId ? conta : null
  }

  // ── Lista (+ form de desdobrar/editar via ?desdobrar / ?editar) ─────────────
  app.get<{ Querystring: { desdobrar?: string; editar?: string; data?: string; g?: string } }>(cfg.rota, async (req, reply) => {
    const entidade = await carregarEntidade(req, reply)
    if (!entidade) return

    const alvoD = req.query.desdobrar?.trim()
    if (alvoD) {
      const conta = await buscarNoEscopo(alvoD, req.contexto.entidadeId)
      if (conta) {
        const sugestao = await cfg.servico.sugerirCodigo(conta.id)
        return renderLista(req, reply, entidade, { desdobrar: { id: conta.id }, sugestao })
      }
    }

    const alvoE = req.query.editar?.trim()
    if (alvoE) {
      const conta = await buscarNoEscopo(alvoE, req.contexto.entidadeId)
      if (conta && conta.origem === 'DESDOBRAMENTO') {
        return renderLista(req, reply, entidade, { editar: { id: conta.id, descricao: conta.descricao } })
      }
    }

    return renderLista(req, reply, entidade)
  })

  // ── Desdobrar ───────────────────────────────────────────────────────────────
  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>(
    `${cfg.rota}/:id/desdobrar`,
    async (req, reply) => {
      const { entidadeId, nivel } = req.contexto
      const entidade = await carregarEntidade(req, reply)
      if (!entidade) return
      if (!podeEscrever(nivel)) return renderLista(req, reply, entidade, { erro: ERRO_LEITURA, status: 403 })

      const conta = await buscarNoEscopo(req.params.id, entidadeId)
      if (!conta) return renderLista(req, reply, entidade, { erro: 'Conta não encontrada nesta entidade.', status: 404 })

      const body = req.body ?? {}
      const dados = { codigo: String(body['codigo'] ?? ''), descricao: String(body['descricao'] ?? '') }
      try {
        await cfg.servico.desdobrar(conta.id, dados)
        return reply.redirect(url)
      } catch (e) {
        if (e instanceof ErroNegocio) {
          // Reabre o form com o erro e os valores digitados.
          return renderLista(req, reply, entidade, {
            erro: e.message,
            status: statusDeErro(e.code),
            desdobrar: { id: conta.id, codigo: dados.codigo, descricao: dados.descricao },
            sugestao: dados.codigo,
          })
        }
        throw e
      }
    },
  )

  // ── Editar descrição (só desdobramento) ──────────────────────────────────────
  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>(`${cfg.rota}/:id/editar`, async (req, reply) => {
    const { entidadeId, nivel } = req.contexto
    const entidade = await carregarEntidade(req, reply)
    if (!entidade) return
    if (!podeEscrever(nivel)) return renderLista(req, reply, entidade, { erro: ERRO_LEITURA, status: 403 })

    const conta = await buscarNoEscopo(req.params.id, entidadeId)
    if (!conta) return renderLista(req, reply, entidade, { erro: 'Conta não encontrada nesta entidade.', status: 404 })

    const descricao = String((req.body ?? {})['descricao'] ?? '')
    try {
      await cfg.servico.editarDescricao(conta.id, descricao)
      return reply.redirect(url)
    } catch (e) {
      if (e instanceof ErroNegocio) {
        return renderLista(req, reply, entidade, { erro: e.message, status: statusDeErro(e.code), editar: { id: conta.id, descricao } })
      }
      throw e
    }
  })

  // ── Excluir desdobramento ────────────────────────────────────────────────────
  app.post<{ Params: { id: string } }>(`${cfg.rota}/:id/excluir`, async (req, reply) => {
    const { entidadeId, nivel } = req.contexto
    const entidade = await carregarEntidade(req, reply)
    if (!entidade) return
    if (!podeEscrever(nivel)) return renderLista(req, reply, entidade, { erro: ERRO_LEITURA, status: 403 })

    const conta = await buscarNoEscopo(req.params.id, entidadeId)
    if (!conta) return renderLista(req, reply, entidade, { erro: 'Conta não encontrada nesta entidade.', status: 404 })

    try {
      await cfg.servico.excluir(conta.id)
      return reply.redirect(url)
    } catch (e) {
      if (e instanceof ErroNegocio) {
        return renderLista(req, reply, entidade, { erro: e.message, status: statusDeErro(e.code) })
      }
      throw e
    }
  })
}
