import type { FastifyInstance } from 'fastify'
import { SolicitacoesMemorialService } from '../services/solicitacoes-memorial.js'
import { PreviewMemoriaisService } from '../services/preview-memoriais.js'

/**
 * Admin dos Memoriais de cálculo: fila de propostas (SolicitacaoMemorial) que os
 * usuários da bancada enviaram. O admin vê o IMPACTO NUMÉRICO de cada proposta
 * (efetivo→proposto de RCL/DTP/DTP-RCL%, recalculado contra o município testado)
 * e aprova → grava o override nos campos JSON do Estado, na mesma transação.
 * Espelha `adminAcessosEntidadeRoutes`.
 */
export async function adminMemoriaisRoutes(app: FastifyInstance) {
  const solicitacoesSvc = new SolicitacoesMemorialService(app.prisma)
  const previewSvc = new PreviewMemoriaisService(app.prisma)

  // ── Fila de propostas pendentes + impacto numérico de cada uma ───────────────
  app.get('/solicitacoes', async (req, reply) => {
    const pendentes = await solicitacoesSvc.listarPendentes()
    const previews = await Promise.all(
      pendentes.map(async (s) => {
        if (!s.entidadePreviewId || !s.ano) return null
        const d = await previewSvc.calcular({
          entidadeId: s.entidadePreviewId,
          ano: s.ano,
          rcl: s.rclComposicao,
          fonte: s.fonteClassificacao,
          pessoal: s.pessoalComposicao,
        })
        if (!d) return null
        return {
          rclEf: Number(d.rcl.efetivo.rcl),
          rclPr: Number(d.rcl.proposto.rcl),
          dtpEf: Number(d.pessoal.efetivo.despesaLiquida),
          dtpPr: Number(d.pessoal.proposto.despesaLiquida),
          pctEf: d.pessoal.efetivo.percentualRcl,
          pctPr: d.pessoal.proposto.percentualRcl,
        }
      }),
    )
    return reply.view(
      'memoriais/solicitacoes',
      {
        title: 'Propostas de memoriais — Gênesis Admin',
        active: 'solicitacoes-memorial',
        userEmail: req.user.email,
        pendentes: pendentes.map((s, i) => ({ ...s, preview: previews[i] })),
      },
      { layout: 'layouts/main' },
    )
  })

  // ── APROVAR (POST) — grava override no Estado ou no Modelo, conforme `modo` ───
  app.post<{ Params: { id: string }; Body: { modo?: string; observacao?: string } }>(
    '/solicitacoes/:id/aprovar',
    async (req, reply) => {
      try {
        const modo = req.body.modo === 'ALTERAR_MODELO' ? 'ALTERAR_MODELO' : 'ESPECIFICO_ESTADO'
        await solicitacoesSvc.aprovar(req.params.id, req.user.sub, { modo, observacao: req.body.observacao })
        return reply.header('HX-Redirect', '/admin/memoriais/solicitacoes').status(204).send()
      } catch (e: unknown) {
        return reply.status(400).send(e instanceof Error ? e.message : 'Erro ao aprovar proposta.')
      }
    },
  )

  // ── REJEITAR (POST) ──────────────────────────────────────────────────────────
  app.post<{ Params: { id: string }; Body: { observacao?: string } }>(
    '/solicitacoes/:id/rejeitar',
    async (req, reply) => {
      try {
        await solicitacoesSvc.rejeitar(req.params.id, req.user.sub, req.body.observacao)
        return reply.header('HX-Redirect', '/admin/memoriais/solicitacoes').status(204).send()
      } catch (e: unknown) {
        return reply.status(400).send(e instanceof Error ? e.message : 'Erro ao rejeitar proposta.')
      }
    },
  )
}
