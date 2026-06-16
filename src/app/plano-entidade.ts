import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { ErroNegocio, statusDeErro } from '../errors.js'

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
  buscarPorId(id: string): Promise<{ id: string; entidadeId: string; admiteMovimento: boolean } | null>
  sugerirCodigo(parentId: string): Promise<string>
  desdobrar(contaId: string, dados: { codigo: string; descricao: string }): Promise<unknown>
  excluir(id: string): Promise<unknown>
}

export type ConfigPlano = {
  /** Rota Fastify SEM o prefixo `/app` (ex.: `/contas`). */
  rota: string
  titulo: string
  descricao: string
  servico: ServicoPlano
  listarFlat: (entidadeId: string, ano: number) => Promise<ContaEntidade[]>
}

type RenderOpts = {
  erro?: string
  status?: number
  desdobrar?: { id: string; codigo?: string; descricao?: string } | null
  sugestao?: string
}

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
    const idsPais = new Set(contas.map((c) => c.parentId).filter(Boolean))
    const linhas = contas.map((c) => ({ ...c, temFilhos: idsPais.has(c.id) }))
    if (opts.status) reply.code(opts.status)
    return reply.view('app/plano-entidade', {
      base: url,
      titulo: cfg.titulo,
      descricao: cfg.descricao,
      entidade,
      ano,
      nivel,
      contas: linhas,
      podeEscrever: podeEscrever(nivel),
      desdobrar: opts.desdobrar ?? null,
      sugestao: opts.sugestao ?? '',
      erro: opts.erro ?? null,
      layout: null,
    })
  }

  /** Busca a conta garantindo que pertence à entidade do contexto (senão null). */
  async function buscarNoEscopo(id: string, entidadeId: string) {
    const conta = await cfg.servico.buscarPorId(id)
    return conta && conta.entidadeId === entidadeId ? conta : null
  }

  // ── Lista (+ form de desdobrar quando ?desdobrar=<id>) ──────────────────────
  app.get<{ Querystring: { desdobrar?: string } }>(cfg.rota, async (req, reply) => {
    const entidade = await carregarEntidade(req, reply)
    if (!entidade) return
    const alvo = req.query.desdobrar?.trim()
    if (alvo) {
      const conta = await buscarNoEscopo(alvo, req.contexto.entidadeId)
      if (conta && conta.admiteMovimento) {
        const sugestao = await cfg.servico.sugerirCodigo(conta.id)
        return renderLista(req, reply, entidade, { desdobrar: { id: conta.id }, sugestao })
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
