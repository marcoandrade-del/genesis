import type { FastifyInstance } from 'fastify'
import type { NivelAcessoEntidade } from '@prisma/client'
import { SolicitacoesAcessoService } from '../services/solicitacoes-acesso.js'
import { AcessosEntidadeService } from '../services/acessos-entidade.js'
import { ErroNegocio } from '../errors.js'

const NIVEIS_VALIDOS: ReadonlyArray<NivelAcessoEntidade> = ['LEITURA', 'ESCRITA', 'ADMIN']

const msgErro = (e: unknown, fallback: string) =>
  '/app/entidade/acessos?erro=' + encodeURIComponent(e instanceof ErroNegocio ? e.message : fallback)

/**
 * Painel do ADMIN da entidade no /app: aprova/rejeita as solicitações da SUA
 * entidade e gerencia (nível/revogação) os acessos existentes — sem depender
 * do admin do sistema (PR-2, "autoconcessão" delegada). Tudo escopado à
 * entidade do contexto; a autoridade vem de `req.contexto.nivel === 'ADMIN'`.
 */
export async function appEntidadeAcessosRoutes(app: FastifyInstance) {
  const solicitacoes = new SolicitacoesAcessoService(app.prisma)
  const acessosSvc = new AcessosEntidadeService(app.prisma)

  // Só o ADMIN da entidade do contexto entra aqui.
  app.addHook('onRequest', async (req, reply) => {
    if (req.contexto?.nivel !== 'ADMIN') return reply.redirect('/app')
  })

  // ── Painel ──────────────────────────────────────────────────────────────────
  app.get<{ Querystring: { erro?: string } }>('/entidade/acessos', async (req, reply) => {
    const entidadeId = req.contexto.entidadeId
    const [entidade, pendentes, acessos] = await Promise.all([
      app.prisma.entidade.findUnique({
        where: { id: entidadeId },
        select: { nome: true, municipio: { select: { nome: true, estado: { select: { sigla: true } } } } },
      }),
      solicitacoes.listarPendentesDaEntidade(entidadeId),
      acessosSvc.listarPorEntidade(entidadeId),
    ])
    return reply.view('app/entidade-acessos', {
      entidade,
      ano: req.contexto.ano,
      nivel: req.contexto.nivel,
      pendentes,
      acessos,
      niveis: NIVEIS_VALIDOS,
      meuId: req.user.sub,
      erro: req.query.erro ?? null,
      layout: null,
    })
  })

  // ── Aprovar solicitação (escopada à entidade do contexto) ───────────────────
  app.post<{ Params: { id: string }; Body: { nivelConcedido?: string; observacao?: string } }>(
    '/entidade/acessos/solicitacoes/:id/aprovar',
    async (req, reply) => {
      try {
        await solicitacoes.aprovar(
          req.params.id,
          req.user.sub,
          (req.body.nivelConcedido ?? '') as NivelAcessoEntidade,
          req.body.observacao,
          req.contexto.entidadeId,
        )
        return reply.redirect('/app/entidade/acessos')
      } catch (e) {
        return reply.redirect(msgErro(e, 'Erro ao aprovar solicitação.'))
      }
    },
  )

  // ── Rejeitar solicitação ────────────────────────────────────────────────────
  app.post<{ Params: { id: string }; Body: { observacao?: string } }>(
    '/entidade/acessos/solicitacoes/:id/rejeitar',
    async (req, reply) => {
      try {
        await solicitacoes.rejeitar(req.params.id, req.user.sub, req.body.observacao, req.contexto.entidadeId)
        return reply.redirect('/app/entidade/acessos')
      } catch (e) {
        return reply.redirect(msgErro(e, 'Erro ao rejeitar solicitação.'))
      }
    },
  )

  // ── Gerenciar acesso existente: mudar nível ou revogar ──────────────────────
  // Escopado à entidade; o admin não altera o próprio acesso (evita auto-lockout).
  app.post<{ Params: { acessoId: string }; Body: { nivel?: string; acao?: string } }>(
    '/entidade/acessos/:acessoId',
    async (req, reply) => {
      try {
        const acesso = await app.prisma.acessoEntidade.findUnique({ where: { id: req.params.acessoId } })
        if (!acesso || acesso.entidadeId !== req.contexto.entidadeId) {
          throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Acesso não encontrado nesta entidade.')
        }
        if (acesso.usuarioId === req.user.sub) {
          throw new ErroNegocio('CONFLITO', 'Você não pode alterar o seu próprio acesso aqui.')
        }
        if (req.body.acao === 'revogar') {
          await acessosSvc.atualizar(req.params.acessoId, { ativo: false })
        } else {
          await acessosSvc.atualizar(req.params.acessoId, { nivel: (req.body.nivel ?? '') as NivelAcessoEntidade })
        }
        return reply.redirect('/app/entidade/acessos')
      } catch (e) {
        return reply.redirect(msgErro(e, 'Erro ao atualizar acesso.'))
      }
    },
  )
}
