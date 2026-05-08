import { PrismaClient, Prisma, TipoItem, TipoFuncionalidade } from '@prisma/client'
import { ErroNegocio } from '../errors.js'

type CriarItemDados = {
  nome: string
  descricao?: string
  tipo: TipoItem
  tipoFuncionalidade?: TipoFuncionalidade
  rota?: string
  icone?: string
  ordem?: number
  parentId?: string
}

type AtualizarItemDados = {
  nome?: string
  descricao?: string
  tipoFuncionalidade?: TipoFuncionalidade
  rota?: string
  icone?: string
  ordem?: number
  ativo?: boolean
}

const incluirSubItens = {
  subItens: { orderBy: [{ ordem: 'asc' as const }, { nome: 'asc' as const }] },
}

export class ItensService {
  constructor(private prisma: PrismaClient) {}

  async listar(menuId: string) {
    const menu = await this.prisma.menu.findUnique({ where: { id: menuId } })
    if (!menu) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Menu não encontrado.')
    return this.prisma.itemFuncionalidade.findMany({
      where: { menuId, parentId: null },
      include: incluirSubItens,
      orderBy: [{ ordem: 'asc' }, { nome: 'asc' }],
    })
  }

  buscarPorId(id: string) {
    return this.prisma.itemFuncionalidade.findUnique({
      where: { id },
      include: incluirSubItens,
    })
  }

  async criar(menuId: string, dados: CriarItemDados) {
    const menu = await this.prisma.menu.findUnique({ where: { id: menuId } })
    if (!menu) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Menu não encontrado.')
    if (!menu.ativo) throw new ErroNegocio('CONFLITO', 'Não é possível adicionar itens a um menu inativo.')

    if (dados.tipo === 'FUNCIONALIDADE' && !dados.tipoFuncionalidade) {
      throw new ErroNegocio('REQUISICAO_INVALIDA', 'tipoFuncionalidade é obrigatório para itens do tipo FUNCIONALIDADE.')
    }
    if (dados.tipo === 'SUBMENU' && dados.tipoFuncionalidade) {
      throw new ErroNegocio('REQUISICAO_INVALIDA', 'tipoFuncionalidade não se aplica a itens do tipo SUBMENU.')
    }

    if (dados.parentId) {
      const parent = await this.prisma.itemFuncionalidade.findUnique({ where: { id: dados.parentId } })
      if (!parent) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Item pai não encontrado.')
      if (parent.tipo !== 'SUBMENU') throw new ErroNegocio('REQUISICAO_INVALIDA', 'O item pai deve ser do tipo SUBMENU.')
      if (parent.menuId !== menuId) throw new ErroNegocio('REQUISICAO_INVALIDA', 'O item pai deve pertencer ao mesmo menu.')
      // Max depth: menu → submenu → submenu. A submenu under another submenu can only have FUNCIONALIDADE.
      if (dados.tipo === 'SUBMENU' && parent.parentId !== null) {
        throw new ErroNegocio('REQUISICAO_INVALIDA', 'Profundidade máxima atingida. Um submenu filho de outro submenu só pode conter itens do tipo FUNCIONALIDADE.')
      }
    }

    return this.prisma.itemFuncionalidade.create({ data: { ...dados, menuId } })
  }

  async atualizar(id: string, dados: AtualizarItemDados) {
    if ('tipoFuncionalidade' in dados) {
      const atual = await this.prisma.itemFuncionalidade.findUnique({ where: { id }, select: { tipo: true } })
      if (!atual) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Item não encontrado.')
      if (atual.tipo === 'SUBMENU') {
        throw new ErroNegocio('REQUISICAO_INVALIDA', 'tipoFuncionalidade não se aplica a itens do tipo SUBMENU.')
      }
    }
    try {
      return await this.prisma.itemFuncionalidade.update({ where: { id }, data: dados, include: incluirSubItens })
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
        throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Item não encontrado.')
      }
      throw e
    }
  }

  async excluir(id: string, usuarioId?: string, lixeiraService?: import('./lixeira.js').LixeiraService) {
    const item = await this.prisma.itemFuncionalidade.findUnique({ where: { id } })
    if (!item) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Item não encontrado.')

    await this.prisma.$transaction(async (tx) => {
      if (lixeiraService && usuarioId) await lixeiraService.salvarItem(id, usuarioId, tx)
      const todos = await tx.itemFuncionalidade.findMany({
        where: { OR: [{ id }, { parentId: id }] },
        select: { id: true, parentId: true },
      })
      const subIds = todos.filter((i) => i.parentId === id).map((i) => i.id)
      const subSubIds = await tx.itemFuncionalidade
        .findMany({ where: { parentId: { in: subIds } }, select: { id: true } })
        .then((r) => r.map((i) => i.id))

      const allIds = [id, ...subIds, ...subSubIds]
      await tx.favoritoItem.deleteMany({ where: { itemId: { in: allIds } } })
      await tx.permissaoAcesso.deleteMany({ where: { itemId: { in: allIds } } })

      if (subSubIds.length) await tx.itemFuncionalidade.deleteMany({ where: { id: { in: subSubIds } } })
      if (subIds.length) await tx.itemFuncionalidade.deleteMany({ where: { id: { in: subIds } } })
      await tx.itemFuncionalidade.delete({ where: { id } })
    })
  }

  async copiar(itemId: string, novoParentId: string | null, novoMenuId: string) {
    const item = await this.prisma.itemFuncionalidade.findUnique({
      where: { id: itemId },
      include: { subItens: { include: { subItens: true } } },
    })
    if (!item) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Item não encontrado.')

    const menu = await this.prisma.menu.findUnique({ where: { id: novoMenuId } })
    if (!menu) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Menu de destino não encontrado.')

    if (novoParentId) {
      const novoParent = await this.prisma.itemFuncionalidade.findUnique({
        where: { id: novoParentId },
        include: { parent: true },
      })
      if (!novoParent) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Pai de destino não encontrado.')
      if (novoParent.tipo !== 'SUBMENU') throw new ErroNegocio('REQUISICAO_INVALIDA', 'O pai deve ser do tipo SUBMENU.')
      const profPai = novoParent.parentId ? 1 : 0
      if (item.tipo === 'SUBMENU' && profPai >= 1) {
        throw new ErroNegocio('REQUISICAO_INVALIDA', 'Copiar este submenu aqui extrapolaria o limite de 2 níveis.')
      }
    }

    return this.prisma.$transaction(async (tx) => {
      return this._copiarRecursivo(tx, item, novoParentId, novoMenuId, true)
    })
  }

  private async _copiarRecursivo(
    tx: any,
    item: any,
    novoParentId: string | null,
    novoMenuId: string,
    raiz: boolean,
  ): Promise<any> {
    const novo = await tx.itemFuncionalidade.create({
      data: {
        nome: raiz ? item.nome + ' (cópia)' : item.nome,
        descricao: item.descricao,
        tipo: item.tipo,
        tipoFuncionalidade: item.tipoFuncionalidade,
        rota: item.rota,
        icone: item.icone,
        ordem: item.ordem,
        ativo: item.ativo,
        menuId: novoMenuId,
        parentId: novoParentId,
      },
    })
    for (const sub of item.subItens ?? []) {
      await this._copiarRecursivo(tx, sub, novo.id, novoMenuId, false)
    }
    return novo
  }

  async reordenar(ids: string[]) {
    await this.prisma.$transaction(
      ids.map((id, i) => this.prisma.itemFuncionalidade.update({ where: { id }, data: { ordem: i } })),
    )
  }

  async mover(itemId: string, novoParentId: string | null, menuId?: string) {
    const item = await this.prisma.itemFuncionalidade.findUnique({
      where: { id: itemId },
      include: { subItens: { include: { subItens: true } } },
    })
    if (!item) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Item não encontrado.')

    if (novoParentId) {
      const novoParent = await this.prisma.itemFuncionalidade.findUnique({
        where: { id: novoParentId },
        include: { parent: true },
      })
      if (!novoParent) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Novo pai não encontrado.')
      if (novoParent.tipo !== 'SUBMENU') throw new ErroNegocio('REQUISICAO_INVALIDA', 'O pai deve ser do tipo SUBMENU.')

      const profundidadeNovoPai = novoParent.parentId ? 1 : 0
      const profundidadeMaxFilho = item.tipo === 'SUBMENU' && item.subItens.some((s) => s.subItens.length > 0) ? 2 : item.tipo === 'SUBMENU' ? 1 : 0

      if (profundidadeNovoPai + 1 + profundidadeMaxFilho > 2) {
        throw new ErroNegocio('REQUISICAO_INVALIDA', 'Mover este item extrapolaria o limite de 2 níveis de submenu.')
      }

      if (item.tipo === 'SUBMENU' && novoParent.parentId !== null) {
        throw new ErroNegocio('REQUISICAO_INVALIDA', 'Um submenu não pode ser filho de outro submenu que já é filho.')
      }
    }

    return this.prisma.itemFuncionalidade.update({
      where: { id: itemId },
      data: { parentId: novoParentId, ...(menuId ? { menuId } : {}) },
    })
  }
}
