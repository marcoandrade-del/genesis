import type { PrismaClient } from '@prisma/client'

/**
 * Ordem personalizada das áreas do painel `/app` por usuário. Esparso: só há
 * linhas para quem arrastou os cards; sem linhas, a navegação segue a ordem
 * global (`ItemFuncionalidade.ordem`). Reordena apenas as áreas de topo (raízes).
 */
export class OrdemDashboardService {
  constructor(private prisma: PrismaClient) {}

  /** Mapa itemId→ordem com a preferência do usuário (vazio se ele nunca arrastou). */
  async ordemDe(usuarioId: string): Promise<Map<string, number>> {
    const linhas = await this.prisma.ordemItemUsuario.findMany({
      where: { usuarioId },
      select: { itemId: true, ordem: true },
    })
    return new Map(linhas.map((l) => [l.itemId, l.ordem]))
  }

  /**
   * Grava a ordem escolhida (substitui a anterior do usuário). A posição de cada
   * item é o seu índice na lista. Operação atômica: limpa e regrava.
   */
  async definir(usuarioId: string, itemIds: string[]): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.ordemItemUsuario.deleteMany({ where: { usuarioId } })
      if (itemIds.length > 0) {
        await tx.ordemItemUsuario.createMany({
          data: itemIds.map((itemId, ordem) => ({ usuarioId, itemId, ordem })),
        })
      }
    })
  }

  /** Volta à ordem global (apaga a preferência do usuário). */
  async restaurar(usuarioId: string): Promise<void> {
    await this.prisma.ordemItemUsuario.deleteMany({ where: { usuarioId } })
  }
}

/**
 * Ordena as raízes pela preferência do usuário. Itens sem preferência vão para o
 * fim, preservando a ordem de entrada (já vinda ordenada por `ordem,nome`). Itens
 * preferidos primeiro, na ordem escolhida. Função pura — fácil de testar.
 */
export function aplicarOrdemRaizes<T extends { id: string }>(
  raizes: T[],
  ordem: Map<string, number>,
): T[] {
  if (ordem.size === 0) return raizes
  return raizes
    .map((no, idx) => ({ no, idx }))
    .sort((a, b) => {
      const oa = ordem.get(a.no.id)
      const ob = ordem.get(b.no.id)
      if (oa === undefined && ob === undefined) return a.idx - b.idx // ambos sem pref: ordem original
      if (oa === undefined) return 1 // sem pref vai depois
      if (ob === undefined) return -1
      return oa - ob
    })
    .map((x) => x.no)
}
