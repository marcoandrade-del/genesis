import type { FastifyInstance } from 'fastify'
import { UnidadesOrcamentariaService } from '../services/unidades-orcamentaria.js'

/**
 * Admin de Unidade Orçamentária. Cascade Estado→Município→Entidade igual ao
 * admin de Lançamentos: UO é cadastrada por entidade (estrutura orgânica
 * própria — secretarias, fundos, autarquias).
 */
export async function adminUnidadesOrcamentariaRoutes(app: FastifyInstance) {
  const service = new UnidadesOrcamentariaService(app.prisma)
  const carregarOrgaos = (entidadeId: string) =>
    app.prisma.orgao.findMany({ where: { entidadeId, ativo: true }, orderBy: { codigo: 'asc' }, select: { id: true, codigo: true, nome: true } })

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
            select: { id: true, nome: true, tipo: true },
          })
        : Promise.resolve([]),
    ])

    const entidade = entidadeId
      ? await app.prisma.entidade.findUnique({
          where: { id: entidadeId },
          include: { municipio: { include: { estado: { select: { id: true, sigla: true, nome: true } } } } },
        })
      : null

    const unidades = entidade ? await service.listar(entidade.id) : []

    return reply.view(
      'unidades-orcamentaria/index',
      {
        title: 'Unidades Orçamentárias — Gênesis Admin',
        active: 'unidades-orcamentaria',
        userEmail: req.user.email,
        estados,
        municipios,
        entidades,
        estadoSelecionadoId: estadoId,
        municipioSelecionadoId: municipioId,
        entidade,
        unidades,
      },
      { layout: 'layouts/main' },
    )
  })

  // ── FORM (novo) ─────────────────────────────────────────────────────────────
  app.get<{ Querystring: { entidadeId?: string } }>('/form', async (req, reply) => {
    const entidadeId = req.query.entidadeId?.trim() || ''
    if (!entidadeId) return reply.status(400).send('Entidade não informada.')
    return reply.view('unidades-orcamentaria/form', { uo: null, entidadeId, erro: null, orgaos: await carregarOrgaos(entidadeId) })
  })

  // ── FORM (editar) ───────────────────────────────────────────────────────────
  app.get<{ Params: { id: string } }>('/:id/form', async (req, reply) => {
    const uo = await app.prisma.unidadeOrcamentaria.findUnique({ where: { id: req.params.id } })
    if (!uo) return reply.status(404).send('Unidade orçamentária não encontrada.')
    return reply.view('unidades-orcamentaria/form', { uo, entidadeId: uo.entidadeId, erro: null, orgaos: await carregarOrgaos(uo.entidadeId) })
  })

  // ── CREATE ──────────────────────────────────────────────────────────────────
  app.post<{ Body: { entidadeId: string; codigo: string; nome: string; ativa?: string; orgaoId?: string } }>(
    '/',
    async (req, reply) => {
      const { entidadeId, codigo, nome, ativa, orgaoId } = req.body
      if (!entidadeId?.trim()) return reply.status(400).send('Entidade não informada.')
      const orgaos = await carregarOrgaos(entidadeId)
      const reRender = (erro: string) =>
        reply.view('unidades-orcamentaria/form', { uo: null, entidadeId, erro, orgaos })

      if (!codigo?.trim()) return reRender('Código é obrigatório.')
      if (!nome?.trim()) return reRender('Nome é obrigatório.')

      try {
        await service.criar(entidadeId, { codigo, nome, ativa: ativa !== 'false', orgaoId })
        return reply.header('HX-Redirect', `/admin/unidades-orcamentaria?entidadeId=${entidadeId}`).status(204).send()
      } catch (e: unknown) {
        return reRender(e instanceof Error ? e.message : 'Erro ao criar unidade orçamentária.')
      }
    },
  )

  // ── UPDATE ──────────────────────────────────────────────────────────────────
  app.put<{ Params: { id: string }; Body: { codigo: string; nome: string; ativa?: string; orgaoId?: string } }>(
    '/:id',
    async (req, reply) => {
      const { codigo, nome, ativa, orgaoId } = req.body
      const uo = await app.prisma.unidadeOrcamentaria.findUnique({ where: { id: req.params.id } })
      if (!uo) return reply.status(404).send('Unidade orçamentária não encontrada.')
      const orgaos = await carregarOrgaos(uo.entidadeId)
      const reRender = (erro: string) =>
        reply.view('unidades-orcamentaria/form', { uo, entidadeId: uo.entidadeId, erro, orgaos })

      if (!codigo?.trim()) return reRender('Código é obrigatório.')
      if (!nome?.trim()) return reRender('Nome é obrigatório.')

      try {
        await service.atualizar(req.params.id, {
          codigo,
          nome,
          ativa: ativa !== 'false',
          orgaoId: orgaoId ?? null,
        })
        return reply
          .header('HX-Redirect', `/admin/unidades-orcamentaria?entidadeId=${uo.entidadeId}`)
          .status(204)
          .send()
      } catch (e: unknown) {
        return reRender(e instanceof Error ? e.message : 'Erro ao atualizar unidade orçamentária.')
      }
    },
  )

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
