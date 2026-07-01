import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { PreviewMemoriaisService } from '../services/preview-memoriais.js'

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
}
