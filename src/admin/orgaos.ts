import type { FastifyInstance } from 'fastify'
import { OrgaosService } from '../services/orgaos.js'

/**
 * Admin de Órgão (classificação institucional — nível pai da Unidade
 * Orçamentária). Cascade Estado→Município→Entidade; cadastrado por entidade.
 * Espelha o admin de Unidades Orçamentárias.
 */
export async function adminOrgaosRoutes(app: FastifyInstance) {
  const service = new OrgaosService(app.prisma)

  // ── LIST ────────────────────────────────────────────────────────────────────
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

    const orgaos = entidade ? await service.listar(entidade.id) : []
    return reply.view(
      'orgaos/index',
      { title: 'Órgãos — Gênesis Admin', active: 'orgaos', userEmail: req.user.email, estados, municipios, entidades, estadoSelecionadoId: estadoId, municipioSelecionadoId: municipioId, entidade, orgaos },
      { layout: 'layouts/main' },
    )
  })

  // ── FORM (novo) ─────────────────────────────────────────────────────────────
  app.get<{ Querystring: { entidadeId?: string } }>('/form', async (req, reply) => {
    const entidadeId = req.query.entidadeId?.trim() || ''
    if (!entidadeId) return reply.status(400).send('Entidade não informada.')
    return reply.view('orgaos/form', { orgao: null, entidadeId, erro: null })
  })

  // ── FORM (editar) ───────────────────────────────────────────────────────────
  app.get<{ Params: { id: string } }>('/:id/form', async (req, reply) => {
    const orgao = await app.prisma.orgao.findUnique({ where: { id: req.params.id } })
    if (!orgao) return reply.status(404).send('Órgão não encontrado.')
    return reply.view('orgaos/form', { orgao, entidadeId: orgao.entidadeId, erro: null })
  })

  // ── CREATE ──────────────────────────────────────────────────────────────────
  app.post<{ Body: { entidadeId: string; codigo: string; nome: string; ativo?: string } }>('/', async (req, reply) => {
    const { entidadeId, codigo, nome, ativo } = req.body
    const reRender = (erro: string) => reply.view('orgaos/form', { orgao: null, entidadeId, erro })
    if (!entidadeId?.trim()) return reply.status(400).send('Entidade não informada.')
    if (!codigo?.trim()) return reRender('Código é obrigatório.')
    if (!nome?.trim()) return reRender('Nome é obrigatório.')
    try {
      await service.criar(entidadeId, { codigo, nome, ativo: ativo !== 'false' })
      return reply.header('HX-Redirect', `/admin/orgaos?entidadeId=${entidadeId}`).status(204).send()
    } catch (e: unknown) {
      return reRender(e instanceof Error ? e.message : 'Erro ao criar órgão.')
    }
  })

  // ── UPDATE ──────────────────────────────────────────────────────────────────
  app.put<{ Params: { id: string }; Body: { codigo: string; nome: string; ativo?: string } }>('/:id', async (req, reply) => {
    const { codigo, nome, ativo } = req.body
    const orgao = await app.prisma.orgao.findUnique({ where: { id: req.params.id } })
    if (!orgao) return reply.status(404).send('Órgão não encontrado.')
    const reRender = (erro: string) => reply.view('orgaos/form', { orgao, entidadeId: orgao.entidadeId, erro })
    if (!codigo?.trim()) return reRender('Código é obrigatório.')
    if (!nome?.trim()) return reRender('Nome é obrigatório.')
    try {
      await service.atualizar(req.params.id, { codigo, nome, ativo: ativo !== 'false' })
      return reply.header('HX-Redirect', `/admin/orgaos?entidadeId=${orgao.entidadeId}`).status(204).send()
    } catch (e: unknown) {
      return reRender(e instanceof Error ? e.message : 'Erro ao atualizar órgão.')
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
