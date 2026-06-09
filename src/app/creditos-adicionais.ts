import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { CreditosAdicionaisService } from '../services/creditos-adicionais.js'
import { DotacoesDespesaService } from '../services/dotacoes-despesa.js'
import { ErroNegocio, statusDeErro } from '../errors.js'

const podeEscrever = (nivel: string) => nivel === 'ESCRITA' || nivel === 'ADMIN'
const asArray = <T>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v])

const ERRO_LEITURA =
  'Seu nível de acesso nesta entidade é apenas leitura — você pode visualizar, mas não lançar créditos adicionais.'

/**
 * Créditos adicionais (Lei 4.320) na área do operador, escopados ao contexto
 * entidade+exercício. Aplicação imediata: criar o crédito altera o
 * `valorAutorizado` das dotações. Escrita exige ESCRITA/ADMIN; LEITURA só vê.
 */
export async function appCreditosAdicionaisRoutes(app: FastifyInstance) {
  const svc = new CreditosAdicionaisService(app.prisma)
  const dotacoesSvc = new DotacoesDespesaService(app.prisma)

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

  // ── Hub: lista de créditos do exercício ──────────────────────────────────────
  app.get('/orcamento/creditos', async (req, reply) => {
    const { entidadeId, ano, nivel } = req.contexto
    const entidade = await carregarEntidade(req, reply)
    if (!entidade) return
    const orcamento = await carregarOrcamento(entidadeId, ano)
    const creditos = orcamento ? await svc.listar(orcamento.id) : []
    return reply.view('app/creditos', {
      entidade, ano, nivel, orcamento, creditos, podeEscrever: podeEscrever(nivel), layout: null,
    })
  })

  // ── Formulário de novo crédito ───────────────────────────────────────────────
  async function renderForm(
    reply: FastifyReply,
    entidade: unknown,
    ano: number,
    nivel: string,
    dotacoes: unknown[],
    valores: { tipo?: string; numero?: string; data?: string; atoLegal?: string; justificativa?: string; itens?: unknown[] },
    opts: { erro?: string; status?: number } = {},
  ) {
    if (opts.status) reply.code(opts.status)
    return reply.view('app/creditos-form', {
      entidade, ano, nivel, dotacoes, valores, erro: opts.erro ?? null, layout: null,
    })
  }

  app.get('/orcamento/creditos/novo', async (req, reply) => {
    const { entidadeId, ano, nivel } = req.contexto
    const entidade = await carregarEntidade(req, reply)
    if (!entidade) return
    if (!podeEscrever(nivel)) {
      const orcamento = await carregarOrcamento(entidadeId, ano)
      const creditos = orcamento ? await svc.listar(orcamento.id) : []
      return reply.code(403).view('app/creditos', { entidade, ano, nivel, orcamento, creditos, podeEscrever: false, erro: ERRO_LEITURA, layout: null })
    }
    const orcamento = await carregarOrcamento(entidadeId, ano)
    if (!orcamento) {
      return reply.view('app/creditos', { entidade, ano, nivel, orcamento: null, creditos: [], podeEscrever: true, erro: 'Não há orçamento (LOA) neste exercício.', layout: null })
    }
    const dotacoes = await dotacoesSvc.listar(orcamento.id)
    return renderForm(reply, entidade, ano, nivel, dotacoes, {})
  })

  // ── Criar (aplica de imediato) ───────────────────────────────────────────────
  app.post('/orcamento/creditos', async (req, reply) => {
    const { entidadeId, ano, nivel } = req.contexto
    const entidade = await carregarEntidade(req, reply)
    if (!entidade) return
    const orcamento = await carregarOrcamento(entidadeId, ano)
    if (!podeEscrever(nivel)) {
      const creditos = orcamento ? await svc.listar(orcamento.id) : []
      return reply.code(403).view('app/creditos', { entidade, ano, nivel, orcamento, creditos, podeEscrever: false, erro: ERRO_LEITURA, layout: null })
    }
    if (!orcamento) {
      return reply.view('app/creditos', { entidade, ano, nivel, orcamento: null, creditos: [], podeEscrever: true, erro: 'Não há orçamento (LOA) neste exercício.', layout: null })
    }

    const body = (req.body ?? {}) as Record<string, unknown>
    const dotacaoIds = asArray(body['dotacaoId'] as string | string[] | undefined)
    const operacoes = asArray(body['operacao'] as string | string[] | undefined)
    const valoresItem = asArray(body['valor'] as string | string[] | undefined)
    const itens = dotacaoIds.map((d, i) => ({ dotacaoId: d, operacao: operacoes[i] ?? '', valor: valoresItem[i] ?? '' }))

    const dados = {
      tipo: String(body['tipo'] ?? ''),
      numero: String(body['numero'] ?? ''),
      data: String(body['data'] ?? ''),
      atoLegal: String(body['atoLegal'] ?? ''),
      justificativa: String(body['justificativa'] ?? ''),
      itens,
    }

    try {
      await svc.criar(orcamento.id, dados)
      return reply.redirect('/app/orcamento/creditos')
    } catch (e) {
      if (e instanceof ErroNegocio) {
        const dotacoes = await dotacoesSvc.listar(orcamento.id)
        return renderForm(reply, entidade, ano, nivel, dotacoes, { ...dados }, { erro: e.message, status: statusDeErro(e.code) })
      }
      throw e
    }
  })

  // ── Detalhe ──────────────────────────────────────────────────────────────────
  app.get<{ Params: { id: string } }>('/orcamento/creditos/:id', async (req, reply) => {
    const { entidadeId, ano, nivel } = req.contexto
    const entidade = await carregarEntidade(req, reply)
    if (!entidade) return
    const credito = await svc.buscarPorId(req.params.id)
    if (!credito || credito.orcamento.entidadeId !== entidadeId) {
      const orcamento = await carregarOrcamento(entidadeId, ano)
      const creditos = orcamento ? await svc.listar(orcamento.id) : []
      return reply.code(404).view('app/creditos', { entidade, ano, nivel, orcamento, creditos, podeEscrever: podeEscrever(nivel), erro: 'Crédito não encontrado.', layout: null })
    }
    return reply.view('app/creditos-detalhe', { entidade, ano, nivel, credito, layout: null })
  })
}
