import type { PrismaClient } from '@prisma/client'

/** Nome do Sistema (core) que agrupa a navegação da área do operador `/app`. */
export const SISTEMA_APP_NOME = 'Gênesis · Operador'

/** Nó da árvore de navegação do `/app`, já filtrado pela permissão do usuário. */
export type MenuAppNode = {
  id: string
  nome: string
  descricao: string | null
  rota: string | null
  icone: string | null
  tipo: 'FUNCIONALIDADE' | 'SUBMENU'
  filhos: MenuAppNode[]
}

/**
 * Leitura da navegação dinâmica do `/app` a partir do sistema de menus do core
 * (Sistema→Módulo→Menu→ItemFuncionalidade) cruzado com `PermissaoAcesso`.
 */
export class MenuAppService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Árvore de itens ATIVOS do Sistema do `/app` aos quais o usuário tem
   * `PermissaoAcesso` ativa. Um filho só aparece se o seu pai também estiver
   * visível — o pai (SUBMENU com rota) é a âncora de navegação.
   */
  async arvorePermitida(usuarioId: string): Promise<MenuAppNode[]> {
    const permissoes = await this.prisma.permissaoAcesso.findMany({
      where: { usuarioId, ativo: true },
      select: { itemId: true },
    })
    const permitidos = new Set(permissoes.map((p) => p.itemId))
    if (permitidos.size === 0) return []

    const itens = await this.prisma.itemFuncionalidade.findMany({
      where: {
        ativo: true,
        menu: { ativo: true, modulo: { ativo: true, sistema: { nome: SISTEMA_APP_NOME, ativo: true } } },
      },
      orderBy: [{ ordem: 'asc' }, { nome: 'asc' }],
      select: { id: true, nome: true, descricao: true, rota: true, icone: true, tipo: true, parentId: true },
    })
    const visiveis = itens.filter((it) => permitidos.has(it.id))

    const porId = new Map<string, MenuAppNode>()
    for (const it of visiveis) {
      porId.set(it.id, {
        id: it.id, nome: it.nome, descricao: it.descricao, rota: it.rota,
        icone: it.icone, tipo: it.tipo, filhos: [],
      })
    }

    const raizes: MenuAppNode[] = []
    for (const it of visiveis) {
      const no = porId.get(it.id)
      if (!no) continue
      if (it.parentId === null) {
        raizes.push(no)
      } else {
        // Pai não-visível ⇒ o filho some (sem âncora de navegação).
        porId.get(it.parentId)?.filhos.push(no)
      }
    }
    return raizes
  }
}
