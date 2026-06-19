import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { ArrecadacoesService } from '../services/arrecadacoes.js'
import { PrevisoesReceitaService } from '../services/previsoes-receita.js'
import { ContasBancariasService } from '../services/contas-bancarias.js'
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
  const previsoesSvc = new PrevisoesReceitaService(app.prisma)
  const contasBancSvc = new ContasBancariasService(app.prisma)

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
    if (opts.status) reply.code(opts.status)
    return reply.view('app/arrecadacao', {
      entidade,
      ano,
      nivel,
      orcamento,
      resumo,
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
