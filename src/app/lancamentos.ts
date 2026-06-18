import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { LancamentosService } from '../services/lancamentos.js'
import { ErroNegocio, statusDeErro } from '../errors.js'

const podeEscrever = (nivel: string) => nivel === 'ESCRITA' || nivel === 'ADMIN'
const ERRO_LEITURA =
  'Seu nível de acesso nesta entidade é apenas leitura — você vê os lançamentos, mas não pode lançar.'

type LinhaForm = { codigo: string; tipo: string; valor: string }
type RenderOpts = { erro?: string; status?: number; valores?: { data: string; historico: string; itens: LinhaForm[] } }

/**
 * Área "Lançamentos" do operador: lista do exercício + lançamento contábil
 * MANUAL (partida dobrada). O escopo (entidade + ano) vem de `req.contexto`. A
 * regra de negócio (∑débito = ∑crédito, contas analíticas da entidade/ano,
 * atualização do resumo mensal) vive em `LancamentosService.criar`. Escrita
 * exige ESCRITA/ADMIN; LEITURA só visualiza.
 */
export async function appLancamentosRoutes(app: FastifyInstance) {
  const lancamentos = new LancamentosService(app.prisma)

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

  async function render(req: FastifyRequest, reply: FastifyReply, entidade: unknown, opts: RenderOpts = {}) {
    const { entidadeId, ano, nivel } = req.contexto
    const [lista, contas] = await Promise.all([
      lancamentos.listar(entidadeId, { dataInicio: `${ano}-01-01`, dataFim: `${ano}-12-31` }),
      // Catálogo das analíticas para o picker (datalist). Só folhas admitem movimento.
      app.prisma.contaContabilEntidade.findMany({
        where: { entidadeId, ano, admiteMovimento: true },
        select: { codigo: true, descricao: true },
        orderBy: { codigo: 'asc' },
      }),
    ])
    const total = lista.reduce((acc, l) => acc + Number(l.valor), 0)
    if (opts.status) reply.code(opts.status)
    return reply.view('app/lancamentos', {
      entidade,
      ano,
      nivel,
      lancamentos: lista,
      total,
      contas,
      podeEscrever: podeEscrever(nivel),
      anoMin: `${ano}-01-01`,
      anoMax: `${ano}-12-31`,
      erro: opts.erro ?? null,
      valores: opts.valores ?? null,
      layout: null,
    })
  }

  // ── Lista + formulário de novo lançamento ─────────────────────────────────
  app.get('/lancamentos', async (req, reply) => {
    const entidade = await carregarEntidade(req, reply)
    if (!entidade) return
    return render(req, reply, entidade)
  })

  // ── Lançar (manual, partida dobrada) ──────────────────────────────────────
  app.post<{ Body: Record<string, unknown> }>('/lancamentos', async (req, reply) => {
    const { entidadeId, ano, nivel } = req.contexto
    const entidade = await carregarEntidade(req, reply)
    if (!entidade) return
    if (!podeEscrever(nivel)) return render(req, reply, entidade, { erro: ERRO_LEITURA, status: 403 })

    const body = req.body ?? {}
    const data = String(body['data'] ?? '')
    const historico = String(body['historico'] ?? '')
    let linhas: LinhaForm[] = []
    try {
      const parsed = JSON.parse(String(body['itens'] ?? '[]'))
      if (Array.isArray(parsed)) linhas = parsed
    } catch {
      linhas = []
    }
    const valores = { data, historico, itens: linhas }

    try {
      if (!historico.trim()) throw new ErroNegocio('REQUISICAO_INVALIDA', 'O histórico é obrigatório.')

      // Resolve código → contaId (código é único por entidade/ano).
      const codigos = [...new Set(linhas.map((l) => String(l.codigo ?? '').trim()).filter(Boolean))]
      const contas = codigos.length
        ? await app.prisma.contaContabilEntidade.findMany({
            where: { entidadeId, ano, codigo: { in: codigos } },
            select: { id: true, codigo: true },
          })
        : []
      const idPorCodigo = new Map(contas.map((c) => [c.codigo, c.id]))

      const itens = linhas.map((l) => {
        const codigo = String(l.codigo ?? '').trim()
        const contaId = idPorCodigo.get(codigo)
        if (!contaId) {
          throw new ErroNegocio('REQUISICAO_INVALIDA', `Conta "${codigo || '(vazia)'}" não encontrada neste exercício.`)
        }
        return { contaId, tipo: (l.tipo === 'CREDITO' ? 'CREDITO' : 'DEBITO') as 'DEBITO' | 'CREDITO', valor: String(l.valor ?? '0') }
      })

      await lancamentos.criar({ entidadeId, data, historico: historico.trim(), itens, criadoPorId: req.user.sub })
      return reply.redirect('/app/lancamentos')
    } catch (e) {
      if (e instanceof ErroNegocio) return render(req, reply, entidade, { erro: e.message, status: statusDeErro(e.code), valores })
      throw e
    }
  })

  // ── Excluir lançamento (reverte o resumo mensal) ──────────────────────────
  app.post<{ Params: { id: string } }>('/lancamentos/:id/excluir', async (req, reply) => {
    const { entidadeId, nivel } = req.contexto
    const entidade = await carregarEntidade(req, reply)
    if (!entidade) return
    if (!podeEscrever(nivel)) return render(req, reply, entidade, { erro: ERRO_LEITURA, status: 403 })

    const lanc = await lancamentos.buscarPorId(req.params.id)
    if (!lanc || lanc.entidadeId !== entidadeId) {
      return render(req, reply, entidade, { erro: 'Lançamento não encontrado nesta entidade.', status: 404 })
    }
    try {
      await lancamentos.excluir(lanc.id)
      return reply.redirect('/app/lancamentos')
    } catch (e) {
      if (e instanceof ErroNegocio) return render(req, reply, entidade, { erro: e.message, status: statusDeErro(e.code) })
      throw e
    }
  })
}
