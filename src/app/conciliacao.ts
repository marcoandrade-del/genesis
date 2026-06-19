import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { ConciliacaoBancariaService } from '../services/conciliacao-bancaria.js'
import { ContasBancariasService } from '../services/contas-bancarias.js'
import { ErroNegocio, statusDeErro } from '../errors.js'

const podeEscrever = (nivel: string) => nivel === 'ESCRITA' || nivel === 'ADMIN'
const ERRO_LEITURA = 'Seu nível de acesso nesta entidade é apenas leitura — você pode visualizar, mas não conciliar.'

/**
 * Conciliação bancária (área do operador): por conta bancária, casa os créditos do
 * extrato com as arrecadações já registradas na conta. Não cria arrecadação — audita
 * e vincula. Entrada do extrato: manual ou import (CSV/OFX colado; CNAB fase 2).
 */
export async function appConciliacaoRoutes(app: FastifyInstance) {
  const svc = new ConciliacaoBancariaService(app.prisma)
  const contasSvc = new ContasBancariasService(app.prisma)

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

  async function render(
    req: FastifyRequest,
    reply: FastifyReply,
    entidade: unknown,
    contaId: string | null,
    opts: { erro?: string; aviso?: string; status?: number } = {},
  ) {
    const { entidadeId, ano, nivel } = req.contexto
    const contas = (await contasSvc.listar(entidadeId, ano)).filter((c) => c.ativa)
    const painel = contaId ? await svc.painel(contaId, entidadeId, ano).catch(() => null) : null
    if (opts.status) reply.code(opts.status)
    return reply.view('app/conciliacao', {
      entidade,
      ano,
      nivel,
      contas,
      contaId: painel ? contaId : null,
      painel,
      podeEscrever: podeEscrever(nivel),
      erro: opts.erro ?? null,
      aviso: opts.aviso ?? null,
      layout: null,
    })
  }

  const voltar = (reply: FastifyReply, contaId: string) => reply.redirect(`/app/orcamento/conciliacao?conta=${contaId}`)

  // Boilerplate de mutação: exige escrita, resolve a conta do body, trata ErroNegocio.
  async function comEscrita(req: FastifyRequest, reply: FastifyReply, acao: (contaId: string, entidadeId: string) => Promise<unknown>) {
    const { entidadeId, nivel } = req.contexto
    const entidade = await carregarEntidade(req, reply)
    if (!entidade) return
    const body = (req.body ?? {}) as Record<string, unknown>
    const contaId = String(body['contaBancariaId'] ?? '')
    if (!podeEscrever(nivel)) return render(req, reply, entidade, contaId || null, { erro: ERRO_LEITURA, status: 403 })
    try {
      await acao(contaId, entidadeId)
      return voltar(reply, contaId)
    } catch (e) {
      if (e instanceof ErroNegocio) return render(req, reply, entidade, contaId || null, { erro: e.message, status: statusDeErro(e.code) })
      throw e
    }
  }

  // ── Painel (seleção de conta + conciliação) ───────────────────
  app.get<{ Querystring: { conta?: string } }>('/orcamento/conciliacao', async (req, reply) => {
    const entidade = await carregarEntidade(req, reply)
    if (!entidade) return
    return render(req, reply, entidade, req.query.conta?.trim() || null)
  })

  // ── Importar extrato (CSV/OFX colado) ─────────────────────────
  app.post('/orcamento/conciliacao/importar', async (req, reply) =>
    comEscrita(req, reply, async (contaId, entidadeId) => {
      const body = (req.body ?? {}) as Record<string, unknown>
      const formato = String(body['formato'] ?? '') as 'CSV' | 'OFX' | 'CNAB'
      const conteudo = String(body['conteudo'] ?? '')
      if (!conteudo.trim()) throw new ErroNegocio('REQUISICAO_INVALIDA', 'Cole o conteúdo do extrato (CSV ou OFX).')
      await svc.importar(contaId, entidadeId, formato, conteudo)
    }),
  )

  // ── Lançar movimento manual ───────────────────────────────────
  app.post('/orcamento/conciliacao/manual', async (req, reply) =>
    comEscrita(req, reply, async (contaId, entidadeId) => {
      const body = (req.body ?? {}) as Record<string, unknown>
      await svc.registrarManual(contaId, entidadeId, {
        data: String(body['data'] ?? ''),
        valor: String(body['valor'] ?? ''),
        sentido: String(body['sentido'] ?? 'CREDITO'),
        historico: String(body['historico'] ?? ''),
        documento: String(body['documento'] ?? ''),
      })
    }),
  )

  // ── Auto-conciliar (valor + data) ─────────────────────────────
  app.post('/orcamento/conciliacao/sugerir', async (req, reply) =>
    comEscrita(req, reply, (contaId, entidadeId) => svc.sugerir(contaId, entidadeId, req.contexto.ano)),
  )

  // ── Conciliar manualmente ─────────────────────────────────────
  app.post('/orcamento/conciliacao/conciliar', async (req, reply) =>
    comEscrita(req, reply, (_contaId, entidadeId) => {
      const body = (req.body ?? {}) as Record<string, unknown>
      return svc.conciliar(String(body['movimentoId'] ?? ''), String(body['arrecadacaoId'] ?? ''), entidadeId)
    }),
  )

  // ── Desfazer conciliação ──────────────────────────────────────
  app.post('/orcamento/conciliacao/desconciliar', async (req, reply) =>
    comEscrita(req, reply, (_contaId, entidadeId) => svc.desconciliar(String(((req.body ?? {}) as Record<string, unknown>)['movimentoId'] ?? ''), entidadeId)),
  )

  // ── Excluir movimento do extrato ──────────────────────────────
  app.post('/orcamento/conciliacao/excluir', async (req, reply) =>
    comEscrita(req, reply, (_contaId, entidadeId) => svc.excluirMovimento(String(((req.body ?? {}) as Record<string, unknown>)['movimentoId'] ?? ''), entidadeId)),
  )
}
