import type { FastifyInstance } from 'fastify'
import { EventosContabeisService } from '../services/eventos-contabeis.js'

/** Aceita escalar, array ou ausente — normaliza para array. */
function asArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined || v === null) return []
  return Array.isArray(v) ? v : [v]
}

/**
 * Admin da Tabela de Eventos Contábeis. Listagem por modelo contábil;
 * criação/edição em página completa (lista dinâmica de pares D-C).
 */
export async function adminEventosContabeisRoutes(app: FastifyInstance) {
  const service = new EventosContabeisService(app.prisma)

  // ── LIST ────────────────────────────────────────────────────────────────────
  app.get<{ Querystring: { modeloContabilId?: string } }>('/', async (req, reply) => {
    const modeloContabilId = req.query.modeloContabilId?.trim() || ''
    const [modelos, eventos] = await Promise.all([
      app.prisma.modeloContabil.findMany({
        orderBy: { descricao: 'asc' },
        select: { id: true, descricao: true, ativo: true },
      }),
      modeloContabilId ? service.listar(modeloContabilId) : Promise.resolve([]),
    ])

    return reply.view(
      'eventos-contabeis/index',
      {
        title: 'Eventos Contábeis — Gênesis Admin',
        active: 'eventos-contabeis',
        userEmail: req.user.email,
        modelos,
        modeloSelecionado: modeloContabilId,
        eventos,
      },
      { layout: 'layouts/main' },
    )
  })

  // ── FORM (novo) ─────────────────────────────────────────────────────────────
  app.get<{ Querystring: { modeloContabilId?: string } }>('/novo', async (req, reply) => {
    const modeloContabilId = req.query.modeloContabilId?.trim() || ''
    if (!modeloContabilId) return reply.redirect('/admin/eventos-contabeis')
    const modelo = await app.prisma.modeloContabil.findUnique({
      where: { id: modeloContabilId },
      select: { id: true, descricao: true },
    })
    if (!modelo) return reply.status(404).send('Modelo contábil não encontrado.')

    return reply.view(
      'eventos-contabeis/form',
      {
        title: 'Novo Evento Contábil — Gênesis Admin',
        active: 'eventos-contabeis',
        userEmail: req.user.email,
        modelo,
        evento: null,
        erro: null,
      },
      { layout: 'layouts/main' },
    )
  })

  // ── FORM (editar) ───────────────────────────────────────────────────────────
  app.get<{ Params: { id: string } }>('/:id/editar', async (req, reply) => {
    const evento = await service.buscarPorId(req.params.id)
    if (!evento) return reply.status(404).send('Evento não encontrado.')
    const modelo = await app.prisma.modeloContabil.findUnique({
      where: { id: evento.modeloContabilId },
      select: { id: true, descricao: true },
    })

    return reply.view(
      'eventos-contabeis/form',
      {
        title: 'Editar Evento Contábil — Gênesis Admin',
        active: 'eventos-contabeis',
        userEmail: req.user.email,
        modelo,
        evento,
        erro: null,
      },
      { layout: 'layouts/main' },
    )
  })

  type CorpoForm = {
    modeloContabilId?: string
    codigo: string
    descricao: string
    tipoInscricao?: string
    classificacaoContabilMascara?: string
    classificacaoOrcamentariaMascara?: string
    ativo?: string
    contaDebito?: string | string[]
    contaCredito?: string | string[]
  }

  function montarLancamentos(body: CorpoForm) {
    const debitos = asArray(body.contaDebito)
    const creditos = asArray(body.contaCredito)
    const total = Math.max(debitos.length, creditos.length)
    return Array.from({ length: total }, (_, i) => ({
      contaDebitoMascara: debitos[i] ?? '',
      contaCreditoMascara: creditos[i] ?? '',
    }))
  }

  // ── CREATE ──────────────────────────────────────────────────────────────────
  app.post<{ Body: CorpoForm }>('/', async (req, reply) => {
    const { modeloContabilId, codigo, descricao } = req.body
    if (!modeloContabilId?.trim()) return reply.status(400).send('Modelo contábil não informado.')

    const modelo = await app.prisma.modeloContabil.findUnique({
      where: { id: modeloContabilId },
      select: { id: true, descricao: true },
    })
    if (!modelo) return reply.status(404).send('Modelo contábil não encontrado.')

    const lancamentos = montarLancamentos(req.body)

    const reRenderErro = (erro: string) =>
      reply.view(
        'eventos-contabeis/form',
        {
          title: 'Novo Evento Contábil — Gênesis Admin',
          active: 'eventos-contabeis',
          userEmail: req.user.email,
          modelo,
          evento: {
            codigo: codigo ?? '',
            descricao: descricao ?? '',
            tipoInscricao: req.body.tipoInscricao ?? '',
            classificacaoContabilMascara: req.body.classificacaoContabilMascara ?? '',
            classificacaoOrcamentariaMascara: req.body.classificacaoOrcamentariaMascara ?? '',
            ativo: req.body.ativo !== 'false',
            lancamentos,
          },
          erro,
        },
        { layout: 'layouts/main' },
      )

    try {
      await service.criar(modeloContabilId, {
        codigo,
        descricao,
        tipoInscricao: req.body.tipoInscricao,
        classificacaoContabilMascara: req.body.classificacaoContabilMascara,
        classificacaoOrcamentariaMascara: req.body.classificacaoOrcamentariaMascara,
        ativo: req.body.ativo !== 'false',
        lancamentos,
      })
      const qs = new URLSearchParams({ modeloContabilId }).toString()
      return reply.header('HX-Redirect', `/admin/eventos-contabeis?${qs}`).status(204).send()
    } catch (e: unknown) {
      return reRenderErro(e instanceof Error ? e.message : 'Erro ao criar evento.')
    }
  })

  // ── UPDATE ──────────────────────────────────────────────────────────────────
  app.put<{ Params: { id: string }; Body: CorpoForm }>('/:id', async (req, reply) => {
    const existente = await service.buscarPorId(req.params.id)
    if (!existente) return reply.status(404).send('Evento não encontrado.')

    const modelo = await app.prisma.modeloContabil.findUnique({
      where: { id: existente.modeloContabilId },
      select: { id: true, descricao: true },
    })

    const lancamentos = montarLancamentos(req.body)

    const reRenderErro = (erro: string) =>
      reply.view(
        'eventos-contabeis/form',
        {
          title: 'Editar Evento Contábil — Gênesis Admin',
          active: 'eventos-contabeis',
          userEmail: req.user.email,
          modelo,
          evento: {
            id: existente.id,
            codigo: req.body.codigo ?? '',
            descricao: req.body.descricao ?? '',
            tipoInscricao: req.body.tipoInscricao ?? '',
            classificacaoContabilMascara: req.body.classificacaoContabilMascara ?? '',
            classificacaoOrcamentariaMascara: req.body.classificacaoOrcamentariaMascara ?? '',
            ativo: req.body.ativo !== 'false',
            lancamentos,
          },
          erro,
        },
        { layout: 'layouts/main' },
      )

    try {
      await service.atualizar(req.params.id, {
        codigo: req.body.codigo,
        descricao: req.body.descricao,
        tipoInscricao: req.body.tipoInscricao,
        classificacaoContabilMascara: req.body.classificacaoContabilMascara,
        classificacaoOrcamentariaMascara: req.body.classificacaoOrcamentariaMascara,
        ativo: req.body.ativo !== 'false',
        lancamentos,
      })
      const qs = new URLSearchParams({ modeloContabilId: existente.modeloContabilId }).toString()
      return reply.header('HX-Redirect', `/admin/eventos-contabeis?${qs}`).status(204).send()
    } catch (e: unknown) {
      return reRenderErro(e instanceof Error ? e.message : 'Erro ao atualizar evento.')
    }
  })

  // ── DELETE ──────────────────────────────────────────────────────────────────
  app.delete<{ Params: { id: string } }>('/:id', async (req, reply) => {
    try {
      await service.excluir(req.params.id)
      return reply.status(200).send('')
    } catch (e: unknown) {
      return reply.status(400).send(e instanceof Error ? e.message : 'Erro ao excluir.')
    }
  })
}
