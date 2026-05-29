import type { FastifyInstance } from 'fastify'
import { ContasContabilEntidadeService } from '../services/contas-contabil-entidade.js'

export async function adminContasContabilEntidadeRoutes(app: FastifyInstance) {
  const service = new ContasContabilEntidadeService(app.prisma)

  const anoValido = (ano: string) => {
    const n = parseInt(ano, 10)
    return Number.isNaN(n) || n < 1900 || n > 9999 ? null : n
  }

  const carregarEntidades = () =>
    app.prisma.entidade.findMany({
      orderBy: { nome: 'asc' },
      include: { municipio: { include: { estado: { select: { sigla: true } } } } },
    })

  async function comTemFilhos<T extends { id: string }>(contas: T[]): Promise<(T & { temFilhos: boolean })[]> {
    if (contas.length === 0) return []
    const ids = contas.map((c) => c.id)
    const grupos = await app.prisma.contaContabilEntidade.groupBy({
      by: ['parentId'],
      where: { parentId: { in: ids } },
      _count: { _all: true },
    })
    const setComFilhos = new Set(grupos.map((g) => g.parentId).filter((v): v is string => v !== null))
    return contas.map((c) => ({ ...c, temFilhos: setComFilhos.has(c.id) }))
  }

  app.get<{ Querystring: { entidadeId?: string; ano?: string } }>('/', async (req, reply) => {
    const entidadeId = req.query.entidadeId?.trim() || ''
    const ano = anoValido(req.query.ano?.trim() || '') ?? new Date().getFullYear()
    const entidades = await carregarEntidades()

    if (!entidadeId) {
      return reply.view('contas-contabil-entidade/index', {
        title: 'Plano de Contas (Entidade) — Gênesis Admin',
        active: 'contas-contabil-entidade', userEmail: req.user.email,
        entidades, entidadeSelecionada: null, ano, raizes: [],
      }, { layout: 'layouts/main' })
    }

    const entidade = await app.prisma.entidade.findUnique({
      where: { id: entidadeId },
      include: { municipio: { include: { estado: { select: { sigla: true } } } } },
    })
    if (!entidade) return reply.status(404).send('Entidade não encontrada.')

    const raizes = await comTemFilhos(await service.listarRaizes(entidadeId, ano))
    return reply.view('contas-contabil-entidade/index', {
      title: 'Plano de Contas (Entidade) — Gênesis Admin',
      active: 'contas-contabil-entidade', userEmail: req.user.email,
      entidades, entidadeSelecionada: entidade, ano, raizes,
    }, { layout: 'layouts/main' })
  })

  app.get<{ Params: { id: string } }>('/:id/filhos', async (req, reply) => {
    const pai = await service.buscarPorId(req.params.id)
    if (!pai) return reply.status(404).send('Conta não encontrada.')
    const filhos = await comTemFilhos(await service.listarFilhos(req.params.id))
    return reply.view('contas-contabil-entidade/filhos', { filhos })
  })

  app.get<{ Params: { id: string } }>('/:id/desdobrar', async (req, reply) => {
    const conta = await service.buscarPorId(req.params.id)
    if (!conta) return reply.status(404).send('Conta não encontrada.')
    if (!conta.admiteMovimento) {
      return reply.status(409).send('Só contas analíticas podem ser desdobradas.')
    }
    const sugestao = await service.sugerirCodigo(conta.id)
    return reply.view('contas-contabil-entidade/desdobrar', { conta, sugestao, erro: null })
  })

  app.post<{ Params: { id: string }; Body: { codigo: string; descricao: string } }>(
    '/:id/desdobrar',
    async (req, reply) => {
      const { codigo, descricao } = req.body
      try {
        const filho = await service.desdobrar(req.params.id, { codigo, descricao })
        return reply
          .header('HX-Redirect', `/admin/contas-contabil-entidade?entidadeId=${filho.entidadeId}&ano=${filho.ano}`)
          .status(204).send()
      } catch (e: unknown) {
        const conta = await service.buscarPorId(req.params.id)
        if (!conta) return reply.status(404).send('Conta não encontrada.')
        const sugestao = await service.sugerirCodigo(conta.id)
        const erro = e instanceof Error ? e.message : 'Erro ao desdobrar.'
        return reply.view('contas-contabil-entidade/desdobrar', { conta, sugestao, erro })
      }
    },
  )
}
