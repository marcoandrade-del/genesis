import type { FastifyInstance } from 'fastify'
import { ContasDespesaService } from '../services/contas-despesa.js'

/**
 * Admin do Plano de Contas da Despesa, com árvore de expansão preguiçosa via
 * HTMX. Espelha adminContasReceitaRoutes. O código é imutável após criação
 * (atualização só toca descricao/admiteMovimento).
 */
export async function adminContasDespesaRoutes(app: FastifyInstance) {
  const service = new ContasDespesaService(app.prisma)

  const carregarPlanos = () =>
    app.prisma.planoContasDespesa.findMany({
      orderBy: [{ modeloContabilId: 'asc' }, { ano: 'desc' }],
      include: { modeloContabil: { select: { descricao: true } } },
    })

  async function comTemFilhos<T extends { id: string }>(contas: T[]): Promise<(T & { temFilhos: boolean })[]> {
    if (contas.length === 0) return []
    const ids = contas.map((c) => c.id)
    const grupos = await app.prisma.contaDespesa.groupBy({
      by: ['parentId'],
      where: { parentId: { in: ids } },
      _count: { _all: true },
    })
    const setComFilhos = new Set(grupos.map((g) => g.parentId).filter((v): v is string => v !== null))
    return contas.map((c) => ({ ...c, temFilhos: setComFilhos.has(c.id) }))
  }

  // ── Página principal ────────────────────────────────────────────────────────
  app.get<{ Querystring: { planoId?: string } }>('/', async (req, reply) => {
    const planoId = req.query.planoId?.trim() || ''
    const planos = await carregarPlanos()

    if (!planoId) {
      return reply.view('contas-despesa/index', {
        title: 'Contas da Despesa — Gênesis Admin',
        active: 'contas-despesa',
        userEmail: req.user.email,
        planos,
        planoSelecionado: null,
        raizes: [],
      }, { layout: 'layouts/main' })
    }

    const plano = await app.prisma.planoContasDespesa.findUnique({
      where: { id: planoId },
      include: { modeloContabil: { select: { descricao: true } } },
    })
    if (!plano) return reply.status(404).send('Plano de contas da despesa não encontrado.')

    const raizesBrutas = await app.prisma.contaDespesa.findMany({
      where: { planoId, parentId: null },
      orderBy: { codigo: 'asc' },
    })
    const raizes = await comTemFilhos(raizesBrutas)

    return reply.view('contas-despesa/index', {
      title: 'Contas da Despesa — Gênesis Admin',
      active: 'contas-despesa',
      userEmail: req.user.email,
      planos,
      planoSelecionado: plano,
      raizes,
    }, { layout: 'layouts/main' })
  })

  // ── Filhos diretos (fragmento p/ expansão HTMX) ────────────────────────────
  app.get<{ Params: { id: string } }>('/:id/filhos', async (req, reply) => {
    const pai = await app.prisma.contaDespesa.findUnique({ where: { id: req.params.id } })
    if (!pai) return reply.status(404).send('Conta não encontrada.')

    const filhosBrutos = await app.prisma.contaDespesa.findMany({
      where: { parentId: req.params.id },
      orderBy: { codigo: 'asc' },
    })
    const filhos = await comTemFilhos(filhosBrutos)
    return reply.view('contas-despesa/filhos', { filhos, paiId: pai.id })
  })

  // ── Form (novo) ─────────────────────────────────────────────────────────────
  app.get<{ Querystring: { planoId?: string; parentId?: string } }>('/form', async (req, reply) => {
    const planoId = req.query.planoId?.trim()
    if (!planoId) return reply.status(400).send('planoId é obrigatório.')
    const plano = await app.prisma.planoContasDespesa.findUnique({
      where: { id: planoId },
      include: { modeloContabil: { select: { descricao: true } } },
    })
    if (!plano) return reply.status(404).send('Plano de contas da despesa não encontrado.')

    const parentId = req.query.parentId?.trim()
    const parent = parentId
      ? await app.prisma.contaDespesa.findUnique({ where: { id: parentId } })
      : null
    if (parentId && !parent) return reply.status(404).send('Conta pai não encontrada.')

    return reply.view('contas-despesa/form', { conta: null, plano, parent, erro: null })
  })

  // ── Form (editar) ───────────────────────────────────────────────────────────
  app.get<{ Params: { id: string } }>('/:id/form', async (req, reply) => {
    const conta = await app.prisma.contaDespesa.findUnique({
      where: { id: req.params.id },
      include: {
        plano: { include: { modeloContabil: { select: { descricao: true } } } },
        parent: { select: { id: true, codigo: true, descricao: true } },
      },
    })
    if (!conta) return reply.status(404).send('Conta não encontrada.')

    return reply.view('contas-despesa/form', { conta, plano: conta.plano, parent: conta.parent, erro: null })
  })

  // ── Criar ───────────────────────────────────────────────────────────────────
  app.post<{ Body: { planoId: string; parentId?: string; codigo: string; descricao: string; admiteMovimento?: string } }>(
    '/',
    async (req, reply) => {
      const { planoId, parentId, codigo, descricao, admiteMovimento } = req.body
      const reRenderErro = async (erro: string) => {
        const plano = await app.prisma.planoContasDespesa.findUnique({
          where: { id: planoId },
          include: { modeloContabil: { select: { descricao: true } } },
        })
        const parent = parentId
          ? await app.prisma.contaDespesa.findUnique({ where: { id: parentId } })
          : null
        return reply.view('contas-despesa/form', { conta: null, plano, parent, erro })
      }
      if (!codigo?.trim()) return reRenderErro('O código é obrigatório.')
      if (!descricao?.trim()) return reRenderErro('A descrição é obrigatória.')

      try {
        await service.criar({
          planoId,
          codigo: codigo.trim(),
          descricao: descricao.trim(),
          ...(parentId?.trim() ? { parentId } : {}),
          admiteMovimento: admiteMovimento === 'true',
        })
        return reply.header('HX-Redirect', `/admin/contas-despesa?planoId=${planoId}`).status(204).send()
      } catch (e: unknown) {
        return reRenderErro(e instanceof Error ? e.message : 'Erro ao criar conta.')
      }
    },
  )

  // ── Atualizar (descricao + admiteMovimento) ────────────────────────────────
  app.put<{ Params: { id: string }; Body: { descricao: string; admiteMovimento?: string } }>(
    '/:id',
    async (req, reply) => {
      const { descricao, admiteMovimento } = req.body
      const reRenderErro = async (erro: string) => {
        const conta = await app.prisma.contaDespesa.findUnique({
          where: { id: req.params.id },
          include: {
            plano: { include: { modeloContabil: { select: { descricao: true } } } },
            parent: { select: { id: true, codigo: true, descricao: true } },
          },
        })
        return reply.view('contas-despesa/form', { conta, plano: conta?.plano, parent: conta?.parent, erro })
      }
      if (!descricao?.trim()) return reRenderErro('A descrição é obrigatória.')

      try {
        const conta = await app.prisma.contaDespesa.findUnique({ where: { id: req.params.id }, select: { planoId: true } })
        if (!conta) return reply.status(404).send('Conta não encontrada.')
        await service.atualizar(req.params.id, {
          descricao: descricao.trim(),
          admiteMovimento: admiteMovimento === 'true',
        })
        return reply.header('HX-Redirect', `/admin/contas-despesa?planoId=${conta.planoId}`).status(204).send()
      } catch (e: unknown) {
        return reRenderErro(e instanceof Error ? e.message : 'Erro ao atualizar conta.')
      }
    },
  )

  // ── Excluir ─────────────────────────────────────────────────────────────────
  app.delete<{ Params: { id: string } }>('/:id', async (req, reply) => {
    try {
      await service.excluir(req.params.id)
      return reply.status(200).send('')
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Erro ao excluir.'
      return reply.status(400).send(msg)
    }
  })
}
