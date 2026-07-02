import type { FastifyInstance } from 'fastify'
import type { TipoMetaFiscal } from '@prisma/client'
import { MetasFiscaisService, ROTULO_META, TIPOS_META } from '../services/metas-fiscais.js'

/**
 * Admin de Metas Fiscais (LDO, LRF art. 4º §1º). Cascade Estado→Município→
 * Entidade + exercício; uma meta por tipo/ano (unique). Espelha o admin de
 * Órgãos; o comparativo meta × projetado vive nos relatórios do /app.
 */
export async function adminMetasFiscaisRoutes(app: FastifyInstance) {
  const service = new MetasFiscaisService(app.prisma)

  // ── LIST ────────────────────────────────────────────────────────────────────
  app.get<{ Querystring: { estadoId?: string; municipioId?: string; entidadeId?: string; ano?: string } }>('/', async (req, reply) => {
    const estadoId = req.query.estadoId?.trim() || ''
    const municipioId = req.query.municipioId?.trim() || ''
    const entidadeId = req.query.entidadeId?.trim() || ''
    const ano = parseInt(req.query.ano ?? '', 10) || new Date().getFullYear()

    const [estados, municipios, entidades] = await Promise.all([
      app.prisma.estado.findMany({ orderBy: { sigla: 'asc' }, select: { id: true, sigla: true, nome: true } }),
      estadoId ? app.prisma.municipio.findMany({ where: { estadoId }, orderBy: { nome: 'asc' }, select: { id: true, nome: true } }) : Promise.resolve([]),
      municipioId ? app.prisma.entidade.findMany({ where: { municipioId, ativo: true }, orderBy: { nome: 'asc' }, select: { id: true, nome: true } }) : Promise.resolve([]),
    ])

    const entidade = entidadeId
      ? await app.prisma.entidade.findUnique({ where: { id: entidadeId }, include: { municipio: { include: { estado: { select: { sigla: true, nome: true } } } } } })
      : null

    const metas = entidade ? await service.listar(entidade.id, ano) : []
    return reply.view(
      'metas-fiscais/index',
      { title: 'Metas Fiscais — Gênesis Admin', active: 'metas-fiscais', userEmail: req.user.email, estados, municipios, entidades, estadoSelecionadoId: estadoId, municipioSelecionadoId: municipioId, entidade, ano, metas, rotulos: ROTULO_META },
      { layout: 'layouts/main' },
    )
  })

  // ── FORM (novo) ─────────────────────────────────────────────────────────────
  app.get<{ Querystring: { entidadeId?: string; ano?: string } }>('/form', async (req, reply) => {
    const entidadeId = req.query.entidadeId?.trim() || ''
    if (!entidadeId) return reply.status(400).send('Entidade não informada.')
    const ano = parseInt(req.query.ano ?? '', 10) || new Date().getFullYear()
    return reply.view('metas-fiscais/form', { meta: null, entidadeId, ano, tipos: TIPOS_META, rotulos: ROTULO_META, erro: null })
  })

  // ── FORM (editar) ───────────────────────────────────────────────────────────
  app.get<{ Params: { id: string } }>('/:id/form', async (req, reply) => {
    const meta = await app.prisma.metaFiscal.findUnique({ where: { id: req.params.id } })
    if (!meta) return reply.status(404).send('Meta não encontrada.')
    return reply.view('metas-fiscais/form', { meta, entidadeId: meta.entidadeId, ano: meta.ano, tipos: TIPOS_META, rotulos: ROTULO_META, erro: null })
  })

  const parseValor = (v: string | undefined) => {
    const n = Number(String(v ?? '').replace(/\./g, '').replace(',', '.'))
    return Number.isFinite(n) ? n : null
  }

  // ── CREATE ──────────────────────────────────────────────────────────────────
  app.post<{ Body: { entidadeId: string; ano: string; tipo: string; valorMeta: string; exercicioReferencia: string } }>('/', async (req, reply) => {
    const { entidadeId, ano, tipo, valorMeta, exercicioReferencia } = req.body
    const reRender = (erro: string) =>
      reply.view('metas-fiscais/form', { meta: null, entidadeId, ano: parseInt(ano, 10), tipos: TIPOS_META, rotulos: ROTULO_META, erro })
    if (!entidadeId?.trim()) return reply.status(400).send('Entidade não informada.')
    if (!TIPOS_META.includes(tipo as TipoMetaFiscal)) return reRender('Tipo de meta inválido.')
    const valor = parseValor(valorMeta)
    if (valor == null) return reRender('Valor da meta é obrigatório.')
    const ref = parseInt(exercicioReferencia, 10)
    if (!Number.isInteger(ref) || ref < 1900) return reRender('Exercício de referência (ano da LDO) é obrigatório.')
    try {
      await service.criar({ entidadeId, ano: parseInt(ano, 10), tipo: tipo as TipoMetaFiscal, valorMeta: valor, exercicioReferencia: ref })
      return reply.header('HX-Redirect', `/admin/metas-fiscais?entidadeId=${entidadeId}&ano=${ano}`).status(204).send()
    } catch (e: unknown) {
      const msg = e instanceof Error && e.message.includes('Unique') ? 'Já existe meta deste tipo para o exercício.' : e instanceof Error ? e.message : 'Erro ao criar meta.'
      return reRender(msg)
    }
  })

  // ── UPDATE ──────────────────────────────────────────────────────────────────
  app.put<{ Params: { id: string }; Body: { valorMeta: string; exercicioReferencia: string } }>('/:id', async (req, reply) => {
    const meta = await app.prisma.metaFiscal.findUnique({ where: { id: req.params.id } })
    if (!meta) return reply.status(404).send('Meta não encontrada.')
    const reRender = (erro: string) =>
      reply.view('metas-fiscais/form', { meta, entidadeId: meta.entidadeId, ano: meta.ano, tipos: TIPOS_META, rotulos: ROTULO_META, erro })
    const valor = parseValor(req.body.valorMeta)
    if (valor == null) return reRender('Valor da meta é obrigatório.')
    const ref = parseInt(req.body.exercicioReferencia, 10)
    if (!Number.isInteger(ref) || ref < 1900) return reRender('Exercício de referência (ano da LDO) é obrigatório.')
    try {
      await service.atualizar(req.params.id, { valorMeta: valor, exercicioReferencia: ref })
      return reply.header('HX-Redirect', `/admin/metas-fiscais?entidadeId=${meta.entidadeId}&ano=${meta.ano}`).status(204).send()
    } catch (e: unknown) {
      return reRender(e instanceof Error ? e.message : 'Erro ao atualizar meta.')
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
