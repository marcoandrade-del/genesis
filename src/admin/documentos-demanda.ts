import type { FastifyInstance } from 'fastify'
import type { StatusDemanda } from '@prisma/client'
import { DocumentosDemandaService } from '../services/documentos-demanda.js'
import { TermosReferenciaService } from '../services/termos-referencia.js'

const STATUS_VALIDOS: ReadonlyArray<StatusDemanda> = ['RASCUNHO', 'AGUARDANDO_PARECER', 'APROVADA', 'REPROVADA']

function parseItens(itensJson: string | undefined): Array<Record<string, string>> {
  if (!itensJson?.trim()) return []
  try {
    const arr = JSON.parse(itensJson)
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

function carregarCatalogo(app: FastifyInstance) {
  return app.prisma.itemCatalogo.findMany({
    where: { ativo: true },
    orderBy: [{ tipo: 'asc' }, { codigo: 'asc' }],
    select: { id: true, tipo: true, codigo: true, descricao: true, unidadeMedida: true },
  })
}

async function carregarLookupsDemanda(app: FastifyInstance, entidadeId: string) {
  const [unidades, pcas, catalogo] = await Promise.all([
    app.prisma.unidadeOrcamentaria.findMany({
      where: { entidadeId, ativa: true },
      orderBy: { codigo: 'asc' },
      select: { id: true, codigo: true, nome: true },
    }),
    app.prisma.planoContratacaoAnual.findMany({
      where: { entidadeId },
      orderBy: { ano: 'desc' },
      select: { id: true, ano: true },
    }),
    carregarCatalogo(app),
  ])
  return { unidades, pcas, catalogo }
}

/**
 * Admin de Demandas (DOD) + Termo de Referência. Picker cascata; lista por
 * entidade; form modal com itens (catálogo × quantidade); workflow de parecer
 * jurídico (status) e TR 1:1 em modal próprio (objeto + itens com preço).
 */
export async function adminDocumentosDemandaRoutes(app: FastifyInstance) {
  const demandas = new DocumentosDemandaService(app.prisma)
  const termos = new TermosReferenciaService(app.prisma)

  // ── LIST ──────────────────────────────────────────────────────────────────
  app.get<{
    Querystring: { estadoId?: string; municipioId?: string; entidadeId?: string }
  }>('/', async (req, reply) => {
    const estadoId = req.query.estadoId?.trim() || ''
    const municipioId = req.query.municipioId?.trim() || ''
    const entidadeId = req.query.entidadeId?.trim() || ''

    const [estados, municipios, entidades] = await Promise.all([
      app.prisma.estado.findMany({ orderBy: { sigla: 'asc' }, select: { id: true, sigla: true, nome: true } }),
      estadoId
        ? app.prisma.municipio.findMany({ where: { estadoId }, orderBy: { nome: 'asc' }, select: { id: true, nome: true } })
        : Promise.resolve([]),
      municipioId
        ? app.prisma.entidade.findMany({ where: { municipioId, ativo: true }, orderBy: { nome: 'asc' }, select: { id: true, nome: true } })
        : Promise.resolve([]),
    ])

    const entidade = entidadeId
      ? await app.prisma.entidade.findUnique({
          where: { id: entidadeId },
          include: { municipio: { include: { estado: { select: { sigla: true, nome: true } } } } },
        })
      : null

    const lista = entidade ? await demandas.listar(entidade.id) : []

    return reply.view(
      'documentos-demanda/index',
      {
        title: 'Demandas (DOD) — Gênesis Admin',
        active: 'documentos-demanda',
        userEmail: req.user.email,
        estados,
        municipios,
        entidades,
        estadoSelecionadoId: estadoId,
        municipioSelecionadoId: municipioId,
        entidade,
        demandas: lista,
      },
      { layout: 'layouts/main' },
    )
  })

  // ── FORM DOD (novo) ──────────────────────────────────────────────────────────
  app.get<{ Querystring: { entidadeId?: string } }>('/form', async (req, reply) => {
    const entidadeId = req.query.entidadeId?.trim() || ''
    if (!entidadeId) return reply.status(400).send('Entidade não informada.')
    const lookups = await carregarLookupsDemanda(app, entidadeId)
    return reply.view('documentos-demanda/form', { entidadeId, dod: null, itens: [], erro: null, ...lookups })
  })

  // ── FORM DOD (editar) ────────────────────────────────────────────────────────
  app.get<{ Params: { id: string } }>('/:id/form', async (req, reply) => {
    const dod = await demandas.buscarPorId(req.params.id)
    if (!dod) return reply.status(404).send('Demanda não encontrada.')
    const lookups = await carregarLookupsDemanda(app, dod.entidadeId)
    const itens = dod.itens.map((i) => ({ itemCatalogoId: i.itemCatalogoId, quantidade: String(i.quantidade) }))
    return reply.view('documentos-demanda/form', { entidadeId: dod.entidadeId, dod, itens, erro: null, ...lookups })
  })

  // ── CREATE DOD ────────────────────────────────────────────────────────────
  app.post<{
    Body: {
      entidadeId: string
      ano: string
      numero: string
      unidadeOrcamentariaId: string
      pcaId?: string
      justificativa: string
      itensJson?: string
    }
  }>('/', async (req, reply) => {
    const { entidadeId, numero, unidadeOrcamentariaId, pcaId, justificativa, itensJson } = req.body
    if (!entidadeId?.trim()) return reply.status(400).send('Entidade não informada.')
    const ano = parseInt((req.body.ano ?? '').trim(), 10)
    const itens = parseItens(itensJson) as Array<{ itemCatalogoId: string; quantidade: string }>
    try {
      await demandas.criar(entidadeId, {
        ano,
        numero,
        unidadeOrcamentariaId,
        justificativa,
        itens,
        ...(pcaId ? { pcaId } : {}),
      })
      const qs = new URLSearchParams({ entidadeId }).toString()
      return reply.header('HX-Redirect', `/admin/documentos-demanda?${qs}`).status(204).send()
    } catch (e: unknown) {
      const lookups = await carregarLookupsDemanda(app, entidadeId)
      const msg = e instanceof Error ? e.message : 'Erro ao criar demanda.'
      return reply.view('documentos-demanda/form', {
        entidadeId,
        dod: { ano, numero, unidadeOrcamentariaId, pcaId, justificativa },
        itens,
        erro: msg,
        ...lookups,
      })
    }
  })

  // ── UPDATE DOD ────────────────────────────────────────────────────────────
  app.put<{
    Params: { id: string }
    Body: { ano: string; numero: string; unidadeOrcamentariaId: string; pcaId?: string; justificativa: string; itensJson?: string }
  }>('/:id', async (req, reply) => {
    const existente = await demandas.buscarPorId(req.params.id)
    if (!existente) return reply.status(404).send('Demanda não encontrada.')
    const { numero, unidadeOrcamentariaId, pcaId, justificativa, itensJson } = req.body
    const ano = parseInt((req.body.ano ?? '').trim(), 10)
    const itens = parseItens(itensJson) as Array<{ itemCatalogoId: string; quantidade: string }>
    try {
      await demandas.atualizar(req.params.id, {
        ano,
        numero,
        unidadeOrcamentariaId,
        justificativa,
        itens,
        ...(pcaId ? { pcaId } : {}),
      })
      const qs = new URLSearchParams({ entidadeId: existente.entidadeId }).toString()
      return reply.header('HX-Redirect', `/admin/documentos-demanda?${qs}`).status(204).send()
    } catch (e: unknown) {
      const lookups = await carregarLookupsDemanda(app, existente.entidadeId)
      const msg = e instanceof Error ? e.message : 'Erro ao atualizar demanda.'
      return reply.view('documentos-demanda/form', {
        entidadeId: existente.entidadeId,
        dod: { ...existente, ano, numero, unidadeOrcamentariaId, pcaId, justificativa },
        itens,
        erro: msg,
        ...lookups,
      })
    }
  })

  // ── PARECER (form modal) ─────────────────────────────────────────────────────
  app.get<{ Params: { id: string } }>('/:id/parecer', async (req, reply) => {
    const dod = await app.prisma.documentoDemanda.findUnique({
      where: { id: req.params.id },
      select: { id: true, numero: true },
    })
    if (!dod) return reply.status(404).send('Demanda não encontrada.')
    return reply.view('documentos-demanda/parecer_form', { dod, erro: null })
  })

  // ── STATUS (workflow de parecer) ─────────────────────────────────────────────
  app.post<{
    Params: { id: string }
    Body: { status: string; responsavel?: string; observacao?: string }
  }>('/:id/status', async (req, reply) => {
    const novoStatus = req.body.status as StatusDemanda
    if (!STATUS_VALIDOS.includes(novoStatus)) return reply.status(400).send('Status inválido.')
    const dod = await app.prisma.documentoDemanda.findUnique({ where: { id: req.params.id }, select: { entidadeId: true } })
    if (!dod) return reply.status(404).send('Demanda não encontrada.')
    try {
      await demandas.alterarStatus(req.params.id, novoStatus, {
        ...(req.body.responsavel ? { responsavel: req.body.responsavel } : {}),
        ...(req.body.observacao ? { observacao: req.body.observacao } : {}),
      })
      const qs = new URLSearchParams({ entidadeId: dod.entidadeId }).toString()
      return reply.header('HX-Redirect', `/admin/documentos-demanda?${qs}`).status(204).send()
    } catch (e: unknown) {
      return reply.status(400).send(e instanceof Error ? e.message : 'Erro ao alterar status.')
    }
  })

  // ── DELETE DOD ────────────────────────────────────────────────────────────
  app.delete<{ Params: { id: string } }>('/:id', async (req, reply) => {
    try {
      await demandas.excluir(req.params.id)
      return reply.status(200).send('')
    } catch (e: unknown) {
      return reply.status(400).send(e instanceof Error ? e.message : 'Erro ao excluir.')
    }
  })

  // ── TR — form (novo ou editar; 1:1 com o DOD) ─────────────────────────────────
  app.get<{ Params: { id: string } }>('/:id/termo/form', async (req, reply) => {
    const dod = await demandas.buscarPorId(req.params.id)
    if (!dod) return reply.status(404).send('Demanda não encontrada.')
    const [tr, catalogo] = await Promise.all([termos.buscarPorDemanda(req.params.id), carregarCatalogo(app)])
    const itens = tr
      ? tr.itens.map((i) => ({
          itemCatalogoId: i.itemCatalogoId,
          quantidade: String(i.quantidade),
          precoUnitarioEstimado: String(i.precoUnitarioEstimado),
        }))
      : []
    return reply.view('documentos-demanda/termo_form', { dod, tr, itens, catalogo, erro: null })
  })

  // ── TR — create ─────────────────────────────────────────────────────────────
  app.post<{ Params: { id: string }; Body: { objeto: string; observacoes?: string; itensJson?: string } }>(
    '/:id/termo',
    async (req, reply) => {
      const dod = await app.prisma.documentoDemanda.findUnique({ where: { id: req.params.id }, select: { entidadeId: true } })
      if (!dod) return reply.status(404).send('Demanda não encontrada.')
      const itens = parseItens(req.body.itensJson) as Array<{ itemCatalogoId: string; quantidade: string; precoUnitarioEstimado: string }>
      try {
        await termos.criar(req.params.id, { objeto: req.body.objeto, observacoes: req.body.observacoes, itens })
        const qs = new URLSearchParams({ entidadeId: dod.entidadeId }).toString()
        return reply.header('HX-Redirect', `/admin/documentos-demanda?${qs}`).status(204).send()
      } catch (e: unknown) {
        return reply.status(400).send(e instanceof Error ? e.message : 'Erro ao criar Termo de Referência.')
      }
    },
  )

  // ── TR — update ─────────────────────────────────────────────────────────────
  app.put<{ Params: { trId: string }; Body: { objeto: string; observacoes?: string; itensJson?: string } }>(
    '/termo/:trId',
    async (req, reply) => {
      const itens = parseItens(req.body.itensJson) as Array<{ itemCatalogoId: string; quantidade: string; precoUnitarioEstimado: string }>
      try {
        const tr = await termos.atualizar(req.params.trId, { objeto: req.body.objeto, observacoes: req.body.observacoes, itens })
        const dod = await app.prisma.documentoDemanda.findUnique({ where: { id: tr.documentoDemandaId }, select: { entidadeId: true } })
        const qs = new URLSearchParams({ entidadeId: dod?.entidadeId ?? '' }).toString()
        return reply.header('HX-Redirect', `/admin/documentos-demanda?${qs}`).status(204).send()
      } catch (e: unknown) {
        return reply.status(400).send(e instanceof Error ? e.message : 'Erro ao atualizar Termo de Referência.')
      }
    },
  )

  // ── TR — delete ─────────────────────────────────────────────────────────────
  app.delete<{ Params: { trId: string } }>('/termo/:trId', async (req, reply) => {
    const tr = await app.prisma.termoReferencia.findUnique({
      where: { id: req.params.trId },
      select: { documentoDemanda: { select: { entidadeId: true } } },
    })
    try {
      await termos.excluir(req.params.trId)
      const qs = new URLSearchParams({ entidadeId: tr?.documentoDemanda.entidadeId ?? '' }).toString()
      return reply.header('HX-Redirect', `/admin/documentos-demanda?${qs}`).status(204).send()
    } catch (e: unknown) {
      return reply.status(400).send(e instanceof Error ? e.message : 'Erro ao excluir Termo de Referência.')
    }
  })
}
