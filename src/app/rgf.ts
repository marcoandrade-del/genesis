import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { RgfCadastrosService, CATEGORIAS_DIVIDA, TIPOS_GARANTIA, TIPOS_OPERACAO_CREDITO } from '../services/rgf-cadastros.js'
import { ErroNegocio } from '../errors.js'

const podeEscrever = (nivel: string) => nivel === 'ESCRITA' || nivel === 'ADMIN'
const ERRO_LEITURA = 'Seu nível de acesso nesta entidade é apenas leitura — você não pode alterar os cadastros.'

/**
 * Cadastros de apoio do RGF (MDF 9ª ed.) numa tela única: Dívida Consolidada
 * (Anexo 2), Garantias (Anexo 3) e Operações de Crédito (Anexo 4). Os
 * demonstrativos consomem estes dados via RgfCadastrosService.totais.
 */
export async function appRgfRoutes(app: FastifyInstance) {
  const svc = new RgfCadastrosService(app.prisma)

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

  async function render(req: FastifyRequest, reply: FastifyReply, entidade: unknown, opts: { erro?: string; aviso?: string; status?: number } = {}) {
    const { entidadeId, ano, nivel } = req.contexto
    const [divida, garantias, operacoes, totais] = await Promise.all([
      svc.listarDivida(entidadeId, ano),
      svc.listarGarantias(entidadeId, ano),
      svc.listarOperacoes(entidadeId, ano),
      svc.totais(entidadeId, ano),
    ])
    if (opts.status) reply.code(opts.status)
    return reply.view('app/rgf-cadastros', {
      entidade,
      ano,
      nivel,
      podeEscrever: podeEscrever(nivel),
      divida,
      garantias,
      operacoes,
      totais,
      categoriasDivida: CATEGORIAS_DIVIDA,
      tiposGarantia: TIPOS_GARANTIA,
      tiposOperacao: TIPOS_OPERACAO_CREDITO,
      erro: opts.erro ?? null,
      aviso: opts.aviso ?? null,
      layout: null,
    })
  }

  app.get('/orcamento/rgf/cadastros', async (req, reply) => {
    const entidade = await carregarEntidade(req, reply)
    if (!entidade) return
    return render(req, reply, entidade)
  })

  type Acao = (entidadeId: string, ano: number, body: Record<string, unknown>) => Promise<unknown>
  const post = (rota: string, aviso: string, acao: Acao) => {
    app.post(rota, async (req, reply) => {
      const entidade = await carregarEntidade(req, reply)
      if (!entidade) return
      const { entidadeId, ano, nivel } = req.contexto
      if (!podeEscrever(nivel)) return render(req, reply, entidade, { erro: ERRO_LEITURA, status: 403 })
      try {
        await acao(entidadeId, ano, (req.body ?? {}) as Record<string, unknown>)
      } catch (e) {
        if (e instanceof ErroNegocio) return render(req, reply, entidade, { erro: e.message, status: 400 })
        throw e
      }
      return render(req, reply, entidade, { aviso })
    })
  }

  post('/orcamento/rgf/cadastros/divida', 'Item da dívida registrado.', (eId, ano, b) => svc.criarDivida(eId, ano, b))
  post('/orcamento/rgf/cadastros/divida/excluir', 'Item da dívida excluído.', (eId, _ano, b) => svc.excluirDivida(eId, String(b['id'] ?? '')))
  post('/orcamento/rgf/cadastros/garantia', 'Garantia registrada.', (eId, ano, b) => svc.criarGarantia(eId, ano, b))
  post('/orcamento/rgf/cadastros/garantia/excluir', 'Garantia excluída.', (eId, _ano, b) => svc.excluirGarantia(eId, String(b['id'] ?? '')))
  post('/orcamento/rgf/cadastros/operacao', 'Operação de crédito registrada.', (eId, ano, b) => svc.criarOperacao(eId, ano, b))
  post('/orcamento/rgf/cadastros/operacao/excluir', 'Operação de crédito excluída.', (eId, _ano, b) => svc.excluirOperacao(eId, String(b['id'] ?? '')))
}
