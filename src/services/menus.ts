import { PrismaClient, Prisma } from '@prisma/client'
import { ErroNegocio } from '../errors.js'

export class MenusService {
  constructor(private prisma: PrismaClient) {}

  async listar(moduloId: string) {
    const modulo = await this.prisma.modulo.findUnique({ where: { id: moduloId } })
    if (!modulo) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Módulo não encontrado.')
    return this.prisma.menu.findMany({
      where: { moduloId },
      orderBy: [{ ordem: 'asc' }, { nome: 'asc' }],
    })
  }

  buscarPorId(id: string) {
    return this.prisma.menu.findUnique({ where: { id } })
  }

  async criar(moduloId: string, dados: { nome: string; icone?: string; ordem?: number }) {
    const modulo = await this.prisma.modulo.findUnique({ where: { id: moduloId } })
    if (!modulo) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Módulo não encontrado.')
    if (!modulo.ativo) throw new ErroNegocio('CONFLITO', 'Não é possível adicionar menus a um módulo inativo.')

    try {
      return await this.prisma.menu.create({ data: { ...dados, moduloId } })
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ErroNegocio('CONFLITO', `Já existe um menu com o nome "${dados.nome}" neste módulo.`)
      }
      throw e
    }
  }

  async atualizar(id: string, dados: { nome?: string; icone?: string; ordem?: number; ativo?: boolean }) {
    try {
      return await this.prisma.menu.update({ where: { id }, data: dados })
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError) {
        if (e.code === 'P2002') throw new ErroNegocio('CONFLITO', 'Já existe um menu com esse nome neste módulo.')
        if (e.code === 'P2025') throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Menu não encontrado.')
      }
      throw e
    }
  }

  async excluir(id: string, usuarioId?: string, lixeiraService?: import('./lixeira.js').LixeiraService) {
    const menu = await this.prisma.menu.findUnique({ where: { id } })
    if (!menu) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Menu não encontrado.')

    await this.prisma.$transaction(async (tx) => {
      if (lixeiraService && usuarioId) await lixeiraService.salvarMenu(id, usuarioId, tx)
      const itens = await tx.itemFuncionalidade.findMany({ where: { menuId: id }, select: { id: true, parentId: true } })
      const itemIds = itens.map((i) => i.id)

      await tx.favoritoItem.deleteMany({ where: { itemId: { in: itemIds } } })
      await tx.permissaoAcesso.deleteMany({ where: { itemId: { in: itemIds } } })

      const depth2Ids = itens.filter((i) => i.parentId && itens.some((p) => p.id === i.parentId && p.parentId)).map((i) => i.id)
      if (depth2Ids.length) await tx.itemFuncionalidade.deleteMany({ where: { id: { in: depth2Ids } } })

      const depth1Ids = itens.filter((i) => i.parentId && !depth2Ids.includes(i.id)).map((i) => i.id)
      if (depth1Ids.length) await tx.itemFuncionalidade.deleteMany({ where: { id: { in: depth1Ids } } })

      const depth0Ids = itens.filter((i) => !i.parentId).map((i) => i.id)
      if (depth0Ids.length) await tx.itemFuncionalidade.deleteMany({ where: { id: { in: depth0Ids } } })

      await tx.menu.delete({ where: { id } })
    })
  }

  async reordenar(ids: string[]) {
    await this.prisma.$transaction(
      ids.map((id, i) => this.prisma.menu.update({ where: { id }, data: { ordem: i } })),
    )
  }
}
