import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { LancamentoTributarioService } from '../services/lancamento-tributario.js'
import { PrevisoesReceitaService } from '../services/previsoes-receita.js'
import { ErroNegocio, statusDeErro } from '../errors.js'

const podeEscrever = (nivel: string) => nivel === 'ESCRITA' || nivel === 'ADMIN'
const ERRO_LEITURA = 'Seu nível de acesso nesta entidade é apenas leitura — você pode visualizar, mas não lançar créditos.'

/**
 * Lançamento (constituição) do crédito tributário — estágio de competência da receita
 * tributária. Reconhece o direito a receber + VPA (E550) antes da arrecadação. Tela única:
 * form + lista. A arrecadação posterior (tela de Arrecadação) baixa o ativo (E560).
 */
export async function appLancamentoTributarioRoutes(app: FastifyInstance) {
  const svc = new LancamentoTributarioService(app.prisma)
  const previsoesSvc = new PrevisoesReceitaService(app.prisma)

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

  async function renderTela(req: FastifyRequest, reply: FastifyReply, entidade: unknown, opts: { erro?: string; status?: number; valores?: Record<string, unknown> } = {}) {
    const { entidadeId, ano, nivel } = req.contexto
    const orcamento = await carregarOrcamento(entidadeId, ano)
    const [lancamentos, previsoes] = await Promise.all([
      orcamento ? svc.listar(orcamento.id) : Promise.resolve([]),
      orcamento ? previsoesSvc.listar(orcamento.id) : Promise.resolve([]),
    ])
    // só naturezas tributárias (categoria 1, origem 1 = impostos/taxas/contrib. de melhoria)
    const previsoesTributarias = previsoes.filter((p: { contaReceita: { codigo: string } }) => /^1\.1\./.test(p.contaReceita.codigo))
    if (opts.status) reply.code(opts.status)
    return reply.view('app/lancamento-tributario', {
      entidade,
      ano,
      nivel,
      orcamento,
      lancamentos,
      previsoes: previsoesTributarias,
      valores: opts.valores ?? {},
      podeEscrever: podeEscrever(nivel),
      erro: opts.erro ?? null,
      layout: null,
    })
  }

  // ── Tela única: form + lista ──────────────────────────────────
  app.get('/orcamento/lancamento-tributario', async (req, reply) => {
    const entidade = await carregarEntidade(req, reply)
    if (!entidade) return
    return renderTela(req, reply, entidade)
  })

  // ── Constituir o crédito ──────────────────────────────────────
  app.post('/orcamento/lancamento-tributario', async (req, reply) => {
    const { entidadeId, ano, nivel } = req.contexto
    const entidade = await carregarEntidade(req, reply)
    if (!entidade) return
    if (!podeEscrever(nivel)) return renderTela(req, reply, entidade, { erro: ERRO_LEITURA, status: 403 })
    const orcamento = await carregarOrcamento(entidadeId, ano)
    if (!orcamento) return renderTela(req, reply, entidade, { erro: 'Não há orçamento (LOA) neste exercício.' })

    const body = (req.body ?? {}) as Record<string, unknown>
    const dados = {
      previsaoId: String(body['previsaoId'] ?? ''),
      data: String(body['data'] ?? ''),
      valor: String(body['valor'] ?? ''),
      vencimento: String(body['vencimento'] ?? ''),
      devedorNome: String(body['devedorNome'] ?? ''),
      devedorDocumento: String(body['devedorDocumento'] ?? ''),
      documento: String(body['documento'] ?? ''),
      historico: String(body['historico'] ?? ''),
      criadoPorId: req.user.sub,
    }
    try {
      await svc.criar(orcamento.id, dados)
      return reply.redirect('/app/orcamento/lancamento-tributario')
    } catch (e) {
      if (e instanceof ErroNegocio) return renderTela(req, reply, entidade, { erro: e.message, status: statusDeErro(e.code), valores: dados })
      throw e
    }
  })

  // ── Excluir (reverte os contábeis) ────────────────────────────
  app.post<{ Params: { id: string } }>('/orcamento/lancamento-tributario/:id/excluir', async (req, reply) => {
    const { entidadeId, nivel } = req.contexto
    const entidade = await carregarEntidade(req, reply)
    if (!entidade) return
    if (!podeEscrever(nivel)) return renderTela(req, reply, entidade, { erro: ERRO_LEITURA, status: 403 })
    try {
      await svc.excluir(req.params.id, entidadeId)
    } catch (e) {
      if (e instanceof ErroNegocio) return renderTela(req, reply, entidade, { erro: e.message, status: statusDeErro(e.code) })
      throw e
    }
    return reply.redirect('/app/orcamento/lancamento-tributario')
  })

  // ── Trilha contábil de um lançamento ──────────────────────────
  app.get<{ Params: { id: string } }>('/orcamento/lancamento-tributario/:id/lancamentos', async (req, reply) => {
    const entidade = await carregarEntidade(req, reply)
    if (!entidade) return
    try {
      const trilha = await svc.trilhaDoLancamento(req.params.id, req.contexto.entidadeId)
      return reply.view('app/lancamento-tributario-trilha', { entidade, ano: req.contexto.ano, lancamento: trilha.lancamento, eventos: trilha.eventos, layout: null })
    } catch (e) {
      if (e instanceof ErroNegocio) return reply.code(statusDeErro(e.code)).view('404', { caminho: req.url })
      throw e
    }
  })
}
