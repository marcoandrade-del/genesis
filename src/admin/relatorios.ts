import type { FastifyInstance } from 'fastify'
import { RelatoriosService } from '../services/relatorios.js'

export async function adminRelatoriosRoutes(app: FastifyInstance) {
  const service = new RelatoriosService(app.prisma)

  app.get<{ Querystring: { sistemaId?: string } }>('/', async (req, reply) => {
    const { sistemaId } = req.query
    const [relatorios, sistemas] = await Promise.all([
      app.prisma.relatorioFixo.findMany({
        ...(sistemaId ? { where: { sistemaId } } : {}),
        orderBy: [{ sistema: { nome: 'asc' } }, { nome: 'asc' }],
        include: { sistema: { select: { nome: true } } },
      }),
      app.prisma.sistema.findMany({ where: { ativo: true }, orderBy: { nome: 'asc' } }),
    ])
    return reply.view(
      'relatorios/index',
      {
        title: 'Relatórios Fixos — Gênesis Admin',
        active: 'relatorios',
        userEmail: req.user.email,
        relatorios,
        sistemas,
        sistemaId: sistemaId ?? null,
      },
      { layout: 'layouts/main' },
    )
  })

  app.get('/form', async (_req, reply) => {
    return reply.view('relatorios/form', { relatorio: null, sistemaNome: null, erro: null })
  })

  app.get<{ Params: { id: string } }>('/:id/form', async (req, reply) => {
    const relatorio = await app.prisma.relatorioFixo.findUnique({
      where: { id: req.params.id },
      include: { sistema: { select: { nome: true } } },
    })
    if (!relatorio) return reply.status(404).send('Relatório não encontrado.')
    return reply.view('relatorios/form', {
      relatorio,
      sistemaNome: relatorio.sistema.nome,
      erro: null,
    })
  })

  app.post<{
    Body: { nome: string; descricao: string; rota: string; sistemaId: string }
  }>('/', async (req, reply) => {
    const { nome, descricao, rota, sistemaId } = req.body

    if (!sistemaId) {
      return reply.view('relatorios/form', { relatorio: null, sistemaNome: null, erro: 'Selecione um sistema.' })
    }
    if (!nome?.trim()) {
      return reply.view('relatorios/form', { relatorio: null, sistemaNome: null, erro: 'O nome é obrigatório.' })
    }
    if (!rota?.trim()) {
      return reply.view('relatorios/form', { relatorio: null, sistemaNome: null, erro: 'A rota é obrigatória.' })
    }

    try {
      await service.criarFixo(sistemaId, {
        nome,
        rota,
        ...(descricao ? { descricao } : {}),
      })
      return reply.header('HX-Redirect', '/admin/relatorios').status(204).send()
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Erro ao criar relatório.'
      return reply.view('relatorios/form', { relatorio: null, sistemaNome: null, erro: msg })
    }
  })

  app.put<{
    Params: { id: string }
    Body: { nome: string; descricao: string; rota: string; ativo?: string }
  }>('/:id', async (req, reply) => {
    const { nome, descricao, rota, ativo } = req.body

    if (!nome?.trim() || !rota?.trim()) {
      const relatorio = await app.prisma.relatorioFixo.findUnique({
        where: { id: req.params.id },
        include: { sistema: { select: { nome: true } } },
      })
      return reply.view('relatorios/form', {
        relatorio,
        sistemaNome: relatorio?.sistema.nome ?? null,
        erro: 'Nome e rota são obrigatórios.',
      })
    }

    try {
      await service.atualizarFixo(req.params.id, {
        nome,
        rota,
        ...(descricao ? { descricao } : {}),
        ...(ativo !== undefined ? { ativo: ativo === 'true' } : {}),
      })
      return reply.header('HX-Redirect', '/admin/relatorios').status(204).send()
    } catch (e: unknown) {
      const relatorio = await app.prisma.relatorioFixo.findUnique({
        where: { id: req.params.id },
        include: { sistema: { select: { nome: true } } },
      })
      const msg = e instanceof Error ? e.message : 'Erro ao atualizar relatório.'
      return reply.view('relatorios/form', {
        relatorio,
        sistemaNome: relatorio?.sistema.nome ?? null,
        erro: msg,
      })
    }
  })

  app.delete<{ Params: { id: string } }>('/:id', async (req, reply) => {
    try {
      await service.excluirFixo(req.params.id)
      return reply.status(200).send('')
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Erro ao excluir.'
      return reply.status(400).send(msg)
    }
  })
}
