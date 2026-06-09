import type { FastifyInstance } from 'fastify'
import { MunicipiosService } from '../services/municipios.js'

export async function adminMunicipiosRoutes(app: FastifyInstance) {
  const service = new MunicipiosService(app.prisma)

  // Lista filtrada por estado. Brasil tem 5570 municípios — sempre exige seleção.
  app.get<{ Querystring: { estadoId?: string } }>('/', async (req, reply) => {
    const { estadoId } = req.query
    const [estados, municipios, municipiosComEntidadeRaw] = await Promise.all([
      app.prisma.estado.findMany({
        orderBy: { nome: 'asc' },
        include: { modeloContabil: { select: { id: true, descricao: true } } },
      }),
      estadoId
        ? app.prisma.municipio.findMany({
            where: { estadoId },
            orderBy: { nome: 'asc' },
            include: { modeloContabil: { select: { id: true, descricao: true } } },
          })
        : Promise.resolve([]),
      // Municípios do estado com ≥1 entidade ativa e plano contábil copiado.
      estadoId
        ? app.prisma.municipio.findMany({
            where: { estadoId, entidades: { some: { ativo: true, contasContabil: { some: {} } } } },
            select: { id: true },
          })
        : Promise.resolve([]),
    ])
    const municipiosComEntidade = municipiosComEntidadeRaw.map((m) => m.id)
    const estadoSelecionado = estados.find((e) => e.id === estadoId) ?? null
    return reply.view(
      'municipios/index',
      {
        title: 'Municípios — Gênesis Admin',
        active: 'municipios',
        userEmail: req.user.email,
        estados,
        municipios,
        municipiosComEntidade,
        estadoSelecionado,
      },
      { layout: 'layouts/main' },
    )
  })

  // Form de criação — exige estadoId (não permitir criar sem estado definido).
  app.get<{ Querystring: { estadoId?: string } }>('/form', async (req, reply) => {
    if (!req.query.estadoId) return reply.status(400).send('Estado obrigatório.')
    const estado = await app.prisma.estado.findUnique({
      where: { id: req.query.estadoId },
      include: { modeloContabil: { select: { id: true, descricao: true } } },
    })
    if (!estado) return reply.status(404).send('Estado não encontrado.')
    const modelos = await app.prisma.modeloContabil.findMany({
      where: { ativo: true },
      orderBy: { descricao: 'asc' },
      select: { id: true, descricao: true },
    })
    return reply.view('municipios/form', { municipio: null, estado, modelos, erro: null })
  })

  app.get<{ Params: { id: string } }>('/:id/form', async (req, reply) => {
    const municipio = await app.prisma.municipio.findUnique({
      where: { id: req.params.id },
      include: {
        estado: { include: { modeloContabil: { select: { id: true, descricao: true } } } },
      },
    })
    if (!municipio) return reply.status(404).send('Município não encontrado.')
    const modelos = await app.prisma.modeloContabil.findMany({
      where: { ativo: true },
      orderBy: { descricao: 'asc' },
      select: { id: true, descricao: true },
    })
    return reply.view('municipios/form', { municipio, estado: municipio.estado, modelos, erro: null })
  })

  app.post<{ Body: { nome: string; estadoId: string; modeloContabilId?: string } }>(
    '/',
    async (req, reply) => {
      const { nome, estadoId, modeloContabilId } = req.body
      const reRenderErro = async (erro: string) => {
        const estado = await app.prisma.estado.findUnique({
          where: { id: estadoId },
          include: { modeloContabil: true },
        })
        const modelos = await app.prisma.modeloContabil.findMany({
          where: { ativo: true }, orderBy: { descricao: 'asc' }, select: { id: true, descricao: true },
        })
        return reply.view('municipios/form', { municipio: null, estado, modelos, erro })
      }
      if (!nome?.trim()) return reRenderErro('O nome é obrigatório.')
      if (!estadoId) return reRenderErro('O estado é obrigatório.')

      try {
        await service.criar({
          nome: nome.trim(),
          estadoId,
          ...(modeloContabilId?.trim() ? { modeloContabilId } : {}),
        })
        return reply.header('HX-Redirect', `/admin/municipios?estadoId=${estadoId}`).status(204).send()
      } catch (e: unknown) {
        return reRenderErro(e instanceof Error ? e.message : 'Erro ao criar município.')
      }
    },
  )

  app.put<{ Params: { id: string }; Body: { nome: string; modeloContabilId?: string } }>(
    '/:id',
    async (req, reply) => {
      const { nome, modeloContabilId } = req.body
      // Convenção: string vazia = restaurar herança do estado (modeloContabilId=null).
      const novoModelo = modeloContabilId !== undefined
        ? modeloContabilId.trim() ? modeloContabilId : null
        : undefined

      const reRenderErro = async (erro: string) => {
        const municipio = await app.prisma.municipio.findUnique({
          where: { id: req.params.id },
          include: { estado: { include: { modeloContabil: true } } },
        })
        const modelos = await app.prisma.modeloContabil.findMany({
          where: { ativo: true }, orderBy: { descricao: 'asc' }, select: { id: true, descricao: true },
        })
        return reply.view('municipios/form', { municipio, estado: municipio?.estado, modelos, erro })
      }

      if (!nome?.trim()) return reRenderErro('O nome é obrigatório.')

      try {
        const municipio = await app.prisma.municipio.findUnique({ where: { id: req.params.id }, select: { estadoId: true } })
        if (!municipio) return reply.status(404).send('Município não encontrado.')
        await service.atualizar(req.params.id, {
          nome: nome.trim(),
          ...(novoModelo !== undefined ? { modeloContabilId: novoModelo } : {}),
        })
        return reply.header('HX-Redirect', `/admin/municipios?estadoId=${municipio.estadoId}`).status(204).send()
      } catch (e: unknown) {
        return reRenderErro(e instanceof Error ? e.message : 'Erro ao atualizar município.')
      }
    },
  )

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
