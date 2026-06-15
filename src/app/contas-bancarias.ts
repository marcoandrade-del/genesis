import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { ContasBancariasService, type DadosContaBancaria } from '../services/contas-bancarias.js'
import { ErroNegocio, statusDeErro } from '../errors.js'

const podeEscrever = (nivel: string) => nivel === 'ESCRITA' || nivel === 'ADMIN'

const ERRO_LEITURA =
  'Seu nível de acesso nesta entidade é apenas leitura — você pode visualizar, mas não alterar contas bancárias.'

/**
 * Contas bancárias da entidade (padrão Febraban), vinculadas às fontes de
 * recurso. Tela única: lista + form (criar/editar) + inativar/reativar/excluir.
 * O vínculo conta×fonte alimenta a trava de pagamento na emissão de OP.
 */
export async function appContasBancariasRoutes(app: FastifyInstance) {
  const svc = new ContasBancariasService(app.prisma)

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

  async function renderTela(
    req: FastifyRequest,
    reply: FastifyReply,
    entidade: unknown,
    opts: { erro?: string; status?: number; valores?: Record<string, unknown>; editando?: string } = {},
  ) {
    const { entidadeId, ano, nivel } = req.contexto
    const [contas, fontes] = await Promise.all([svc.listar(entidadeId, ano), svc.listarFontes(entidadeId, ano)])
    if (opts.status) reply.code(opts.status)
    return reply.view('app/contas-bancarias', {
      entidade,
      ano,
      nivel,
      contas,
      fontes,
      valores: opts.valores ?? {},
      editando: opts.editando ?? null,
      podeEscrever: podeEscrever(nivel),
      erro: opts.erro ?? null,
      layout: null,
    })
  }

  function lerDados(body: Record<string, unknown>): DadosContaBancaria {
    return {
      fonteCodigo: String(body['fonteCodigo'] ?? ''),
      bancoCodigo: String(body['bancoCodigo'] ?? ''),
      bancoNome: String(body['bancoNome'] ?? ''),
      agencia: String(body['agencia'] ?? ''),
      agenciaDv: String(body['agenciaDv'] ?? ''),
      numero: String(body['numero'] ?? ''),
      numeroDv: String(body['numeroDv'] ?? ''),
      descricao: String(body['descricao'] ?? ''),
    }
  }

  // Boilerplate das mutações: exige escrita e re-renderiza com o erro de negócio.
  async function comEscrita(
    req: FastifyRequest,
    reply: FastifyReply,
    acao: (entidadeId: string, ano: number) => Promise<unknown>,
    valoresErro?: Record<string, unknown>,
    editando?: string,
  ) {
    const { entidadeId, ano, nivel } = req.contexto
    const entidade = await carregarEntidade(req, reply)
    if (!entidade) return
    if (!podeEscrever(nivel)) {
      return renderTela(req, reply, entidade, { erro: ERRO_LEITURA, status: 403 })
    }
    try {
      await acao(entidadeId, ano)
      return reply.redirect('/app/contas-bancarias')
    } catch (e) {
      if (e instanceof ErroNegocio) {
        return renderTela(req, reply, entidade, {
          erro: e.message,
          status: statusDeErro(e.code),
          ...(valoresErro ? { valores: valoresErro } : {}),
          ...(editando ? { editando } : {}),
        })
      }
      throw e
    }
  }

  // ── Tela única: lista + form ──────────────────────────────────
  app.get<{ Querystring: { editar?: string } }>('/contas-bancarias', async (req, reply) => {
    const entidade = await carregarEntidade(req, reply)
    if (!entidade) return
    const editarId = req.query.editar?.trim()
    if (editarId) {
      const conta = (await svc.listar(req.contexto.entidadeId, req.contexto.ano)).find((c) => c.id === editarId)
      if (conta) return renderTela(req, reply, entidade, { editando: conta.id, valores: conta as never })
    }
    return renderTela(req, reply, entidade)
  })

  // ── Criar ─────────────────────────────────────────────────────
  app.post('/contas-bancarias', async (req, reply) => {
    const dados = lerDados((req.body ?? {}) as Record<string, unknown>)
    return comEscrita(req, reply, (eid, ano) => svc.criar(eid, ano, dados), dados as never)
  })

  // ── Atualizar ─────────────────────────────────────────────────
  app.post<{ Params: { id: string } }>('/contas-bancarias/:id', async (req, reply) => {
    const dados = lerDados((req.body ?? {}) as Record<string, unknown>)
    return comEscrita(req, reply, (eid, ano) => svc.atualizar(req.params.id, eid, ano, dados), dados as never, req.params.id)
  })

  // ── Inativar/reativar ─────────────────────────────────────────
  app.post<{ Params: { id: string } }>('/contas-bancarias/:id/alternar', async (req, reply) =>
    comEscrita(req, reply, (eid) => svc.alternarAtiva(req.params.id, eid)),
  )

  // ── Excluir (só conta nunca usada em OP) ──────────────────────
  app.post<{ Params: { id: string } }>('/contas-bancarias/:id/excluir', async (req, reply) =>
    comEscrita(req, reply, (eid) => svc.excluir(req.params.id, eid)),
  )
}
