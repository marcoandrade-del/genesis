import { PrismaClient, type GranularidadePlano } from '@prisma/client'

export type ItemComOrigem = { origem: string }

/**
 * Configuração do dashboard por entidade. Hoje controla a granularidade de exibição
 * dos planos (contas/receita/despesa) nos painéis: PADRAO colapsa os desdobramentos
 * locais na conta-modelo; DESDOBRADO mostra a árvore local completa.
 *
 * Default = DESDOBRADO (comportamento histórico) quando a entidade não tem config.
 */
export class ConfiguracaoDashboardService {
  constructor(private prisma: PrismaClient) {}

  /** Granularidade configurada da entidade (DESDOBRADO se não houver config). */
  async granularidade(entidadeId: string): Promise<GranularidadePlano> {
    const cfg = await this.prisma.configuracaoDashboard.findUnique({
      where: { entidadeId },
      select: { granularidadePlano: true },
    })
    return cfg?.granularidadePlano ?? 'DESDOBRADO'
  }

  /** Define a granularidade da entidade (upsert). */
  definir(entidadeId: string, granularidadePlano: GranularidadePlano) {
    return this.prisma.configuracaoDashboard.upsert({
      where: { entidadeId },
      create: { entidadeId, granularidadePlano },
      update: { granularidadePlano },
    })
  }

  /**
   * Granularidade efetiva de UM relatório: override esparso do relatório (se houver)
   * → senão o default da entidade. A maioria dos relatórios não tem override e segue
   * o default.
   */
  async granularidadeRelatorio(entidadeId: string, relatorio: string): Promise<GranularidadePlano> {
    const pref = await this.prisma.preferenciaRelatorioPlano.findUnique({
      where: { entidadeId_relatorio: { entidadeId, relatorio } },
      select: { granularidadePlano: true },
    })
    return pref?.granularidadePlano ?? this.granularidade(entidadeId)
  }

  /**
   * Memoriza a escolha de um relatório SÓ se ela diferir do default da entidade
   * (mantém a tabela esparsa). Se a escolha volta a ser o default, remove o override.
   */
  async definirRelatorio(entidadeId: string, relatorio: string, granularidadePlano: GranularidadePlano) {
    const base = await this.granularidade(entidadeId)
    if (granularidadePlano === base) {
      await this.prisma.preferenciaRelatorioPlano.deleteMany({ where: { entidadeId, relatorio } })
      return
    }
    await this.prisma.preferenciaRelatorioPlano.upsert({
      where: { entidadeId_relatorio: { entidadeId, relatorio } },
      create: { entidadeId, relatorio, granularidadePlano },
      update: { granularidadePlano },
    })
  }
}

/**
 * Aplica a granularidade a uma lista de contas/linhas com `origem`: em PADRAO,
 * remove as linhas de DESDOBRAMENTO (os valores já sobem por roll-up para a
 * conta-modelo); em DESDOBRADO, devolve tudo.
 */
export function aplicarGranularidade<T extends ItemComOrigem>(itens: T[], granularidade: GranularidadePlano): T[] {
  if (granularidade === 'PADRAO') return itens.filter((i) => i.origem !== 'DESDOBRAMENTO')
  return itens
}
