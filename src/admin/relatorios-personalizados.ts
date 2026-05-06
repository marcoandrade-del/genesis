import type { FastifyInstance } from 'fastify'
import { RelatoriosService } from '../services/relatorios.js'

export async function adminRelatoriosPersonalizadosRoutes(app: FastifyInstance) {
  const service = new RelatoriosService(app.prisma)

  app.get<{ Querystring: { usuarioId?: string } }>('/', async (req, reply) => {
    const { usuarioId } = req.query
    const [relatorios, usuarios] = await Promise.all([
      app.prisma.relatorioPersonalizado.findMany({
        ...(usuarioId ? { where: { usuarioId } } : {}),
        orderBy: [{ usuario: { nomeCompleto: 'asc' } }, { nome: 'asc' }],
        include: { usuario: { select: { nomeCompleto: true } } },
      }),
      app.prisma.usuario.findMany({ where: { ativo: true }, orderBy: { nomeCompleto: 'asc' } }),
    ])
    return reply.view(
      'relatorios-personalizados/index',
      {
        title: 'Relatórios Personalizados — Gênesis Admin',
        active: 'relatorios-personalizados',
        userEmail: req.user.email,
        relatorios,
        usuarios,
        usuarioId: usuarioId ?? null,
      },
      { layout: 'layouts/main' },
    )
  })

  app.get('/form', async (_req, reply) => {
    return reply.view('relatorios-personalizados/form', { relatorio: null, usuarioNome: null, erro: null })
  })

  app.get<{ Params: { id: string } }>('/:id/form', async (req, reply) => {
    const relatorio = await app.prisma.relatorioPersonalizado.findUnique({
      where: { id: req.params.id },
      include: { usuario: { select: { nomeCompleto: true } } },
    })
    if (!relatorio) return reply.status(404).send('Relatório não encontrado.')
    return reply.view('relatorios-personalizados/form', {
      relatorio,
      usuarioNome: relatorio.usuario.nomeCompleto,
      erro: null,
    })
  })

  app.post<{
    Body: { nome: string; descricao: string; configuracao: string; usuarioId: string }
  }>('/', async (req, reply) => {
    const { nome, descricao, configuracao, usuarioId } = req.body

    if (!usuarioId) {
      return reply.view('relatorios-personalizados/form', { relatorio: null, usuarioNome: null, erro: 'Selecione um usuário.' })
    }
    if (!nome?.trim()) {
      return reply.view('relatorios-personalizados/form', { relatorio: null, usuarioNome: null, erro: 'O nome é obrigatório.' })
    }

    let configObj: object
    try {
      configObj = JSON.parse(configuracao || '{}')
      if (typeof configObj !== 'object' || Array.isArray(configObj)) throw new Error()
    } catch {
      return reply.view('relatorios-personalizados/form', { relatorio: null, usuarioNome: null, erro: 'Configuração inválida: informe um JSON de objeto válido.' })
    }

    try {
      await service.criarPersonalizado(usuarioId, {
        nome,
        configuracao: configObj,
        ...(descricao ? { descricao } : {}),
      })
      return reply.header('HX-Redirect', '/admin/relatorios-personalizados').status(204).send()
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Erro ao criar relatório.'
      return reply.view('relatorios-personalizados/form', { relatorio: null, usuarioNome: null, erro: msg })
    }
  })

  app.put<{
    Params: { id: string }
    Body: { nome: string; descricao: string; configuracao: string; ativo?: string }
  }>('/:id', async (req, reply) => {
    const { nome, descricao, configuracao, ativo } = req.body

    const recarregarForm = async (erro: string) => {
      const r = await app.prisma.relatorioPersonalizado.findUnique({
        where: { id: req.params.id },
        include: { usuario: { select: { nomeCompleto: true } } },
      })
      return reply.view('relatorios-personalizados/form', {
        relatorio: r,
        usuarioNome: r?.usuario.nomeCompleto ?? null,
        erro,
      })
    }

    if (!nome?.trim()) return recarregarForm('O nome é obrigatório.')

    let configObj: object | undefined
    if (configuracao) {
      try {
        const parsed: unknown = JSON.parse(configuracao)
        if (typeof parsed !== 'object' || Array.isArray(parsed) || parsed === null) throw new Error()
        configObj = parsed as object
      } catch {
        return recarregarForm('Configuração inválida: informe um JSON de objeto válido.')
      }
    }

    try {
      await service.atualizarPersonalizado(req.params.id, {
        ...(nome ? { nome } : {}),
        ...(descricao ? { descricao } : {}),
        ...(configObj !== undefined ? { configuracao: configObj } : {}),
        ...(ativo !== undefined ? { ativo: ativo === 'true' } : {}),
      })
      return reply.header('HX-Redirect', '/admin/relatorios-personalizados').status(204).send()
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Erro ao atualizar relatório.'
      return recarregarForm(msg)
    }
  })

  app.delete<{ Params: { id: string } }>('/:id', async (req, reply) => {
    try {
      await service.excluirPersonalizado(req.params.id)
      return reply.status(200).send('')
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Erro ao excluir.'
      return reply.status(400).send(msg)
    }
  })
}
