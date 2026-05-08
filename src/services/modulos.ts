import { PrismaClient, Prisma } from '@prisma/client'
import { ErroNegocio } from '../errors.js'

export class ModulosService {
  constructor(private prisma: PrismaClient) {}

  async listar(sistemaId: string) {
    const sistema = await this.prisma.sistema.findUnique({ where: { id: sistemaId } })
    if (!sistema) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Sistema não encontrado.')
    return this.prisma.modulo.findMany({
      where: { sistemaId },
      orderBy: { nome: 'asc' },
    })
  }

  buscarPorId(id: string) {
    return this.prisma.modulo.findUnique({ where: { id } })
  }

  async criar(sistemaId: string, dados: { nome: string; descricao?: string; adminUsuarioId: string }) {
    const { adminUsuarioId, ...dadosModulo } = dados

    const sistema = await this.prisma.sistema.findUnique({ where: { id: sistemaId } })
    if (!sistema) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Sistema não encontrado.')
    if (!sistema.ativo) throw new ErroNegocio('CONFLITO', 'Não é possível adicionar módulos a um sistema inativo.')

    const admin = await this.prisma.usuario.findUnique({ where: { id: adminUsuarioId } })
    if (!admin) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Usuário administrador não encontrado.')
    if (!admin.ativo) throw new ErroNegocio('CONFLITO', 'O usuário informado está inativo.')

    try {
      return await this.prisma.$transaction(async (tx) => {
        const modulo = await tx.modulo.create({ data: { ...dadosModulo, sistemaId } })
        await tx.adminModulo.create({ data: { moduloId: modulo.id, usuarioId: adminUsuarioId } })
        return modulo
      })
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ErroNegocio('CONFLITO', `Já existe um módulo com o nome "${dados.nome}" neste sistema.`)
      }
      throw e
    }
  }

  async atualizar(id: string, dados: { nome?: string; descricao?: string; ativo?: boolean }) {
    try {
      return await this.prisma.modulo.update({ where: { id }, data: dados })
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError) {
        if (e.code === 'P2002') throw new ErroNegocio('CONFLITO', 'Já existe um módulo com esse nome neste sistema.')
        if (e.code === 'P2025') throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Módulo não encontrado.')
      }
      throw e
    }
  }

  async excluir(id: string, usuarioId?: string, lixeiraService?: import('./lixeira.js').LixeiraService) {
    const modulo = await this.prisma.modulo.findUnique({ where: { id } })
    if (!modulo) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Módulo não encontrado.')

    await this.prisma.$transaction(async (tx) => {
      if (lixeiraService && usuarioId) await lixeiraService.salvarModulo(id, usuarioId, tx)
      const menus = await tx.menu.findMany({ where: { moduloId: id }, select: { id: true } })
      const menuIds = menus.map((m) => m.id)

      const itens = await tx.itemFuncionalidade.findMany({ where: { menuId: { in: menuIds } }, select: { id: true, parentId: true } })
      const itemIds = itens.map((i) => i.id)

      await tx.favoritoItem.deleteMany({ where: { itemId: { in: itemIds } } })
      await tx.permissaoAcesso.deleteMany({ where: { itemId: { in: itemIds } } })

      const depth2Ids = itens.filter((i) => i.parentId && itens.some((p) => p.id === i.parentId && p.parentId)).map((i) => i.id)
      if (depth2Ids.length) await tx.itemFuncionalidade.deleteMany({ where: { id: { in: depth2Ids } } })

      const depth1Ids = itens.filter((i) => i.parentId && !depth2Ids.includes(i.id)).map((i) => i.id)
      if (depth1Ids.length) await tx.itemFuncionalidade.deleteMany({ where: { id: { in: depth1Ids } } })

      const depth0Ids = itens.filter((i) => !i.parentId).map((i) => i.id)
      if (depth0Ids.length) await tx.itemFuncionalidade.deleteMany({ where: { id: { in: depth0Ids } } })

      if (menuIds.length) await tx.menu.deleteMany({ where: { id: { in: menuIds } } })
      await tx.adminModulo.deleteMany({ where: { moduloId: id } })
      await tx.modulo.delete({ where: { id } })
    })
  }
}
