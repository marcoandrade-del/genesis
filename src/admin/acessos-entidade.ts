import type { FastifyInstance } from 'fastify'
import type { NivelAcessoEntidade } from '@prisma/client'
import { AcessosEntidadeService } from '../services/acessos-entidade.js'
import { SolicitacoesAcessoService } from '../services/solicitacoes-acesso.js'

const NIVEIS_VALIDOS: ReadonlyArray<NivelAcessoEntidade> = ['LEITURA', 'ESCRITA', 'ADMIN']

/**
 * Admin de Acessos à Entidade. Por usuário: lista acessos atuais + cascade
 * Estado→Município→Entidade para conceder novos. Suporta edição de nível e
 * revogação. Fluxo é por-usuário (não por-entidade) porque o admin tipicamente
 * abre o cadastro do usuário e ajusta os acessos dele.
 */
export async function adminAcessosEntidadeRoutes(app: FastifyInstance) {
  const acessos = new AcessosEntidadeService(app.prisma)
  const solicitacoesSvc = new SolicitacoesAcessoService(app.prisma)

  // ── Fila de solicitações de acesso pendentes (admin do sistema) ─────────────
  app.get('/solicitacoes', async (req, reply) => {
    const pendentes = await solicitacoesSvc.listarPendentes()
    return reply.view(
      'acessos-entidade/solicitacoes',
      {
        title: 'Solicitações de acesso — Gênesis Admin',
        active: 'solicitacoes-acesso',
        userEmail: req.user.email,
        pendentes,
        niveis: NIVEIS_VALIDOS,
      },
      { layout: 'layouts/main' },
    )
  })

  // ── APROVAR (POST) — cria/ativa o acesso no nível decidido ───────────────────
  app.post<{ Params: { id: string }; Body: { nivelConcedido?: string; observacao?: string } }>(
    '/solicitacoes/:id/aprovar',
    async (req, reply) => {
      try {
        await solicitacoesSvc.aprovar(
          req.params.id,
          req.user.sub,
          (req.body.nivelConcedido ?? '') as NivelAcessoEntidade,
          req.body.observacao,
        )
        return reply.header('HX-Redirect', '/admin/acessos-entidade/solicitacoes').status(204).send()
      } catch (e: unknown) {
        return reply.status(400).send(e instanceof Error ? e.message : 'Erro ao aprovar solicitação.')
      }
    },
  )

  // ── REJEITAR (POST) ─────────────────────────────────────────────────────────
  app.post<{ Params: { id: string }; Body: { observacao?: string } }>(
    '/solicitacoes/:id/rejeitar',
    async (req, reply) => {
      try {
        await solicitacoesSvc.rejeitar(req.params.id, req.user.sub, req.body.observacao)
        return reply.header('HX-Redirect', '/admin/acessos-entidade/solicitacoes').status(204).send()
      } catch (e: unknown) {
        return reply.status(400).send(e instanceof Error ? e.message : 'Erro ao rejeitar solicitação.')
      }
    },
  )

  // ── Página principal: acessos de um usuário ─────────────────────────────────
  app.get<{
    Params: { usuarioId: string }
    Querystring: { estadoId?: string; municipioId?: string }
  }>('/usuario/:usuarioId', async (req, reply) => {
    const usuario = await app.prisma.usuario.findUnique({
      where: { id: req.params.usuarioId },
      select: { id: true, nomeCompleto: true, emailPrincipal: true },
    })
    if (!usuario) return reply.status(404).send('Usuário não encontrado.')

    const estadoId = req.query.estadoId?.trim() || ''
    const municipioId = req.query.municipioId?.trim() || ''

    const [lista, estados, municipios, entidadesDisponiveis] = await Promise.all([
      acessos.listarPorUsuario(usuario.id),
      app.prisma.estado.findMany({
        orderBy: { sigla: 'asc' },
        select: { id: true, sigla: true, nome: true },
      }),
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

    const jaConcedidasIds = new Set(lista.map((a) => a.entidadeId))
    const entidades = entidadesDisponiveis.filter((e) => !jaConcedidasIds.has(e.id))

    return reply.view(
      'acessos-entidade/usuario',
      {
        title: `Acessos de ${usuario.nomeCompleto} — Gênesis Admin`,
        active: 'usuarios',
        userEmail: req.user.email,
        usuario,
        acessos: lista,
        estados,
        municipios,
        entidades,
        estadoSelecionadoId: estadoId,
        municipioSelecionadoId: municipioId,
        niveis: NIVEIS_VALIDOS,
      },
      { layout: 'layouts/main' },
    )
  })

  // ── CONCEDER (POST) ─────────────────────────────────────────────────────────
  app.post<{
    Body: { usuarioId: string; entidadeId: string; nivel: string }
  }>('/', async (req, reply) => {
    const { usuarioId, entidadeId, nivel } = req.body
    try {
      await acessos.conceder({ usuarioId, entidadeId, nivel: nivel as NivelAcessoEntidade })
      return reply
        .header('HX-Redirect', `/admin/acessos-entidade/usuario/${usuarioId}`)
        .status(204)
        .send()
    } catch (e: unknown) {
      return reply.status(400).send(e instanceof Error ? e.message : 'Erro ao conceder acesso.')
    }
  })

  // ── FORM edição (GET) ───────────────────────────────────────────────────────
  app.get<{ Params: { id: string } }>('/:id/form', async (req, reply) => {
    const acesso = await app.prisma.acessoEntidade.findUnique({
      where: { id: req.params.id },
      include: { entidade: true },
    })
    if (!acesso) return reply.status(404).send('Acesso não encontrado.')
    return reply.view('acessos-entidade/form', { acesso, niveis: NIVEIS_VALIDOS, erro: null })
  })

  // ── ATUALIZAR (PUT) ─────────────────────────────────────────────────────────
  app.put<{
    Params: { id: string }
    Body: { nivel?: string; ativo?: string }
  }>('/:id', async (req, reply) => {
    const existente = await app.prisma.acessoEntidade.findUnique({ where: { id: req.params.id } })
    if (!existente) return reply.status(404).send('Acesso não encontrado.')

    // Checkbox HTML não envia nada quando desmarcado: ausência = false.
    const ativo = req.body.ativo === 'true'
    try {
      await acessos.atualizar(req.params.id, {
        ...(req.body.nivel !== undefined ? { nivel: req.body.nivel as NivelAcessoEntidade } : {}),
        ativo,
      })
      return reply
        .header('HX-Redirect', `/admin/acessos-entidade/usuario/${existente.usuarioId}`)
        .status(204)
        .send()
    } catch (e: unknown) {
      return reply.status(400).send(e instanceof Error ? e.message : 'Erro ao atualizar acesso.')
    }
  })

  // ── REVOGAR (DELETE) ────────────────────────────────────────────────────────
  app.delete<{ Params: { id: string } }>('/:id', async (req, reply) => {
    try {
      await acessos.revogar(req.params.id)
      return reply.status(200).send('')
    } catch (e: unknown) {
      return reply.status(400).send(e instanceof Error ? e.message : 'Erro ao revogar acesso.')
    }
  })
}
