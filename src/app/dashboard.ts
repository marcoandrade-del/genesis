import type { FastifyInstance } from 'fastify'
import { MenuAppService } from '../services/menu-app.js'
import { OrdemDashboardService } from '../services/ordem-dashboard.js'

/**
 * Dashboard inicial do /app — assume que `req.contexto` já foi injetado pelo
 * middleware (entidade + ano escolhidos). Mostra o contexto ativo e atalhos
 * para as áreas de trabalho, que o usuário pode reordenar arrastando.
 */
export async function appDashboardRoutes(app: FastifyInstance) {
  app.get('/', async (req, reply) => {
    const { entidadeId, ano, nivel } = req.contexto
    const entidade = await app.prisma.entidade.findUnique({
      where: { id: entidadeId },
      include: { municipio: { include: { estado: { select: { sigla: true, nome: true } } } } },
    })
    if (!entidade) {
      // Cookie obsoleto (entidade removida): força nova escolha.
      return reply.clearCookie('genesis_exercicio', { path: '/' }).redirect('/app/contexto')
    }
    const temOrdemCustom = (await new OrdemDashboardService(app.prisma).ordemDe(req.user.sub)).size > 0
    return reply.view('app/dashboard', { entidade, ano, nivel, temOrdemCustom, layout: null })
  })

  // Salva a ordem das áreas do painel (drag-drop). Recebe a lista ordenada de
  // ids de área; só persiste os que o usuário realmente enxerga (raízes do menu).
  app.post<{ Body: { itens?: string[]; reset?: boolean } }>('/dashboard/ordem', async (req, reply) => {
    const ordemSvc = new OrdemDashboardService(app.prisma)

    if (req.body?.reset) {
      await ordemSvc.restaurar(req.user.sub)
      return reply.send({ ok: true, restaurado: true })
    }

    const enviados = Array.isArray(req.body?.itens) ? req.body.itens : []
    const arvore = await new MenuAppService(app.prisma).arvorePermitida(req.user.sub)
    const raizesPermitidas = new Set(arvore.map((r) => r.id))
    const itens = enviados.filter((id) => raizesPermitidas.has(id))

    await ordemSvc.definir(req.user.sub, itens)
    return reply.send({ ok: true, itens })
  })
}
