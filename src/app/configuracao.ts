import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { GranularidadePlano } from '@prisma/client'
import { ConfiguracaoDashboardService } from '../services/configuracao-dashboard.js'

const podeEscrever = (nivel: string) => nivel === 'ESCRITA' || nivel === 'ADMIN'
const ERRO_LEITURA = 'Seu nível de acesso nesta entidade é apenas leitura — você não pode alterar a configuração.'

/**
 * Configuração do dashboard da entidade. Hoje: a granularidade de exibição dos
 * planos nos painéis (PADRAO = só o plano padrão/modelo, colapsando os
 * desdobramentos locais; DESDOBRADO = árvore local completa). Vale por entidade.
 */
export async function appConfiguracaoRoutes(app: FastifyInstance) {
  const svc = new ConfiguracaoDashboardService(app.prisma)

  async function carregarEntidade(req: FastifyRequest, reply: FastifyReply) {
    const entidade = await app.prisma.entidade.findUnique({
      where: { id: req.contexto.entidadeId },
      include: { municipio: { include: { estado: { select: { sigla: true, nome: true } } } } },
    })
    if (!entidade) {
      reply.clearCookie('genesis_exercicio', { path: '/' }).redirect('/app/contexto')
      return null
    }
    return entidade
  }

  async function render(req: FastifyRequest, reply: FastifyReply, entidade: unknown, opts: { erro?: string; aviso?: string; status?: number } = {}) {
    const { entidadeId, nivel } = req.contexto
    const granularidade = await svc.granularidade(entidadeId)
    if (opts.status) reply.code(opts.status)
    return reply.view('app/configuracao', {
      entidade,
      ano: req.contexto.ano,
      nivel,
      granularidade,
      podeEscrever: podeEscrever(nivel),
      erro: opts.erro ?? null,
      aviso: opts.aviso ?? null,
      layout: null,
    })
  }

  app.get('/configuracao', async (req, reply) => {
    const entidade = await carregarEntidade(req, reply)
    if (!entidade) return
    return render(req, reply, entidade)
  })

  app.post('/configuracao', async (req, reply) => {
    const { entidadeId, nivel } = req.contexto
    const entidade = await carregarEntidade(req, reply)
    if (!entidade) return
    if (!podeEscrever(nivel)) return render(req, reply, entidade, { erro: ERRO_LEITURA, status: 403 })
    const valor = String((req.body as Record<string, unknown> | undefined)?.['granularidadePlano'] ?? '')
    const granularidade: GranularidadePlano = valor === 'PADRAO' ? 'PADRAO' : 'DESDOBRADO'
    await svc.definir(entidadeId, granularidade)
    return render(req, reply, entidade, { aviso: 'Configuração salva.' })
  })
}
