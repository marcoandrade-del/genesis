import type { FastifyInstance } from 'fastify'
import { PlanosContasDespesaService } from '../services/planos-contas-despesa.js'
import { ImportadorPlanoDespesaService } from '../services/importador-plano-despesa.js'
import { erroHttp, tratarErro } from '../errors.js'

const LIMITE_CSV_IMPORTACAO = 5 * 1024 * 1024

export async function adminPlanosContasDespesaRoutes(app: FastifyInstance) {
  const service = new PlanosContasDespesaService(app.prisma)
  const importador = new ImportadorPlanoDespesaService(app.prisma)

  // ── LIST ────────────────────────────────────────────────────────────────────
  app.get<{ Querystring: { modeloContabilId?: string } }>('/', async (req, reply) => {
    const modeloContabilId = req.query.modeloContabilId?.trim() || ''
    const [modelos, planos] = await Promise.all([
      app.prisma.modeloContabil.findMany({
        orderBy: { descricao: 'asc' },
        select: { id: true, descricao: true, ativo: true },
      }),
      app.prisma.planoContasDespesa.findMany({
        where: modeloContabilId ? { modeloContabilId } : undefined,
        orderBy: [{ modeloContabilId: 'asc' }, { ano: 'desc' }],
        include: {
          modeloContabil: { select: { id: true, descricao: true } },
          _count: { select: { contas: true } },
        },
      }),
    ])
    return reply.view(
      'planos-contas-despesa/index',
      {
        title: 'Planos de Contas da Despesa — Gênesis Admin',
        active: 'planos-contas-despesa',
        userEmail: req.user.email,
        modelos,
        planos,
        modeloSelecionado: modeloContabilId,
      },
      { layout: 'layouts/main' },
    )
  })

  // ── FORM (novo) ─────────────────────────────────────────────────────────────
  app.get('/form', async (_req, reply) => {
    const modelos = await app.prisma.modeloContabil.findMany({
      where: { ativo: true },
      orderBy: { descricao: 'asc' },
      select: { id: true, descricao: true },
    })
    return reply.view('planos-contas-despesa/form', { plano: null, modelos, erro: null })
  })

  // ── FORM (editar) ───────────────────────────────────────────────────────────
  app.get<{ Params: { id: string } }>('/:id/form', async (req, reply) => {
    const plano = await app.prisma.planoContasDespesa.findUnique({
      where: { id: req.params.id },
      include: { modeloContabil: { select: { id: true, descricao: true } } },
    })
    if (!plano) return reply.status(404).send('Plano de contas da despesa não encontrado.')
    return reply.view('planos-contas-despesa/form', { plano, modelos: [], erro: null })
  })

  // ── IMPORTAR (modal de upload) ──────────────────────────────────────────────
  app.get<{ Params: { id: string } }>('/:id/importar', async (req, reply) => {
    const plano = await app.prisma.planoContasDespesa.findUnique({
      where: { id: req.params.id },
      include: {
        modeloContabil: { select: { descricao: true } },
        _count: { select: { contas: true } },
      },
    })
    if (!plano) return reply.status(404).send('Plano de contas da despesa não encontrado.')
    return reply.view('planos-contas-despesa/importar', { plano })
  })

  // ── IMPORT submit (JSON body { csv }) ──────────────────────────────────────
  app.post<{ Params: { id: string }; Body: { csv: string } }>(
    '/:id/importar',
    { bodyLimit: LIMITE_CSV_IMPORTACAO },
    async (req, reply) => {
      const { csv } = req.body
      if (typeof csv !== 'string' || !csv.trim()) {
        return reply.status(400).send(erroHttp('REQUISICAO_INVALIDA', 'CSV vazio.'))
      }
      try {
        const resultado = await importador.importar(req.params.id, csv)
        return reply.send({ data: resultado })
      } catch (e) {
        return tratarErro(e, reply)
      }
    },
  )

  // ── CREATE ──────────────────────────────────────────────────────────────────
  app.post<{ Body: { descricao: string; ano: string; modeloContabilId: string } }>(
    '/',
    async (req, reply) => {
      const { descricao, ano, modeloContabilId } = req.body
      const reRenderErro = async (erro: string) => {
        const modelos = await app.prisma.modeloContabil.findMany({
          where: { ativo: true }, orderBy: { descricao: 'asc' }, select: { id: true, descricao: true },
        })
        return reply.view('planos-contas-despesa/form', { plano: null, modelos, erro })
      }
      if (!descricao?.trim()) return reRenderErro('A descrição é obrigatória.')
      if (!modeloContabilId?.trim()) return reRenderErro('Selecione um modelo contábil.')
      const anoNum = parseInt(ano, 10)
      if (Number.isNaN(anoNum) || anoNum < 1900 || anoNum > 9999) {
        return reRenderErro('Ano inválido (use um ano entre 1900 e 9999).')
      }
      try {
        await service.criar({ descricao: descricao.trim(), ano: anoNum, modeloContabilId })
        return reply.header('HX-Redirect', '/admin/planos-contas-despesa').status(204).send()
      } catch (e: unknown) {
        return reRenderErro(e instanceof Error ? e.message : 'Erro ao criar plano de contas da despesa.')
      }
    },
  )

  // ── UPDATE ──────────────────────────────────────────────────────────────────
  app.put<{ Params: { id: string }; Body: { descricao: string; ano: string } }>(
    '/:id',
    async (req, reply) => {
      const { descricao, ano } = req.body
      const reRenderErro = async (erro: string) => {
        const plano = await app.prisma.planoContasDespesa.findUnique({
          where: { id: req.params.id },
          include: { modeloContabil: { select: { id: true, descricao: true } } },
        })
        return reply.view('planos-contas-despesa/form', { plano, modelos: [], erro })
      }
      if (!descricao?.trim()) return reRenderErro('A descrição é obrigatória.')
      const anoNum = parseInt(ano, 10)
      if (Number.isNaN(anoNum) || anoNum < 1900 || anoNum > 9999) {
        return reRenderErro('Ano inválido (use um ano entre 1900 e 9999).')
      }
      try {
        await service.atualizar(req.params.id, { descricao: descricao.trim(), ano: anoNum })
        return reply.header('HX-Redirect', '/admin/planos-contas-despesa').status(204).send()
      } catch (e: unknown) {
        return reRenderErro(e instanceof Error ? e.message : 'Erro ao atualizar plano de contas da despesa.')
      }
    },
  )

  // ── DELETE ──────────────────────────────────────────────────────────────────
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
