import type { FastifyInstance } from 'fastify'
import { SistemasService } from '../services/sistemas.js'
import { LixeiraService } from '../services/lixeira.js'

export async function adminSistemasRoutes(app: FastifyInstance) {
  const service = new SistemasService(app.prisma)
  const lixeiraSvc = new LixeiraService(app.prisma)

  const getAdminPadrao = (userId: string) =>
    app.prisma.usuario.findUnique({
      where: { id: userId },
      select: { id: true, nomeCompleto: true },
    })

  app.get('/', async (req, reply) => {
    const sistemas = await app.prisma.sistema.findMany({
      orderBy: { nome: 'asc' },
      include: { _count: { select: { modulos: true } } },
    })
    return reply.view(
      'sistemas/index',
      { title: 'Sistemas — Gênesis Admin', active: 'sistemas', userEmail: req.user.email, sistemas },
      { layout: 'layouts/main' },
    )
  })

  app.get('/form', async (req, reply) => {
    const adminPadrao = await getAdminPadrao(req.user.sub)
    return reply.view('sistemas/form', { sistema: null, erro: null, adminPadrao })
  })

  app.get<{ Params: { id: string } }>('/:id/form', async (req, reply) => {
    const sistema = await service.buscarComAdmins(req.params.id)
    if (!sistema) return reply.status(404).send('Sistema não encontrado.')
    const adminAtual = sistema.admins[0]?.usuario ?? null
    return reply.view('sistemas/form', { sistema, erro: null, adminPadrao: null, adminAtual })
  })

  app.post<{ Body: { nome: string; descricao: string; adminUsuarioId: string } }>(
    '/',
    async (req, reply) => {
      const adminPadrao = await getAdminPadrao(req.user.sub)
      const { nome, descricao, adminUsuarioId } = req.body

      if (!nome?.trim()) {
        return reply.view('sistemas/form', { sistema: null, erro: 'O nome é obrigatório.', adminPadrao })
      }
      if (!adminUsuarioId) {
        return reply.view('sistemas/form', {
          sistema: null,
          erro: 'Selecione um usuário administrador.',
          adminPadrao,
        })
      }

      try {
        await service.criar({
          nome,
          adminUsuarioId,
          ...(descricao ? { descricao } : {}),
        })
        return reply.header('HX-Redirect', '/admin/sistemas').status(204).send()
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Erro ao criar sistema.'
        return reply.view('sistemas/form', { sistema: null, erro: msg, adminPadrao })
      }
    },
  )

  app.put<{
    Params: { id: string }
    Body: { nome: string; descricao: string; ativo?: string; adminUsuarioId?: string }
  }>('/:id', async (req, reply) => {
    const { nome, descricao, ativo, adminUsuarioId } = req.body
    if (!nome?.trim()) {
      const sistema = await service.buscarComAdmins(req.params.id)
      const adminAtual = sistema?.admins[0]?.usuario ?? null
      return reply.view('sistemas/form', { sistema, erro: 'O nome é obrigatório.', adminPadrao: null, adminAtual })
    }
    try {
      await service.atualizar(req.params.id, {
        ...(nome ? { nome } : {}),
        ...(descricao ? { descricao } : {}),
        ...(ativo !== undefined ? { ativo: ativo === 'true' } : {}),
      })
      if (adminUsuarioId) {
        await service.trocarAdmin(req.params.id, adminUsuarioId)
      }
      return reply.header('HX-Redirect', '/admin/sistemas').status(204).send()
    } catch (e: unknown) {
      const sistema = await service.buscarComAdmins(req.params.id)
      const adminAtual = sistema?.admins[0]?.usuario ?? null
      const msg = e instanceof Error ? e.message : 'Erro ao atualizar sistema.'
      return reply.view('sistemas/form', { sistema, erro: msg, adminPadrao: null, adminAtual })
    }
  })

  app.delete<{ Params: { id: string } }>('/:id', async (req, reply) => {
    try {
      await service.excluir(req.params.id, req.user.sub, lixeiraSvc)
      return reply.status(200).send('')
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Erro ao excluir.'
      return reply.status(400).send(msg)
    }
  })
}
