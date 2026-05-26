import type { FastifyInstance } from 'fastify'
import { LancamentosService } from '../services/lancamentos.js'

const LIMITE_LISTAGEM = 500

/**
 * Admin de lançamentos contábeis — fase 1: listar, detalhar e excluir.
 *
 * Criação (partida dobrada com itens dinâmicos) entra em PR separada.
 * Aqui usamos cascata Estado→Município via querystring, igual ao admin de
 * Municípios; sem município selecionado, mostramos só o picker.
 */
export async function adminLancamentosRoutes(app: FastifyInstance) {
  const service = new LancamentosService(app.prisma)

  // ── LIST ────────────────────────────────────────────────────────────────────
  app.get<{ Querystring: { estadoId?: string; municipioId?: string; dataInicio?: string; dataFim?: string } }>(
    '/',
    async (req, reply) => {
      const estadoId = req.query.estadoId?.trim() || ''
      const municipioId = req.query.municipioId?.trim() || ''
      const dataInicio = req.query.dataInicio?.trim() || ''
      const dataFim = req.query.dataFim?.trim() || ''

      const [estados, municipios] = await Promise.all([
        app.prisma.estado.findMany({ orderBy: { sigla: 'asc' }, select: { id: true, sigla: true, nome: true } }),
        estadoId
          ? app.prisma.municipio.findMany({
              where: { estadoId },
              orderBy: { nome: 'asc' },
              select: { id: true, nome: true },
            })
          : Promise.resolve([]),
      ])

      const municipio = municipioId
        ? await app.prisma.municipio.findUnique({
            where: { id: municipioId },
            include: { estado: { select: { id: true, sigla: true, nome: true } } },
          })
        : null

      const lancamentos = municipio
        ? await service.listar(municipio.id, {
            ...(dataInicio ? { dataInicio } : {}),
            ...(dataFim ? { dataFim } : {}),
          })
        : []

      return reply.view(
        'lancamentos/index',
        {
          title: 'Lançamentos — Gênesis Admin',
          active: 'lancamentos',
          userEmail: req.user.email,
          estados,
          municipios,
          estadoSelecionadoId: estadoId,
          municipio,
          dataInicio,
          dataFim,
          lancamentos,
          limite: LIMITE_LISTAGEM,
        },
        { layout: 'layouts/main' },
      )
    },
  )

  // ── DETAIL (modal) ──────────────────────────────────────────────────────────
  app.get<{ Params: { id: string } }>('/:id/detalhe', async (req, reply) => {
    const lanc = await service.buscarPorId(req.params.id)
    if (!lanc) return reply.status(404).send('Lançamento não encontrado.')

    const [municipio, contas] = await Promise.all([
      app.prisma.municipio.findUnique({
        where: { id: lanc.municipioId },
        include: { estado: { select: { sigla: true, nome: true } } },
      }),
      app.prisma.conta.findMany({
        where: { id: { in: lanc.itens.map((i) => i.contaId) } },
        select: { id: true, codigo: true, descricao: true },
      }),
    ])
    const contasPorId = new Map(contas.map((c) => [c.id, c]))

    return reply.view('lancamentos/detalhe', { lanc, municipio, contasPorId })
  })

  // ── DELETE ──────────────────────────────────────────────────────────────────
  // Service.excluir reverte os incrementos em ResumoMensalConta na mesma tx.
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
