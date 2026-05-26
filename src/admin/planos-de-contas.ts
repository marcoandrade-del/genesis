import type { FastifyInstance } from 'fastify'
import { PlanosDeContasService } from '../services/planos-de-contas.js'
import { ImportadorPlanoContasService } from '../services/importador-plano-contas.js'
import { erroHttp, tratarErro } from '../errors.js'

// PCASP Estendido oficial ocupa ~640 KB; folga de ~8× para crescimento.
const LIMITE_CSV_IMPORTACAO = 5 * 1024 * 1024

export async function adminPlanosDeContasRoutes(app: FastifyInstance) {
  const service = new PlanosDeContasService(app.prisma)
  const importador = new ImportadorPlanoContasService(app.prisma)

  // ── LIST ────────────────────────────────────────────────────────────────────
  app.get<{ Querystring: { modeloContabilId?: string } }>('/', async (req, reply) => {
    const modeloContabilId = req.query.modeloContabilId?.trim() || ''
    const [modelos, planos] = await Promise.all([
      app.prisma.modeloContabil.findMany({
        orderBy: { descricao: 'asc' },
        select: { id: true, descricao: true, ativo: true },
      }),
      app.prisma.planoDeContas.findMany({
        where: modeloContabilId ? { modeloContabilId } : undefined,
        orderBy: [{ modeloContabilId: 'asc' }, { ano: 'desc' }],
        include: {
          modeloContabil: { select: { id: true, descricao: true } },
          _count: { select: { contas: true } },
        },
      }),
    ])
    return reply.view(
      'planos-de-contas/index',
      {
        title: 'Planos de Contas — Gênesis Admin',
        active: 'planos-de-contas',
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
    return reply.view('planos-de-contas/form', { plano: null, modelos, erro: null })
  })

  // ── FORM (editar) ───────────────────────────────────────────────────────────
  // Após criado, o modelo é imutável (mover plano entre modelos é destrutivo).
  app.get<{ Params: { id: string } }>('/:id/form', async (req, reply) => {
    const plano = await app.prisma.planoDeContas.findUnique({
      where: { id: req.params.id },
      include: { modeloContabil: { select: { id: true, descricao: true } } },
    })
    if (!plano) return reply.status(404).send('Plano de contas não encontrado.')
    return reply.view('planos-de-contas/form', { plano, modelos: [], erro: null })
  })

  // ── IMPORTAR (modal de upload) ──────────────────────────────────────────────
  app.get<{ Params: { id: string } }>('/:id/importar', async (req, reply) => {
    const plano = await app.prisma.planoDeContas.findUnique({
      where: { id: req.params.id },
      include: {
        modeloContabil: { select: { descricao: true } },
        _count: { select: { contas: true } },
      },
    })
    if (!plano) return reply.status(404).send('Plano de contas não encontrado.')
    return reply.view('planos-de-contas/importar', { plano })
  })

  // ── CREATE ──────────────────────────────────────────────────────────────────
  app.post<{ Body: { descricao: string; ano: string; modeloContabilId: string } }>(
    '/',
    async (req, reply) => {
      const { descricao, ano, modeloContabilId } = req.body
      const reRenderErro = async (erro: string) => {
        const modelos = await app.prisma.modeloContabil.findMany({
          where: { ativo: true }, orderBy: { descricao: 'asc' }, select: { id: true, descricao: true },
        })
        return reply.view('planos-de-contas/form', { plano: null, modelos, erro })
      }
      if (!descricao?.trim()) return reRenderErro('A descrição é obrigatória.')
      if (!modeloContabilId?.trim()) return reRenderErro('Selecione um modelo contábil.')
      const anoNum = parseInt(ano, 10)
      if (Number.isNaN(anoNum) || anoNum < 1900 || anoNum > 9999) {
        return reRenderErro('Ano inválido (use um ano entre 1900 e 9999).')
      }
      try {
        await service.criar({ descricao: descricao.trim(), ano: anoNum, modeloContabilId })
        return reply.header('HX-Redirect', '/admin/planos-de-contas').status(204).send()
      } catch (e: unknown) {
        return reRenderErro(e instanceof Error ? e.message : 'Erro ao criar plano de contas.')
      }
    },
  )

  // ── UPDATE ──────────────────────────────────────────────────────────────────
  app.put<{ Params: { id: string }; Body: { descricao: string; ano: string } }>(
    '/:id',
    async (req, reply) => {
      const { descricao, ano } = req.body
      const reRenderErro = async (erro: string) => {
        const plano = await app.prisma.planoDeContas.findUnique({
          where: { id: req.params.id },
          include: { modeloContabil: { select: { id: true, descricao: true } } },
        })
        return reply.view('planos-de-contas/form', { plano, modelos: [], erro })
      }
      if (!descricao?.trim()) return reRenderErro('A descrição é obrigatória.')
      const anoNum = parseInt(ano, 10)
      if (Number.isNaN(anoNum) || anoNum < 1900 || anoNum > 9999) {
        return reRenderErro('Ano inválido (use um ano entre 1900 e 9999).')
      }
      try {
        await service.atualizar(req.params.id, { descricao: descricao.trim(), ano: anoNum })
        return reply.header('HX-Redirect', '/admin/planos-de-contas').status(204).send()
      } catch (e: unknown) {
        return reRenderErro(e instanceof Error ? e.message : 'Erro ao atualizar plano de contas.')
      }
    },
  )

  // ── IMPORT submit (JSON body { csv }) ──────────────────────────────────────
  // Recebe o CSV via JS (FileReader + fetch). Reaproveita o service do importer.
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
