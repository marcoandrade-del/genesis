import type { FastifyInstance } from 'fastify'
import { ModulosService } from '../services/modulos.js'
import { LixeiraService } from '../services/lixeira.js'

export async function adminModulosRoutes(app: FastifyInstance) {
  const service = new ModulosService(app.prisma)
  const lixeiraSvc = new LixeiraService(app.prisma)

  const getAdminPadrao = (userId: string) =>
    app.prisma.usuario.findUnique({
      where: { id: userId },
      select: { id: true, nomeCompleto: true },
    })

  const getSistemaNome = async (sistemaId: string) => {
    const s = await app.prisma.sistema.findUnique({
      where: { id: sistemaId },
      select: { nome: true },
    })
    return s?.nome ?? null
  }

  app.get<{ Querystring: { sistemaId?: string } }>('/', async (req, reply) => {
    const { sistemaId } = req.query
    const [modulos, sistemas] = await Promise.all([
      app.prisma.modulo.findMany({
        ...(sistemaId ? { where: { sistemaId } } : {}),
        orderBy: [{ sistema: { nome: 'asc' } }, { nome: 'asc' }],
        include: { sistema: { select: { nome: true } } },
      }),
      app.prisma.sistema.findMany({ where: { ativo: true }, orderBy: { nome: 'asc' } }),
    ])
    return reply.view(
      'modulos/index',
      {
        title: 'Módulos — Gênesis Admin',
        active: 'modulos',
        userEmail: req.user.email,
        modulos,
        sistemas,
        sistemaId: sistemaId ?? null,
      },
      { layout: 'layouts/main' },
    )
  })

  app.get('/form', async (req, reply) => {
    const adminPadrao = await getAdminPadrao(req.user.sub)
    return reply.view('modulos/form', { modulo: null, sistemaNome: null, adminPadrao, erro: null })
  })

  app.get<{ Params: { id: string } }>('/:id/form', async (req, reply) => {
    const modulo = await service.buscarPorId(req.params.id)
    if (!modulo) return reply.status(404).send('Módulo não encontrado.')
    const sistemaNome = await getSistemaNome(modulo.sistemaId)
    return reply.view('modulos/form', { modulo, sistemaNome, adminPadrao: null, erro: null })
  })

  app.post<{ Body: { nome: string; descricao: string; sistemaId: string; adminUsuarioId: string } }>(
    '/',
    async (req, reply) => {
      const adminPadrao = await getAdminPadrao(req.user.sub)
      const { sistemaId, nome, descricao, adminUsuarioId } = req.body

      if (!sistemaId) {
        return reply.view('modulos/form', {
          modulo: null, sistemaNome: null, adminPadrao, erro: 'Selecione um sistema.',
        })
      }
      if (!adminUsuarioId) {
        return reply.view('modulos/form', {
          modulo: null, sistemaNome: null, adminPadrao, erro: 'Selecione um usuário administrador.',
        })
      }

      try {
        await service.criar(sistemaId, {
          nome,
          adminUsuarioId,
          ...(descricao ? { descricao } : {}),
        })
        return reply.header('HX-Redirect', '/admin/modulos').status(204).send()
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Erro ao criar módulo.'
        return reply.view('modulos/form', { modulo: null, sistemaNome: null, adminPadrao, erro: msg })
      }
    },
  )

  app.put<{
    Params: { id: string }
    Body: { nome: string; descricao: string; ativo?: string }
  }>('/:id', async (req, reply) => {
    const { nome, descricao, ativo } = req.body
    try {
      await service.atualizar(req.params.id, {
        ...(nome ? { nome } : {}),
        ...(descricao ? { descricao } : {}),
        ...(ativo !== undefined ? { ativo: ativo === 'true' } : {}),
      })
      return reply.header('HX-Redirect', '/admin/modulos').status(204).send()
    } catch (e: unknown) {
      const modulo = await service.buscarPorId(req.params.id)
      const sistemaNome = modulo ? await getSistemaNome(modulo.sistemaId) : null
      const msg = e instanceof Error ? e.message : 'Erro ao atualizar módulo.'
      return reply.view('modulos/form', { modulo, sistemaNome, adminPadrao: null, erro: msg })
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
