import type { FastifyInstance } from 'fastify'
import type { StatusOrcamento } from '@prisma/client'
import { OrcamentosService } from '../services/orcamentos.js'
import { DotacoesDespesaService } from '../services/dotacoes-despesa.js'
import { PrevisoesReceitaService } from '../services/previsoes-receita.js'

// EM_EXECUCAO não entra: é alcançado só pela abertura contábil (/app), a partir
// de PUBLICADO. O admin opera o fluxo de aprovação até a publicação.
const STATUS_VALIDOS: ReadonlyArray<StatusOrcamento> = ['RASCUNHO', 'ENVIADO_AO_LEGISLATIVO', 'APROVADO', 'PUBLICADO']

/**
 * Admin de Orçamentos (LOA): listagem cascata Estado→Município→Entidade,
 * cabeçalho do Orçamento + drill-in para Dotações de Despesa e Previsões de
 * Receita. Fluxo de aprovação RASCUNHO → ENVIADO_AO_LEGISLATIVO → APROVADO →
 * PUBLICADO (→ EM_EXECUCAO via abertura contábil no /app).
 */
export async function adminOrcamentosRoutes(app: FastifyInstance) {
  const orcamentos = new OrcamentosService(app.prisma)
  const dotacoes = new DotacoesDespesaService(app.prisma)
  const previsoes = new PrevisoesReceitaService(app.prisma)

  // ── LIST ────────────────────────────────────────────────────────────────────
  app.get<{
    Querystring: { estadoId?: string; municipioId?: string; entidadeId?: string }
  }>('/', async (req, reply) => {
    const estadoId = req.query.estadoId?.trim() || ''
    const municipioId = req.query.municipioId?.trim() || ''
    const entidadeId = req.query.entidadeId?.trim() || ''

    const [estados, municipios, entidades] = await Promise.all([
      app.prisma.estado.findMany({ orderBy: { sigla: 'asc' }, select: { id: true, sigla: true, nome: true } }),
      estadoId
        ? app.prisma.municipio.findMany({
            where: { estadoId },
            orderBy: { nome: 'asc' },
            select: { id: true, nome: true },
          })
        : Promise.resolve([]),
      municipioId
        ? app.prisma.entidade.findMany({
            where: { municipioId, ativo: true },
            orderBy: { nome: 'asc' },
            select: { id: true, nome: true },
          })
        : Promise.resolve([]),
    ])

    const entidade = entidadeId
      ? await app.prisma.entidade.findUnique({
          where: { id: entidadeId },
          include: { municipio: { include: { estado: { select: { sigla: true, nome: true } } } } },
        })
      : null

    const lista = entidade ? await orcamentos.listar(entidade.id) : []

    return reply.view(
      'orcamentos/index',
      {
        title: 'Orçamentos (LOA) — Gênesis Admin',
        active: 'orcamentos',
        userEmail: req.user.email,
        estados,
        municipios,
        entidades,
        estadoSelecionadoId: estadoId,
        municipioSelecionadoId: municipioId,
        entidade,
        orcamentos: lista,
      },
      { layout: 'layouts/main' },
    )
  })

  // ── FORM Orçamento (novo) ───────────────────────────────────────────────────
  app.get<{ Querystring: { entidadeId?: string } }>('/form', async (req, reply) => {
    const entidadeId = req.query.entidadeId?.trim() || ''
    if (!entidadeId) return reply.status(400).send('Entidade não informada.')
    return reply.view('orcamentos/form', { orcamento: null, entidadeId, erro: null })
  })

  // ── FORM Orçamento (editar) ─────────────────────────────────────────────────
  app.get<{ Params: { id: string } }>('/:id/form', async (req, reply) => {
    const orc = await app.prisma.orcamento.findUnique({ where: { id: req.params.id } })
    if (!orc) return reply.status(404).send('Orçamento não encontrado.')
    return reply.view('orcamentos/form', { orcamento: orc, entidadeId: orc.entidadeId, erro: null })
  })

  // ── CREATE Orçamento ────────────────────────────────────────────────────────
  app.post<{
    Body: { entidadeId: string; ano: string; leiNumero?: string; dataAprovacao?: string; observacoes?: string }
  }>('/', async (req, reply) => {
    const { entidadeId, leiNumero, dataAprovacao, observacoes } = req.body
    const ano = parseInt((req.body.ano ?? '').trim(), 10)
    if (!entidadeId?.trim()) return reply.status(400).send('Entidade não informada.')

    const reRender = (erro: string) =>
      reply.view('orcamentos/form', {
        orcamento: { ano, leiNumero, dataAprovacao, observacoes },
        entidadeId,
        erro,
      })

    try {
      await orcamentos.criar(entidadeId, ano, { leiNumero, dataAprovacao, observacoes })
      const qs = new URLSearchParams({ entidadeId }).toString()
      return reply.header('HX-Redirect', `/admin/orcamentos?${qs}`).status(204).send()
    } catch (e: unknown) {
      return reRender(e instanceof Error ? e.message : 'Erro ao criar orçamento.')
    }
  })

  // ── UPDATE Orçamento (cabeçalho) ────────────────────────────────────────────
  app.put<{
    Params: { id: string }
    Body: { leiNumero?: string; dataAprovacao?: string; observacoes?: string }
  }>('/:id', async (req, reply) => {
    const existente = await app.prisma.orcamento.findUnique({ where: { id: req.params.id } })
    if (!existente) return reply.status(404).send('Orçamento não encontrado.')
    const reRender = (erro: string) =>
      reply.view('orcamentos/form', {
        orcamento: { ...existente, ...req.body },
        entidadeId: existente.entidadeId,
        erro,
      })
    try {
      await orcamentos.atualizar(req.params.id, { ...req.body })
      const qs = new URLSearchParams({ entidadeId: existente.entidadeId }).toString()
      return reply.header('HX-Redirect', `/admin/orcamentos?${qs}`).status(204).send()
    } catch (e: unknown) {
      return reRender(e instanceof Error ? e.message : 'Erro ao atualizar orçamento.')
    }
  })

  // ── STATUS (fluxo de aprovação da LOA) ──────────────────────────────────────
  app.post<{ Params: { id: string }; Body: { status: string; observacao?: string } }>('/:id/status', async (req, reply) => {
    const novoStatus = req.body.status as StatusOrcamento
    if (!STATUS_VALIDOS.includes(novoStatus)) return reply.status(400).send('Status inválido.')
    try {
      await orcamentos.alterarStatus(req.params.id, novoStatus, req.user.sub, req.body.observacao)
      return reply.header('HX-Redirect', `/admin/orcamentos/${req.params.id}`).status(204).send()
    } catch (e: unknown) {
      return reply.status(400).send(e instanceof Error ? e.message : 'Erro ao alterar status.')
    }
  })

  // ── DELETE Orçamento ────────────────────────────────────────────────────────
  app.delete<{ Params: { id: string } }>('/:id', async (req, reply) => {
    try {
      await orcamentos.excluir(req.params.id)
      return reply.status(200).send('')
    } catch (e: unknown) {
      return reply.status(400).send(e instanceof Error ? e.message : 'Erro ao excluir.')
    }
  })

  // ── DRILL Orçamento (detalhe = dotações + previsões) ────────────────────────
  app.get<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const orcamento = await orcamentos.buscarPorId(req.params.id)
    if (!orcamento) return reply.status(404).send('Orçamento não encontrado.')
    const [dots, prevs, trilha] = await Promise.all([
      dotacoes.listar(orcamento.id),
      previsoes.listar(orcamento.id),
      orcamentos.trilha(orcamento.id),
    ])
    const totalDespesa = dots.reduce((acc, d) => acc + Number(d.valorAutorizado), 0)
    const totalReceita = prevs.reduce((acc, p) => acc + Number(p.valorPrevisto), 0)
    return reply.view(
      'orcamentos/detalhe',
      {
        title: `Orçamento ${orcamento.ano} — Gênesis Admin`,
        active: 'orcamentos',
        userEmail: req.user.email,
        orcamento,
        dotacoes: dots,
        previsoes: prevs,
        trilha,
        totalDespesa,
        totalReceita,
      },
      { layout: 'layouts/main' },
    )
  })

  // ── FORM Dotação (nova) ─────────────────────────────────────────────────────
  app.get<{ Querystring: { orcamentoId?: string } }>('/dotacoes/form', async (req, reply) => {
    const orcamentoId = req.query.orcamentoId?.trim() || ''
    if (!orcamentoId) return reply.status(400).send('Orçamento não informado.')
    const orc = await app.prisma.orcamento.findUnique({ where: { id: orcamentoId } })
    if (!orc) return reply.status(404).send('Orçamento não encontrado.')
    const lookups = await carregarLookupsDespesa(app, orc.entidadeId, orc.ano)
    return reply.view('orcamentos/dotacao_form', { dotacao: null, orcamentoId, ...lookups, erro: null })
  })

  // ── FORM Dotação (editar) ───────────────────────────────────────────────────
  app.get<{ Params: { id: string } }>('/dotacoes/:id/form', async (req, reply) => {
    const dotacao = await app.prisma.dotacaoDespesa.findUnique({ where: { id: req.params.id } })
    if (!dotacao) return reply.status(404).send('Dotação não encontrada.')
    const orc = await app.prisma.orcamento.findUnique({ where: { id: dotacao.orcamentoId } })
    if (!orc) return reply.status(404).send('Orçamento não encontrado.')
    const lookups = await carregarLookupsDespesa(app, orc.entidadeId, orc.ano)
    return reply.view('orcamentos/dotacao_form', {
      dotacao,
      orcamentoId: dotacao.orcamentoId,
      ...lookups,
      erro: null,
    })
  })

  // ── CREATE Dotação ──────────────────────────────────────────────────────────
  app.post<{
    Body: {
      orcamentoId: string
      unidadeOrcamentariaId: string
      funcaoId: string
      subfuncaoId: string
      programaId: string
      acaoId: string
      contaDespesaEntidadeId: string
      fonteRecursoEntidadeId: string
      valorAutorizado: string
    }
  }>('/dotacoes', async (req, reply) => {
    const { orcamentoId, ...dados } = req.body
    try {
      await dotacoes.criar(orcamentoId, dados)
      return reply.header('HX-Redirect', `/admin/orcamentos/${orcamentoId}`).status(204).send()
    } catch (e: unknown) {
      return reply.status(400).send(e instanceof Error ? e.message : 'Erro ao criar dotação.')
    }
  })

  // ── UPDATE Dotação ──────────────────────────────────────────────────────────
  app.put<{
    Params: { id: string }
    Body: {
      unidadeOrcamentariaId: string
      funcaoId: string
      subfuncaoId: string
      programaId: string
      acaoId: string
      contaDespesaEntidadeId: string
      fonteRecursoEntidadeId: string
      valorAutorizado: string
    }
  }>('/dotacoes/:id', async (req, reply) => {
    const existente = await app.prisma.dotacaoDespesa.findUnique({ where: { id: req.params.id } })
    if (!existente) return reply.status(404).send('Dotação não encontrada.')
    try {
      await dotacoes.atualizar(req.params.id, req.body)
      return reply.header('HX-Redirect', `/admin/orcamentos/${existente.orcamentoId}`).status(204).send()
    } catch (e: unknown) {
      return reply.status(400).send(e instanceof Error ? e.message : 'Erro ao atualizar dotação.')
    }
  })

  // ── DELETE Dotação ──────────────────────────────────────────────────────────
  app.delete<{ Params: { id: string } }>('/dotacoes/:id', async (req, reply) => {
    try {
      await dotacoes.excluir(req.params.id)
      return reply.status(200).send('')
    } catch (e: unknown) {
      return reply.status(400).send(e instanceof Error ? e.message : 'Erro ao excluir.')
    }
  })

  // ── FORM Previsão (nova) ────────────────────────────────────────────────────
  app.get<{ Querystring: { orcamentoId?: string } }>('/previsoes/form', async (req, reply) => {
    const orcamentoId = req.query.orcamentoId?.trim() || ''
    if (!orcamentoId) return reply.status(400).send('Orçamento não informado.')
    const orc = await app.prisma.orcamento.findUnique({ where: { id: orcamentoId } })
    if (!orc) return reply.status(404).send('Orçamento não encontrado.')
    const lookups = await carregarLookupsReceita(app, orc.entidadeId, orc.ano)
    return reply.view('orcamentos/previsao_form', { previsao: null, orcamentoId, ...lookups, erro: null })
  })

  // ── FORM Previsão (editar) ──────────────────────────────────────────────────
  app.get<{ Params: { id: string } }>('/previsoes/:id/form', async (req, reply) => {
    const previsao = await app.prisma.previsaoReceita.findUnique({ where: { id: req.params.id } })
    if (!previsao) return reply.status(404).send('Previsão não encontrada.')
    const orc = await app.prisma.orcamento.findUnique({ where: { id: previsao.orcamentoId } })
    if (!orc) return reply.status(404).send('Orçamento não encontrado.')
    const lookups = await carregarLookupsReceita(app, orc.entidadeId, orc.ano)
    return reply.view('orcamentos/previsao_form', {
      previsao,
      orcamentoId: previsao.orcamentoId,
      ...lookups,
      erro: null,
    })
  })

  // ── CREATE Previsão ─────────────────────────────────────────────────────────
  app.post<{
    Body: {
      orcamentoId: string
      contaReceitaEntidadeId: string
      fonteRecursoEntidadeId: string
      valorPrevisto: string
    }
  }>('/previsoes', async (req, reply) => {
    const { orcamentoId, ...dados } = req.body
    try {
      await previsoes.criar(orcamentoId, dados)
      return reply.header('HX-Redirect', `/admin/orcamentos/${orcamentoId}`).status(204).send()
    } catch (e: unknown) {
      return reply.status(400).send(e instanceof Error ? e.message : 'Erro ao criar previsão.')
    }
  })

  // ── UPDATE Previsão ─────────────────────────────────────────────────────────
  app.put<{
    Params: { id: string }
    Body: { contaReceitaEntidadeId: string; fonteRecursoEntidadeId: string; valorPrevisto: string }
  }>('/previsoes/:id', async (req, reply) => {
    const existente = await app.prisma.previsaoReceita.findUnique({ where: { id: req.params.id } })
    if (!existente) return reply.status(404).send('Previsão não encontrada.')
    try {
      await previsoes.atualizar(req.params.id, req.body)
      return reply.header('HX-Redirect', `/admin/orcamentos/${existente.orcamentoId}`).status(204).send()
    } catch (e: unknown) {
      return reply.status(400).send(e instanceof Error ? e.message : 'Erro ao atualizar previsão.')
    }
  })

  // ── DELETE Previsão ─────────────────────────────────────────────────────────
  app.delete<{ Params: { id: string } }>('/previsoes/:id', async (req, reply) => {
    try {
      await previsoes.excluir(req.params.id)
      return reply.status(200).send('')
    } catch (e: unknown) {
      return reply.status(400).send(e instanceof Error ? e.message : 'Erro ao excluir.')
    }
  })
}

async function carregarLookupsDespesa(app: FastifyInstance, entidadeId: string, ano: number) {
  const [unidades, funcoes, programas, contas, fontes] = await Promise.all([
    app.prisma.unidadeOrcamentaria.findMany({
      where: { entidadeId, ativa: true },
      orderBy: { codigo: 'asc' },
      select: { id: true, codigo: true, nome: true },
    }),
    app.prisma.funcao.findMany({
      orderBy: { codigo: 'asc' },
      select: {
        id: true,
        codigo: true,
        nome: true,
        subfuncoes: { orderBy: { codigo: 'asc' }, select: { id: true, codigo: true, nome: true } },
      },
    }),
    app.prisma.programa.findMany({
      where: { entidadeId, ano, ativo: true },
      orderBy: { codigo: 'asc' },
      select: {
        id: true,
        codigo: true,
        nome: true,
        acoes: {
          where: { ativa: true },
          orderBy: { codigo: 'asc' },
          select: { id: true, codigo: true, nome: true },
        },
      },
    }),
    app.prisma.contaDespesaEntidade.findMany({
      where: { entidadeId, ano, admiteMovimento: true },
      orderBy: { codigo: 'asc' },
      select: { id: true, codigo: true, descricao: true },
    }),
    app.prisma.fonteRecursoEntidade.findMany({
      where: { entidadeId, ano },
      orderBy: { codigo: 'asc' },
      select: { id: true, codigo: true, nomenclatura: true },
    }),
  ])
  return { unidades, funcoes, programas, contas, fontes }
}

async function carregarLookupsReceita(app: FastifyInstance, entidadeId: string, ano: number) {
  const [contas, fontes] = await Promise.all([
    app.prisma.contaReceitaEntidade.findMany({
      where: { entidadeId, ano, admiteMovimento: true },
      orderBy: { codigo: 'asc' },
      select: { id: true, codigo: true, descricao: true },
    }),
    app.prisma.fonteRecursoEntidade.findMany({
      where: { entidadeId, ano },
      orderBy: { codigo: 'asc' },
      select: { id: true, codigo: true, nomenclatura: true },
    }),
  ])
  return { contas, fontes }
}
