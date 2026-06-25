import type { FastifyInstance } from 'fastify'
import type { NivelAcessoEntidade } from '@prisma/client'
import { SolicitacoesAcessoService } from '../services/solicitacoes-acesso.js'
import { ErroNegocio } from '../errors.js'

const NIVEIS_VALIDOS: ReadonlyArray<NivelAcessoEntidade> = ['LEITURA', 'ESCRITA', 'ADMIN']

type SituacaoEntidade = 'disponivel' | 'tem_acesso' | 'pendente'

/**
 * Fluxo do operador para SOLICITAR acesso a uma entidade. Acessível mesmo sem
 * contexto/acesso (ver exceções no appContextoMiddleware), para o usuário novo
 * conseguir pedir. A aprovação acontece no /admin (PR-1) ou pelo admin da
 * entidade (PR-2).
 */
export async function appSolicitacaoAcessoRoutes(app: FastifyInstance) {
  const solicitacoes = new SolicitacoesAcessoService(app.prisma)

  // ── GET: busca de entidade + formulário de solicitação ──────────────────────
  app.get<{ Querystring: { q?: string; erro?: string } }>('/solicitar-acesso', async (req, reply) => {
    const q = (req.query.q ?? '').trim()
    let entidades: Array<{
      id: string
      nome: string
      municipio: string
      estado: string
      situacao: SituacaoEntidade
    }> = []

    if (q.length >= 2) {
      const [achadas, acessos, pendentes] = await Promise.all([
        app.prisma.entidade.findMany({
          where: {
            ativo: true,
            OR: [
              { nome: { contains: q, mode: 'insensitive' } },
              { municipio: { nome: { contains: q, mode: 'insensitive' } } },
            ],
          },
          include: { municipio: { include: { estado: { select: { sigla: true } } } } },
          orderBy: [{ municipio: { nome: 'asc' } }, { nome: 'asc' }],
          take: 50,
        }),
        app.prisma.acessoEntidade.findMany({
          where: { usuarioId: req.user.sub, ativo: true },
          select: { entidadeId: true },
        }),
        app.prisma.solicitacaoAcessoEntidade.findMany({
          where: { usuarioId: req.user.sub, status: 'PENDENTE' },
          select: { entidadeId: true },
        }),
      ])
      const comAcesso = new Set(acessos.map((a) => a.entidadeId))
      const comPendente = new Set(pendentes.map((s) => s.entidadeId))
      entidades = achadas.map((e) => ({
        id: e.id,
        nome: e.nome,
        municipio: e.municipio.nome,
        estado: e.municipio.estado.sigla,
        situacao: comAcesso.has(e.id) ? 'tem_acesso' : comPendente.has(e.id) ? 'pendente' : 'disponivel',
      }))
    }

    return reply.view('app/solicitar-acesso', {
      q,
      entidades,
      niveis: NIVEIS_VALIDOS,
      erro: req.query.erro ?? null,
      layout: null,
    })
  })

  // ── POST: cria a solicitação ────────────────────────────────────────────────
  app.post<{ Body: { entidadeId?: string; nivelSolicitado?: string; justificativa?: string } }>(
    '/solicitar-acesso',
    async (req, reply) => {
      try {
        await solicitacoes.criar({
          usuarioId: req.user.sub,
          entidadeId: req.body.entidadeId ?? '',
          nivelSolicitado: req.body.nivelSolicitado ?? '',
          justificativa: req.body.justificativa,
        })
        return reply.redirect('/app/minhas-solicitacoes')
      } catch (e) {
        const msg = e instanceof ErroNegocio ? e.message : 'Erro ao solicitar acesso.'
        return reply.redirect('/app/solicitar-acesso?erro=' + encodeURIComponent(msg))
      }
    },
  )

  // ── GET: minhas solicitações ────────────────────────────────────────────────
  app.get('/minhas-solicitacoes', async (req, reply) => {
    const lista = await solicitacoes.listarMinhas(req.user.sub)
    return reply.view('app/minhas-solicitacoes', { lista, layout: null })
  })

  // ── POST: cancelar a própria solicitação ────────────────────────────────────
  app.post<{ Params: { id: string } }>('/minhas-solicitacoes/:id/cancelar', async (req, reply) => {
    try {
      await solicitacoes.cancelar(req.params.id, req.user.sub)
    } catch {
      /* idempotente: já decidida/cancelada ou não é do usuário — só volta à lista */
    }
    return reply.redirect('/app/minhas-solicitacoes')
  })
}
