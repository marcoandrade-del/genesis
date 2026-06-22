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
