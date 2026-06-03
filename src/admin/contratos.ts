import type { FastifyInstance } from 'fastify'
import type { StatusContrato } from '@prisma/client'
import { ContratosService } from '../services/contratos.js'

const STATUS_VALIDOS: ReadonlyArray<StatusContrato> = ['VIGENTE', 'ENCERRADO', 'RESCINDIDO']

function parseItens(s: string | undefined): Array<Record<string, string>> {
  if (!s?.trim()) return []
  try {
    const a = JSON.parse(s)
    return Array.isArray(a) ? a : []
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

async function carregarLookups(app: FastifyInstance, entidadeId: string) {
  const [fornecedores, processos, catalogo] = await Promise.all([
    app.prisma.fornecedor.findMany({ where: { ativo: true }, orderBy: { razaoSocial: 'asc' }, select: { id: true, razaoSocial: true } }),
    app.prisma.processo.findMany({ where: { entidadeId }, orderBy: [{ ano: 'desc' }, { numero: 'desc' }], select: { id: true, numero: true, ano: true } }),
    carregarCatalogo(app),
  ])
  return { fornecedores, processos, catalogo }
}

/**
 * Admin de Contratos. Picker cascata; lista por entidade; form com fornecedor,
 * processo de origem (opcional), vigência e itens (catálogo × quantidade ×
 * preço) serializados em JSON; ciclo de status VIGENTE → ENCERRADO/RESCINDIDO.
 */
export async function adminContratosRoutes(app: FastifyInstance) {
  const service = new ContratosService(app.prisma)

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
    const contratos = entidade ? await service.listar(entidade.id) : []
    return reply.view(
      'contratos/index',
      { title: 'Contratos — Gênesis Admin', active: 'contratos', userEmail: req.user.email, estados, municipios, entidades, estadoSelecionadoId: estadoId, municipioSelecionadoId: municipioId, entidade, contratos },
      { layout: 'layouts/main' },
    )
  })

  app.get<{ Querystring: { entidadeId?: string } }>('/form', async (req, reply) => {
    const entidadeId = req.query.entidadeId?.trim() || ''
    if (!entidadeId) return reply.status(400).send('Entidade não informada.')
    const lookups = await carregarLookups(app, entidadeId)
    return reply.view('contratos/form', { entidadeId, contrato: null, itens: [], erro: null, ...lookups })
  })

  app.get<{ Params: { id: string } }>('/:id/form', async (req, reply) => {
    const contrato = await service.buscarPorId(req.params.id)
    if (!contrato) return reply.status(404).send('Contrato não encontrado.')
    const lookups = await carregarLookups(app, contrato.entidadeId)
    const itens = contrato.itens.map((i) => ({ itemCatalogoId: i.itemCatalogoId, quantidadeContratada: String(i.quantidadeContratada), precoUnitario: String(i.precoUnitario) }))
    return reply.view('contratos/form', { entidadeId: contrato.entidadeId, contrato, itens, erro: null, ...lookups })
  })

  app.post<{
    Body: { entidadeId: string; fornecedorId: string; processoId?: string; numero: string; objeto: string; vigenciaInicio: string; vigenciaFim: string; valorTotal: string; itensJson?: string }
  }>('/', async (req, reply) => {
    const b = req.body
    if (!b.entidadeId?.trim()) return reply.status(400).send('Entidade não informada.')
    const itens = parseItens(b.itensJson)
    try {
      await service.criar(b.entidadeId, { fornecedorId: b.fornecedorId, processoId: b.processoId, numero: b.numero, objeto: b.objeto, vigenciaInicio: b.vigenciaInicio, vigenciaFim: b.vigenciaFim, valorTotal: b.valorTotal, itens } as never)
      return reply.header('HX-Redirect', `/admin/contratos?${new URLSearchParams({ entidadeId: b.entidadeId })}`).status(204).send()
    } catch (e: unknown) {
      const lookups = await carregarLookups(app, b.entidadeId)
      return reply.view('contratos/form', { entidadeId: b.entidadeId, contrato: b, itens, erro: e instanceof Error ? e.message : 'Erro ao criar contrato.', ...lookups })
    }
  })

  app.put<{
    Params: { id: string }
    Body: { fornecedorId: string; processoId?: string; numero: string; objeto: string; vigenciaInicio: string; vigenciaFim: string; valorTotal: string; itensJson?: string }
  }>('/:id', async (req, reply) => {
    const existente = await service.buscarPorId(req.params.id)
    if (!existente) return reply.status(404).send('Contrato não encontrado.')
    const b = req.body
    const itens = parseItens(b.itensJson)
    try {
      await service.atualizar(req.params.id, { fornecedorId: b.fornecedorId, processoId: b.processoId, numero: b.numero, objeto: b.objeto, vigenciaInicio: b.vigenciaInicio, vigenciaFim: b.vigenciaFim, valorTotal: b.valorTotal, itens } as never)
      return reply.header('HX-Redirect', `/admin/contratos?${new URLSearchParams({ entidadeId: existente.entidadeId })}`).status(204).send()
    } catch (e: unknown) {
      const lookups = await carregarLookups(app, existente.entidadeId)
      return reply.view('contratos/form', { entidadeId: existente.entidadeId, contrato: { ...existente, ...b }, itens, erro: e instanceof Error ? e.message : 'Erro ao atualizar contrato.', ...lookups })
    }
  })

  app.post<{ Params: { id: string }; Body: { status: string } }>('/:id/status', async (req, reply) => {
    const novoStatus = req.body.status as StatusContrato
    if (!STATUS_VALIDOS.includes(novoStatus)) return reply.status(400).send('Status inválido.')
    const contrato = await app.prisma.contrato.findUnique({ where: { id: req.params.id }, select: { entidadeId: true } })
    if (!contrato) return reply.status(404).send('Contrato não encontrado.')
    try {
      await service.alterarStatus(req.params.id, novoStatus)
      return reply.header('HX-Redirect', `/admin/contratos?${new URLSearchParams({ entidadeId: contrato.entidadeId })}`).status(204).send()
    } catch (e: unknown) {
      return reply.status(400).send(e instanceof Error ? e.message : 'Erro ao alterar status.')
    }
  })

  app.delete<{ Params: { id: string } }>('/:id', async (req, reply) => {
    try {
      await service.excluir(req.params.id)
      return reply.status(200).send('')
    } catch (e: unknown) {
      return reply.status(400).send(e instanceof Error ? e.message : 'Erro ao excluir.')
    }
  })
}
