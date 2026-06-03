import type { FastifyInstance } from 'fastify'
import { ProcessosService } from '../services/processos.js'

function parseJson<T>(s: string | undefined): T[] {
  if (!s?.trim()) return []
  try {
    const arr = JSON.parse(s)
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

function carregarTermos(app: FastifyInstance, entidadeId: string) {
  return app.prisma.termoReferencia.findMany({
    where: { documentoDemanda: { entidadeId } },
    select: { id: true, objeto: true, documentoDemanda: { select: { numero: true } } },
    orderBy: { criadoEm: 'desc' },
  })
}

function carregarFornecedores(app: FastifyInstance) {
  return app.prisma.fornecedor.findMany({
    where: { ativo: true },
    orderBy: { razaoSocial: 'asc' },
    select: { id: true, razaoSocial: true, tipoPessoa: true },
  })
}

/**
 * Admin de Processos Licitatórios. Picker cascata; lista por entidade; form com
 * editor de lotes/itens (lotesJson) e modal de julgamento — por item ou por
 * lote, conforme o critério — aplicando a REGRA 3 (teto de preço).
 */
export async function adminProcessosRoutes(app: FastifyInstance) {
  const service = new ProcessosService(app.prisma)

  // ── LIST ──────────────────────────────────────────────────────────────────
  app.get<{ Querystring: { estadoId?: string; municipioId?: string; entidadeId?: string } }>('/', async (req, reply) => {
    const estadoId = req.query.estadoId?.trim() || ''
    const municipioId = req.query.municipioId?.trim() || ''
    const entidadeId = req.query.entidadeId?.trim() || ''

    const [estados, municipios, entidades] = await Promise.all([
      app.prisma.estado.findMany({ orderBy: { sigla: 'asc' }, select: { id: true, sigla: true, nome: true } }),
      estadoId ? app.prisma.municipio.findMany({ where: { estadoId }, orderBy: { nome: 'asc' }, select: { id: true, nome: true } }) : Promise.resolve([]),
      municipioId ? app.prisma.entidade.findMany({ where: { municipioId, ativo: true }, orderBy: { nome: 'asc' }, select: { id: true, nome: true } }) : Promise.resolve([]),
    ])
    const entidade = entidadeId
      ? await app.prisma.entidade.findUnique({ where: { id: entidadeId }, include: { municipio: { include: { estado: { select: { sigla: true, nome: true } } } } } })
      : null
    const processos = entidade ? await service.listar(entidade.id) : []

    return reply.view(
      'processos/index',
      {
        title: 'Processos Licitatórios — Gênesis Admin',
        active: 'processos',
        userEmail: req.user.email,
        estados, municipios, entidades,
        estadoSelecionadoId: estadoId, municipioSelecionadoId: municipioId,
        entidade, processos,
      },
      { layout: 'layouts/main' },
    )
  })

  // ── FORM (novo/editar) ───────────────────────────────────────────────────────
  app.get<{ Querystring: { entidadeId?: string } }>('/form', async (req, reply) => {
    const entidadeId = req.query.entidadeId?.trim() || ''
    if (!entidadeId) return reply.status(400).send('Entidade não informada.')
    const [catalogo, termos] = await Promise.all([carregarCatalogo(app), carregarTermos(app, entidadeId)])
    return reply.view('processos/form', { entidadeId, processo: null, lotes: [], catalogo, termos, erro: null })
  })

  app.get<{ Params: { id: string } }>('/:id/form', async (req, reply) => {
    const processo = await service.buscarPorId(req.params.id)
    if (!processo) return reply.status(404).send('Processo não encontrado.')
    const [catalogo, termos] = await Promise.all([carregarCatalogo(app), carregarTermos(app, processo.entidadeId)])
    const lotes = processo.lotes.map((l) => ({
      numero: l.numero,
      descricao: l.descricao,
      itens: l.itens.map((i) => ({ itemCatalogoId: i.itemCatalogoId, quantidade: String(i.quantidade), precoEstimadoUnitario: String(i.precoEstimadoUnitario) })),
    }))
    return reply.view('processos/form', { entidadeId: processo.entidadeId, processo, lotes, catalogo, termos, erro: null })
  })

  // ── CREATE / UPDATE ──────────────────────────────────────────────────────────
  app.post<{
    Body: { entidadeId: string; ano: string; numero: string; modalidade: string; criterioJulgamento: string; objeto: string; termoReferenciaId?: string; dataAbertura?: string; observacoes?: string; lotesJson?: string }
  }>('/', async (req, reply) => {
    const b = req.body
    if (!b.entidadeId?.trim()) return reply.status(400).send('Entidade não informada.')
    const dados = montarDados(b)
    try {
      await service.criar(b.entidadeId, dados as never)
      return reply.header('HX-Redirect', `/admin/processos?${new URLSearchParams({ entidadeId: b.entidadeId })}`).status(204).send()
    } catch (e: unknown) {
      const [catalogo, termos] = await Promise.all([carregarCatalogo(app), carregarTermos(app, b.entidadeId)])
      return reply.view('processos/form', { entidadeId: b.entidadeId, processo: b, lotes: dados.lotes, catalogo, termos, erro: msg(e, 'Erro ao criar processo.') })
    }
  })

  app.put<{
    Params: { id: string }
    Body: { ano: string; numero: string; modalidade: string; criterioJulgamento: string; objeto: string; termoReferenciaId?: string; dataAbertura?: string; observacoes?: string; lotesJson?: string }
  }>('/:id', async (req, reply) => {
    const existente = await service.buscarPorId(req.params.id)
    if (!existente) return reply.status(404).send('Processo não encontrado.')
    const dados = montarDados(req.body)
    try {
      await service.atualizar(req.params.id, dados as never)
      return reply.header('HX-Redirect', `/admin/processos?${new URLSearchParams({ entidadeId: existente.entidadeId })}`).status(204).send()
    } catch (e: unknown) {
      const [catalogo, termos] = await Promise.all([carregarCatalogo(app), carregarTermos(app, existente.entidadeId)])
      return reply.view('processos/form', { entidadeId: existente.entidadeId, processo: { ...existente, ...req.body }, lotes: dados.lotes, catalogo, termos, erro: msg(e, 'Erro ao atualizar processo.') })
    }
  })

  // ── JULGAMENTO (modal) ─────────────────────────────────────────────────────
  app.get<{ Params: { id: string } }>('/:id/julgar', async (req, reply) => {
    const [processo, fornecedores] = await Promise.all([service.buscarPorId(req.params.id), carregarFornecedores(app)])
    if (!processo) return reply.status(404).send('Processo não encontrado.')
    return reply.view('processos/julgar', { processo, fornecedores, erro: null })
  })

  async function reRenderJulgar(reply: import('fastify').FastifyReply, processoId: string, erro: string | null) {
    const [processo, fornecedores] = await Promise.all([service.buscarPorId(processoId), carregarFornecedores(app)])
    if (!processo) return reply.status(404).send('Processo não encontrado.')
    return reply.view('processos/julgar', { processo, fornecedores, erro })
  }

  // Adjudicar item (POR_ITEM)
  app.post<{ Params: { itemId: string }; Body: { fornecedorId: string; preco: string; processoId: string } }>(
    '/itens/:itemId/adjudicar',
    async (req, reply) => {
      try {
        await service.adjudicarItem(req.params.itemId, req.body.fornecedorId, req.body.preco)
        return reRenderJulgar(reply, req.body.processoId, null)
      } catch (e: unknown) {
        return reRenderJulgar(reply, req.body.processoId, msg(e, 'Erro ao adjudicar item.'))
      }
    },
  )

  // Adjudicar lote (POR_LOTE)
  app.post<{ Params: { loteId: string }; Body: { fornecedorId: string; itensJson?: string; processoId: string } }>(
    '/lotes/:loteId/adjudicar',
    async (req, reply) => {
      const itens = parseJson<{ itemProcessoId: string; precoAdjudicadoUnitario: string }>(req.body.itensJson)
      try {
        await service.adjudicarLote(req.params.loteId, req.body.fornecedorId, itens)
        return reRenderJulgar(reply, req.body.processoId, null)
      } catch (e: unknown) {
        return reRenderJulgar(reply, req.body.processoId, msg(e, 'Erro ao adjudicar lote.'))
      }
    },
  )

  // ── STATUS ──────────────────────────────────────────────────────────────────
  app.post<{ Params: { id: string } }>('/:id/homologar', async (req, reply) => {
    const processo = await app.prisma.processo.findUnique({ where: { id: req.params.id }, select: { entidadeId: true } })
    if (!processo) return reply.status(404).send('Processo não encontrado.')
    try {
      await service.homologar(req.params.id)
      return reply.header('HX-Redirect', `/admin/processos?${new URLSearchParams({ entidadeId: processo.entidadeId })}`).status(204).send()
    } catch (e: unknown) {
      return reply.status(400).send(msg(e, 'Erro ao homologar.'))
    }
  })

  app.post<{ Params: { id: string } }>('/:id/cancelar', async (req, reply) => {
    const processo = await app.prisma.processo.findUnique({ where: { id: req.params.id }, select: { entidadeId: true } })
    if (!processo) return reply.status(404).send('Processo não encontrado.')
    try {
      await service.cancelar(req.params.id)
      return reply.header('HX-Redirect', `/admin/processos?${new URLSearchParams({ entidadeId: processo.entidadeId })}`).status(204).send()
    } catch (e: unknown) {
      return reply.status(400).send(msg(e, 'Erro ao cancelar.'))
    }
  })

  app.delete<{ Params: { id: string } }>('/:id', async (req, reply) => {
    try {
      await service.excluir(req.params.id)
      return reply.status(200).send('')
    } catch (e: unknown) {
      return reply.status(400).send(msg(e, 'Erro ao excluir.'))
    }
  })
}

function montarDados(b: {
  ano: string; numero: string; modalidade: string; criterioJulgamento: string; objeto: string
  termoReferenciaId?: string; dataAbertura?: string; observacoes?: string; lotesJson?: string
}) {
  return {
    ano: parseInt((b.ano ?? '').trim(), 10),
    numero: b.numero,
    modalidade: b.modalidade,
    criterioJulgamento: b.criterioJulgamento,
    objeto: b.objeto,
    termoReferenciaId: b.termoReferenciaId || null,
    dataAbertura: b.dataAbertura || null,
    observacoes: b.observacoes || null,
    lotes: parseJson<{ numero: string; descricao?: string; itens: unknown[] }>(b.lotesJson),
  }
}

function msg(e: unknown, fallback: string) {
  return e instanceof Error ? e.message : fallback
}
