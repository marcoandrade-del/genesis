import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { PreviewMemoriaisService } from '../services/preview-memoriais.js'
import { SolicitacoesMemorialService } from '../services/solicitacoes-memorial.js'

const ROTA = '/app/memoriais/bancada'

/**
 * Bancada de memoriais de cálculo — poder ESPECÍFICO (item restrito): adaptar a
 * metodologia do TCE (RCL, fonte, pessoal) com cálculo AO VIVO contra um município
 * real. READ-ONLY: o preview nunca grava (a proposta/aprovação é o próximo passo).
 */
export async function appMemoriaisBancadaRoutes(app: FastifyInstance) {
  // Gate: só quem tem PermissaoAcesso ativa na bancada (o admin concede o poder).
  async function temPoder(usuarioId: string): Promise<boolean> {
    const perm = await app.prisma.permissaoAcesso.findFirst({
      where: { usuarioId, ativo: true, item: { rota: ROTA } },
      select: { id: true },
    })
    return !!perm
  }

  app.get('/memoriais/bancada', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!(await temPoder(req.user.sub))) return reply.code(403).send('Sem permissão para a bancada de memoriais.')
    const entidades = await app.prisma.entidade.findMany({
      where: { ativo: true },
      select: { id: true, nome: true, municipio: { select: { nome: true, estado: { select: { sigla: true } } } } },
      orderBy: [{ nome: 'asc' }],
    })
    const anoAtual = new Date().getFullYear()
    return reply.view(
      'app/memoriais-bancada',
      {
        entidades: entidades
          .map((e) => ({ id: e.id, rotulo: `${e.municipio.estado.sigla} · ${e.municipio.nome} — ${e.nome}` }))
          .sort((a, b) => a.rotulo.localeCompare(b.rotulo, 'pt-BR')),
        anos: [anoAtual + 1, anoAtual, anoAtual - 1, anoAtual - 2],
        layout: null,
      },
    )
  })

  app.post<{ Body: { entidadeId?: string; ano?: string | number; rcl?: unknown; fonte?: unknown; pessoal?: unknown } }>(
    '/memoriais/bancada/preview',
    async (req, reply) => {
      if (!(await temPoder(req.user.sub))) return reply.code(403).send({ erro: 'Sem permissão.' })
      const entidadeId = req.body.entidadeId
      const ano = parseInt(String(req.body.ano ?? ''), 10)
      if (!entidadeId || !Number.isFinite(ano)) return reply.code(400).send({ erro: 'entidadeId e ano são obrigatórios.' })
      const r = await new PreviewMemoriaisService(app.prisma).calcular({
        entidadeId,
        ano,
        rcl: req.body.rcl,
        fonte: req.body.fonte,
        pessoal: req.body.pessoal,
      })
      if (!r) return reply.code(404).send({ erro: 'Entidade não encontrada.' })
      return reply.send(r)
    },
  )

  // Naturezas (com impacto no município) para o PICKER dos editores: receita p/ RCL/fonte, despesa p/ pessoal.
  app.get<{ Querystring: { entidadeId?: string; ano?: string; tipo?: string } }>(
    '/memoriais/bancada/naturezas',
    async (req, reply) => {
      if (!(await temPoder(req.user.sub))) return reply.code(403).send({ erro: 'Sem permissão.' })
      const entidadeId = req.query.entidadeId
      const ano = parseInt(String(req.query.ano ?? ''), 10)
      const tipo = req.query.tipo
      if (!entidadeId || !Number.isFinite(ano) || (tipo !== 'receita' && tipo !== 'despesa'))
        return reply.code(400).send({ erro: 'entidadeId, ano e tipo (receita|despesa) são obrigatórios.' })
      const mapa = new Map<string, { codigo: string; descricao: string; valor: number }>()
      if (tipo === 'receita') {
        const ps = await app.prisma.previsaoReceita.findMany({
          where: { orcamento: { entidadeId, ano } },
          select: { valorArrecadado: true, valorPrevisto: true, contaReceita: { select: { codigo: true, descricao: true } } },
        })
        for (const p of ps) {
          const k = p.contaReceita.codigo
          const e = mapa.get(k) ?? { codigo: k, descricao: p.contaReceita.descricao, valor: 0 }
          e.valor += Number(p.valorArrecadado) || Number(p.valorPrevisto)
          mapa.set(k, e)
        }
      } else {
        const ds = await app.prisma.dotacaoDespesa.findMany({
          where: { orcamento: { entidadeId, ano } },
          select: { valorAutorizado: true, contaDespesa: { select: { codigo: true, descricao: true } } },
        })
        for (const d of ds) {
          const k = d.contaDespesa.codigo
          const e = mapa.get(k) ?? { codigo: k, descricao: d.contaDespesa.descricao, valor: 0 }
          e.valor += Number(d.valorAutorizado)
          mapa.set(k, e)
        }
      }
      const naturezas = [...mapa.values()].sort((a, b) => a.codigo.localeCompare(b.codigo, 'pt-BR', { numeric: true }))
      return reply.send({ naturezas })
    },
  )

  // CONFIRMAR: o proponente envia a metodologia para aprovação. O Estado-alvo é
  // derivado do município testado (entidade→município→estado). Nada grava no
  // Estado aqui — só cria a SolicitacaoMemorial PENDENTE (o admin aprova).
  app.post<{
    Body: { entidadePreviewId?: string; ano?: string | number; rcl?: unknown; fonte?: unknown; pessoal?: unknown; justificativa?: string }
  }>('/memoriais/bancada/confirmar', async (req, reply) => {
    if (!(await temPoder(req.user.sub))) return reply.code(403).send({ erro: 'Sem permissão.' })
    const entidadePreviewId = req.body.entidadePreviewId
    if (!entidadePreviewId) return reply.code(400).send({ erro: 'entidadePreviewId é obrigatório.' })
    const ent = await app.prisma.entidade.findUnique({
      where: { id: entidadePreviewId },
      select: { municipio: { select: { estadoId: true } } },
    })
    if (!ent) return reply.code(404).send({ erro: 'Entidade não encontrada.' })
    const ano = parseInt(String(req.body.ano ?? ''), 10)
    try {
      const sol = await new SolicitacoesMemorialService(app.prisma).criar({
        usuarioId: req.user.sub,
        estadoId: ent.municipio.estadoId,
        entidadePreviewId,
        ano: Number.isFinite(ano) ? ano : null,
        rcl: req.body.rcl,
        fonte: req.body.fonte,
        pessoal: req.body.pessoal,
        justificativa: req.body.justificativa,
      })
      return reply.send({ ok: true, id: sol.id })
    } catch (e: unknown) {
      return reply.code(400).send({ erro: e instanceof Error ? e.message : 'Erro ao enviar a proposta.' })
    }
  })

  // Minhas propostas (status pendente/aprovada/rejeitada) — fecha o loop p/ o proponente.
  app.get('/memoriais/minhas-solicitacoes', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!(await temPoder(req.user.sub))) return reply.code(403).send('Sem permissão para a bancada de memoriais.')
    const solicitacoes = await new SolicitacoesMemorialService(app.prisma).listarMinhas(req.user.sub)
    return reply.view('app/minhas-solicitacoes-memorial', { solicitacoes, layout: null })
  })

  app.post<{ Params: { id: string } }>('/memoriais/minhas-solicitacoes/:id/cancelar', async (req, reply) => {
    if (!(await temPoder(req.user.sub))) return reply.code(403).send('Sem permissão.')
    try {
      await new SolicitacoesMemorialService(app.prisma).cancelar(req.params.id, req.user.sub)
    } catch {
      /* idempotente: já decidida/cancelada → só volta à lista */
    }
    return reply.redirect('/app/memoriais/minhas-solicitacoes')
  })
}
