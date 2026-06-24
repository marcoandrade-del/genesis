import type { FastifyInstance } from 'fastify'
import { ReservasDotacaoService, saldoDisponivel } from '../services/reservas-dotacao.js'
import { STATUS_EXECUTAVEIS } from '../services/orcamentos.js'

/**
 * Admin de Reservas de Dotação (pré-empenho). Picker cascata
 * Estado→Município→Entidade; lista de reservas; criação com seleção de dotação
 * mostrando o saldo disponível (REGRA 1) e cancelamento com estorno.
 */
export async function adminReservasDotacaoRoutes(app: FastifyInstance) {
  const reservas = new ReservasDotacaoService(app.prisma)

  // ── LIST (cascata + reservas da entidade) ───────────────────────────────────
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

    const lista = entidade ? await reservas.listar(entidade.id) : []

    return reply.view(
      'reservas-dotacao/index',
      {
        title: 'Reservas de Dotação — Gênesis Admin',
        active: 'reservas-dotacao',
        userEmail: req.user.email,
        estados,
        municipios,
        entidades,
        estadoSelecionadoId: estadoId,
        municipioSelecionadoId: municipioId,
        entidade,
        reservas: lista,
      },
      { layout: 'layouts/main' },
    )
  })

  // ── FORM (nova reserva) ──────────────────────────────────────────────────────
  app.get<{ Querystring: { entidadeId?: string } }>('/form', async (req, reply) => {
    const entidadeId = req.query.entidadeId?.trim() || ''
    if (!entidadeId) return reply.status(400).send('Entidade não informada.')
    const lookups = await carregarLookups(app, entidadeId)
    return reply.view('reservas-dotacao/form', { entidadeId, erro: null, reserva: null, ...lookups })
  })

  // ── CREATE ────────────────────────────────────────────────────────────────
  app.post<{
    Body: {
      entidadeId: string
      dotacaoDespesaId: string
      termoReferenciaId?: string
      numero: string
      valor: string
      observacoes?: string
    }
  }>('/', async (req, reply) => {
    const { entidadeId, dotacaoDespesaId, termoReferenciaId, numero, valor, observacoes } = req.body
    if (!entidadeId?.trim()) return reply.status(400).send('Entidade não informada.')
    try {
      await reservas.criar(entidadeId, {
        dotacaoDespesaId,
        numero,
        valor,
        ...(termoReferenciaId ? { termoReferenciaId } : {}),
        ...(observacoes ? { observacoes } : {}),
      })
      const qs = new URLSearchParams({ entidadeId }).toString()
      return reply.header('HX-Redirect', `/admin/reservas-dotacao?${qs}`).status(204).send()
    } catch (e: unknown) {
      const lookups = await carregarLookups(app, entidadeId)
      const msg = e instanceof Error ? e.message : 'Erro ao criar reserva.'
      return reply.view('reservas-dotacao/form', {
        entidadeId,
        erro: msg,
        reserva: { numero, valor, observacoes, dotacaoDespesaId, termoReferenciaId },
        ...lookups,
      })
    }
  })

  // ── CANCELAR (estorna o reservado) ──────────────────────────────────────────
  app.post<{ Params: { id: string } }>('/:id/cancelar', async (req, reply) => {
    const reserva = await app.prisma.reservaDotacao.findUnique({ where: { id: req.params.id } })
    if (!reserva) return reply.status(404).send('Reserva não encontrada.')
    try {
      await reservas.cancelar(req.params.id)
      const qs = new URLSearchParams({ entidadeId: reserva.entidadeId }).toString()
      return reply.header('HX-Redirect', `/admin/reservas-dotacao?${qs}`).status(204).send()
    } catch (e: unknown) {
      return reply.status(400).send(e instanceof Error ? e.message : 'Erro ao cancelar.')
    }
  })
}

/** Dotações elegíveis (orçamento não-RASCUNHO) com saldo, e TRs da entidade. */
async function carregarLookups(app: FastifyInstance, entidadeId: string) {
  const [dotacoesRaw, termos] = await Promise.all([
    app.prisma.dotacaoDespesa.findMany({
      where: { orcamento: { entidadeId, status: { in: [...STATUS_EXECUTAVEIS] } } },
      include: {
        unidadeOrcamentaria: { select: { codigo: true } },
        contaDespesa: { select: { codigo: true } },
        fonteRecurso: { select: { codigo: true } },
        orcamento: { select: { ano: true } },
      },
      orderBy: { criadoEm: 'asc' },
    }),
    app.prisma.termoReferencia.findMany({
      where: { documentoDemanda: { entidadeId } },
      select: { id: true, objeto: true, documentoDemanda: { select: { numero: true, ano: true } } },
      orderBy: { criadoEm: 'desc' },
    }),
  ])

  const dotacoes = dotacoesRaw.map((d) => ({
    id: d.id,
    ano: d.orcamento.ano,
    rotulo: `${d.unidadeOrcamentaria.codigo} · ${d.contaDespesa.codigo} · Fonte ${d.fonteRecurso.codigo}`,
    disponivel: saldoDisponivel(d).toFixed(2),
  }))

  return { dotacoes, termos }
}
