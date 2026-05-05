import { PrismaClient, Prisma } from '@prisma/client'
import { ErroNegocio } from '../errors.js'

export class SistemasService {
  constructor(private prisma: PrismaClient) {}

  listar() {
    return this.prisma.sistema.findMany({ orderBy: { nome: 'asc' } })
  }

  buscarPorId(id: string) {
    return this.prisma.sistema.findUnique({ where: { id } })
  }

  async criar(dados: { nome: string; descricao?: string; adminUsuarioId: string }) {
    const { adminUsuarioId, ...dadosSistema } = dados

    const admin = await this.prisma.usuario.findUnique({ where: { id: adminUsuarioId } })
    if (!admin) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Usuário administrador não encontrado.')
    if (!admin.ativo) throw new ErroNegocio('CONFLITO', 'O usuário informado está inativo.')

    try {
      return await this.prisma.$transaction(async (tx) => {
        const sistema = await tx.sistema.create({ data: dadosSistema })
        await tx.adminSistema.create({ data: { sistemaId: sistema.id, usuarioId: adminUsuarioId } })
        return sistema
      })
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ErroNegocio('CONFLITO', `Já existe um sistema com o nome "${dados.nome}".`)
      }
      throw e
    }
  }

  buscarComAdmins(id: string) {
    return this.prisma.sistema.findUnique({
      where: { id },
      include: {
        admins: {
          include: { usuario: { select: { id: true, nomeCompleto: true } } },
        },
      },
    })
  }

  async trocarAdmin(sistemaId: string, novoAdminId: string) {
    const admin = await this.prisma.usuario.findUnique({ where: { id: novoAdminId } })
    if (!admin) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Usuário não encontrado.')
    if (!admin.ativo) throw new ErroNegocio('CONFLITO', 'O usuário informado está inativo.')

    return this.prisma.$transaction(async (tx) => {
      await tx.adminSistema.upsert({
        where: { usuarioId_sistemaId: { usuarioId: novoAdminId, sistemaId } },
        create: { usuarioId: novoAdminId, sistemaId },
        update: {},
      })
      await tx.adminSistema.deleteMany({
        where: { sistemaId, usuarioId: { not: novoAdminId } },
      })
    })
  }

  async atualizar(id: string, dados: { nome?: string; descricao?: string; ativo?: boolean }) {
    try {
      return await this.prisma.sistema.update({ where: { id }, data: dados })
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError) {
        if (e.code === 'P2002') throw new ErroNegocio('CONFLITO', 'Já existe um sistema com esse nome.')
        if (e.code === 'P2025') throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Sistema não encontrado.')
      }
      throw e
    }
  }

  async excluir(id: string, usuarioId?: string, lixeiraService?: import('./lixeira.js').LixeiraService) {
    const sistema = await this.prisma.sistema.findUnique({ where: { id } })
    if (!sistema) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Sistema não encontrado.')

    const relatorios = await this.prisma.relatorioFixo.count({ where: { sistemaId: id } })
    if (relatorios > 0) throw new ErroNegocio('CONFLITO', 'Não é possível excluir um sistema com relatórios vinculados.')

    await this.prisma.$transaction(async (tx) => {
      if (lixeiraService && usuarioId) await lixeiraService.salvarSistema(id, usuarioId, tx)
      const modulos = await tx.modulo.findMany({ where: { sistemaId: id }, select: { id: true } })
      const moduloIds = modulos.map((m) => m.id)

      const menus = await tx.menu.findMany({ where: { moduloId: { in: moduloIds } }, select: { id: true } })
      const menuIds = menus.map((m) => m.id)

      const itens = await tx.itemFuncionalidade.findMany({ where: { menuId: { in: menuIds } }, select: { id: true } })
      const itemIds = itens.map((i) => i.id)

      await tx.permissaoAcesso.deleteMany({ where: { itemId: { in: itemIds } } })

      const depth2 = await tx.itemFuncionalidade.findMany({
        where: { menuId: { in: menuIds }, parentId: { not: null } },
        select: { id: true, parentId: true },
      })
      const depth2Ids = depth2.filter((i) => depth2.some((p) => p.id === i.parentId)).map((i) => i.id)
      if (depth2Ids.length) await tx.itemFuncionalidade.deleteMany({ where: { id: { in: depth2Ids } } })

      const depth1Ids = depth2.filter((i) => !depth2Ids.includes(i.id)).map((i) => i.id)
      if (depth1Ids.length) await tx.itemFuncionalidade.deleteMany({ where: { id: { in: depth1Ids } } })

      const depth0Ids = itemIds.filter((id) => !depth2.some((d) => d.id === id))
      if (depth0Ids.length) await tx.itemFuncionalidade.deleteMany({ where: { id: { in: depth0Ids } } })

      if (menuIds.length) await tx.menu.deleteMany({ where: { id: { in: menuIds } } })
      if (moduloIds.length) {
        await tx.adminModulo.deleteMany({ where: { moduloId: { in: moduloIds } } })
        await tx.modulo.deleteMany({ where: { id: { in: moduloIds } } })
      }
      await tx.adminSistema.deleteMany({ where: { sistemaId: id } })
      await tx.sistema.delete({ where: { id } })
    })
  }
}
