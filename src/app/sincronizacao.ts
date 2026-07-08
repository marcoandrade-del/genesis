import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { SincronizacaoPortalService } from '../services/sincronizacao-portal.js'
import { SincronizacaoDecretosService } from '../services/sincronizacao-decretos.js'

const podeEscrever = (nivel: string) => nivel === 'ESCRITA' || nivel === 'ADMIN'
const ERRO_LEITURA = 'Seu nível de acesso nesta entidade é apenas leitura — você não pode disparar sincronizações.'

// Uma sincronização por vez, por entidade (a varredura do portal leva minutos).
const emExecucao = new Set<string>()

/**
 * Sincronização com o Portal da Transparência — a semente da tela "Conectores":
 * botão "Sincronizar agora" (receita → despesa do mês corrente, na ordem) +
 * log das execuções (SincronizacaoPortal) + estado do agendamento diário.
 * A execução é assíncrona: o POST dispara e volta; o resultado aparece no log.
 */
export async function appSincronizacaoRoutes(app: FastifyInstance) {
  const svc = new SincronizacaoPortalService(app.prisma)
  const svcDecretos = new SincronizacaoDecretosService(app.prisma)

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

  async function render(req: FastifyRequest, reply: FastifyReply, entidade: unknown, opts: { aviso?: string; erro?: string; status?: number } = {}) {
    const { entidadeId, ano, nivel } = req.contexto
    const [execucoes, ultimaDecretos, orcamento] = await Promise.all([
      app.prisma.sincronizacaoPortal.findMany({ where: { entidadeId }, orderBy: { criadoEm: 'desc' }, take: 20 }),
      app.prisma.sincronizacaoPortal.findMany({ where: { entidadeId, tipo: 'DECRETOS' }, orderBy: { criadoEm: 'desc' }, take: 1 }),
      app.prisma.orcamento.findUnique({ where: { entidadeId_ano: { entidadeId, ano } }, select: { id: true } }),
    ])
    // histórico dos decretos BAIXADOS do portal (sync automático ou script) —
    // conferência do usuário: quais entraram e quando (data/hora do download)
    const decretosBaixados = orcamento
      ? await app.prisma.creditoAdicional.findMany({
          where: { orcamentoId: orcamento.id, justificativa: { contains: 'API do Portal da Transparência' } },
          orderBy: { criadoEm: 'desc' },
          select: { numero: true, atoLegal: true, valorTotal: true, criadoEm: true, justificativa: true },
        })
      : []
    if (opts.status) reply.code(opts.status)
    return reply.view('app/sincronizacao', {
      entidade,
      ano: req.contexto.ano,
      nivel,
      podeEscrever: podeEscrever(nivel),
      execucoes,
      ultimaDecretos: ultimaDecretos[0] ?? null,
      decretosBaixados,
      rodando: emExecucao.has(entidadeId),
      agendado: process.env['SINCRONIZAR_PORTAL_MARINGA'] === '1',
      aviso: opts.aviso ?? null,
      erro: opts.erro ?? null,
      layout: null,
    })
  }

  app.get('/sincronizacao', async (req, reply) => {
    const entidade = await carregarEntidade(req, reply)
    if (!entidade) return
    return render(req, reply, entidade)
  })

  app.post('/sincronizacao/rodar', async (req, reply) => {
    const entidade = await carregarEntidade(req, reply)
    if (!entidade) return
    const { entidadeId, nivel } = req.contexto
    if (!podeEscrever(nivel)) return render(req, reply, entidade, { erro: ERRO_LEITURA, status: 403 })
    if (emExecucao.has(entidadeId)) {
      return render(req, reply, entidade, { aviso: 'Já há uma sincronização em andamento — acompanhe pelo log.', status: 409 })
    }

    emExecucao.add(entidadeId)
    const agora = new Date()
    const ano = agora.getFullYear()
    const mes = agora.getMonth() + 1
    // dispara e responde: o resultado aparece no log quando terminar
    void (async () => {
      try {
        // DECRETOS primeiro (autorizado fresco); depois RECEITA antes da DESPESA
        await svcDecretos.sincronizar(entidadeId, ano)
        await svc.arrecadacaoMes(entidadeId, ano, mes)
        await svc.despesaMes(entidadeId, ano, mes)
      } catch (e) {
        req.log.error(e, '[sincronizacao] falha na execução manual')
      } finally {
        emExecucao.delete(entidadeId)
      }
    })()
    return render(req, reply, entidade, {
      aviso: `Sincronização de ${String(mes).padStart(2, '0')}/${ano} iniciada (decretos → receita → despesa). A varredura do portal leva alguns minutos — atualize a página para ver o resultado no log.`,
    })
  })
}
