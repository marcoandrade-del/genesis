import { PrismaClient } from '@prisma/client'
import { ErroNegocio } from '../errors.js'

type AdminSnapshot = {
  usuarioId: string
  ativo: boolean
}

type ItemSnapshot = {
  id: string
  nome: string
  descricao?: string | null
  tipo: string
  tipoFuncionalidade?: string | null
  rota?: string | null
  icone?: string | null
  ordem: number
  ativo: boolean
  menuId: string
  parentId?: string | null
  subItens?: ItemSnapshot[]
}

type MenuSnapshot = {
  id: string
  nome: string
  icone?: string | null
  ordem: number
  ativo: boolean
  moduloId: string
  itens: ItemSnapshot[]
}

type ModuloSnapshot = {
  id: string
  nome: string
  descricao?: string | null
  ativo: boolean
  ordem: number
  sistemaId: string
  admins: AdminSnapshot[]
  menus: MenuSnapshot[]
}

type SistemaSnapshot = {
  id: string
  nome: string
  descricao?: string | null
  ativo: boolean
  admins: AdminSnapshot[]
  modulos: ModuloSnapshot[]
}

export class LixeiraService {
  constructor(private prisma: PrismaClient) {}

  listar() {
    return this.prisma.lixeira.findMany({
      orderBy: { excluidoEm: 'desc' },
      include: { excluidoPor: { select: { nomeCompleto: true } } },
    })
  }

  async excluirPermanente(id: string) {
    const item = await this.prisma.lixeira.findUnique({ where: { id } })
    if (!item) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Item não encontrado na lixeira.')
    return this.prisma.lixeira.delete({ where: { id } })
  }

  async restaurar(id: string) {
    const entrada = await this.prisma.lixeira.findUnique({ where: { id } })
    if (!entrada) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Item não encontrado na lixeira.')

    await this.prisma.$transaction(async (tx) => {
      if (entrada.tipo === 'sistema') {
        await this._restaurarSistema(tx, entrada.estrutura as SistemaSnapshot)
      } else if (entrada.tipo === 'modulo') {
        await this._restaurarModulo(tx, entrada.estrutura as ModuloSnapshot)
      } else if (entrada.tipo === 'menu') {
        await this._restaurarMenu(tx, entrada.estrutura as MenuSnapshot)
      } else if (entrada.tipo === 'item') {
        await this._restaurarItem(tx, entrada.estrutura as ItemSnapshot)
      }
      await tx.lixeira.delete({ where: { id } })
    })
  }

  private async _restaurarSistema(tx: any, s: SistemaSnapshot) {
    const existe = await tx.sistema.findUnique({ where: { id: s.id } })
    if (existe) throw new ErroNegocio('CONFLITO', `Sistema "${s.nome}" já existe. Renomeie antes de restaurar.`)
    await tx.sistema.create({ data: { id: s.id, nome: s.nome, descricao: s.descricao, ativo: s.ativo } })
    for (const a of s.admins ?? []) {
      const usuario = await tx.usuario.findUnique({ where: { id: a.usuarioId }, select: { id: true } })
      if (usuario) {
        await tx.adminSistema.upsert({
          where: { usuarioId_sistemaId: { usuarioId: a.usuarioId, sistemaId: s.id } },
          create: { usuarioId: a.usuarioId, sistemaId: s.id, ativo: a.ativo },
          update: {},
        })
      }
    }
    for (const m of s.modulos) await this._restaurarModulo(tx, m)
  }

  private async _restaurarModulo(tx: any, m: ModuloSnapshot) {
    const sistema = await tx.sistema.findUnique({ where: { id: m.sistemaId } })
    if (!sistema) throw new ErroNegocio('CONFLITO', `Sistema pai não encontrado. Restaure o sistema "${m.sistemaId}" primeiro.`)
    const existe = await tx.modulo.findUnique({ where: { id: m.id } })
    if (existe) throw new ErroNegocio('CONFLITO', `Módulo "${m.nome}" já existe.`)
    await tx.modulo.create({ data: { id: m.id, nome: m.nome, descricao: m.descricao, ativo: m.ativo, ordem: m.ordem, sistemaId: m.sistemaId } })
    for (const a of m.admins ?? []) {
      const usuario = await tx.usuario.findUnique({ where: { id: a.usuarioId }, select: { id: true } })
      if (usuario) {
        await tx.adminModulo.upsert({
          where: { usuarioId_moduloId: { usuarioId: a.usuarioId, moduloId: m.id } },
          create: { usuarioId: a.usuarioId, moduloId: m.id, ativo: a.ativo },
          update: {},
        })
      }
    }
    for (const menu of m.menus) await this._restaurarMenu(tx, menu)
  }

  private async _restaurarMenu(tx: any, menu: MenuSnapshot) {
    const modulo = await tx.modulo.findUnique({ where: { id: menu.moduloId } })
    if (!modulo) throw new ErroNegocio('CONFLITO', `Módulo pai não encontrado. Restaure o módulo primeiro.`)
    const existe = await tx.menu.findUnique({ where: { id: menu.id } })
    if (existe) throw new ErroNegocio('CONFLITO', `Menu "${menu.nome}" já existe.`)
    await tx.menu.create({ data: { id: menu.id, nome: menu.nome, icone: menu.icone, ordem: menu.ordem, ativo: menu.ativo, moduloId: menu.moduloId } })
    for (const item of menu.itens) await this._restaurarItemRecursivo(tx, item)
  }

  private async _restaurarItem(tx: any, item: ItemSnapshot) {
    const menu = await tx.menu.findUnique({ where: { id: item.menuId } })
    if (!menu) throw new ErroNegocio('CONFLITO', 'Menu pai não encontrado. Restaure o menu primeiro.')
    if (item.parentId) {
      const pai = await tx.itemFuncionalidade.findUnique({ where: { id: item.parentId } })
      if (!pai) throw new ErroNegocio('CONFLITO', 'Item pai não encontrado. Restaure o item pai primeiro.')
    }
    await this._restaurarItemRecursivo(tx, item)
  }

  private async _restaurarItemRecursivo(tx: any, item: ItemSnapshot) {
    const existe = await tx.itemFuncionalidade.findUnique({ where: { id: item.id } })
    if (!existe) {
      await tx.itemFuncionalidade.create({
        data: {
          id: item.id, nome: item.nome, descricao: item.descricao, tipo: item.tipo as any,
          tipoFuncionalidade: item.tipoFuncionalidade as any ?? null,
          rota: item.rota, icone: item.icone, ordem: item.ordem, ativo: item.ativo,
          menuId: item.menuId, parentId: item.parentId ?? null,
        },
      })
    }
    for (const sub of item.subItens ?? []) await this._restaurarItemRecursivo(tx, sub)
  }

  async salvarSistema(sistemaId: string, usuarioId: string, tx?: any) {
    const db = tx ?? this.prisma
    const sistema = await db.sistema.findUnique({
      where: { id: sistemaId },
      include: {
        admins: { select: { usuarioId: true, ativo: true } },
        modulos: {
          include: {
            admins: { select: { usuarioId: true, ativo: true } },
            menus: {
              include: {
                itens: {
                  where: { parentId: null },
                  include: {
                    subItens: { include: { subItens: true } },
                  },
                },
              },
            },
          },
        },
      },
    })
    if (!sistema) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Sistema não encontrado.')
    await db.lixeira.create({
      data: { tipo: 'sistema', nome: sistema.nome, estrutura: sistema, excluidoPorId: usuarioId },
    })
  }

  async salvarModulo(moduloId: string, usuarioId: string, tx?: any) {
    const db = tx ?? this.prisma
    const modulo = await db.modulo.findUnique({
      where: { id: moduloId },
      include: {
        admins: { select: { usuarioId: true, ativo: true } },
        menus: {
          include: {
            itens: {
              where: { parentId: null },
              include: { subItens: { include: { subItens: true } } },
            },
          },
        },
      },
    })
    if (!modulo) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Módulo não encontrado.')
    await db.lixeira.create({
      data: { tipo: 'modulo', nome: modulo.nome, estrutura: modulo, excluidoPorId: usuarioId },
    })
  }

  async salvarMenu(menuId: string, usuarioId: string, tx?: any) {
    const db = tx ?? this.prisma
    const menu = await db.menu.findUnique({
      where: { id: menuId },
      include: {
        itens: {
          where: { parentId: null },
          include: { subItens: { include: { subItens: true } } },
        },
      },
    })
    if (!menu) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Menu não encontrado.')
    await db.lixeira.create({
      data: { tipo: 'menu', nome: menu.nome, estrutura: menu, excluidoPorId: usuarioId },
    })
  }

  async salvarItem(itemId: string, usuarioId: string, tx?: any) {
    const db = tx ?? this.prisma
    const item = await db.itemFuncionalidade.findUnique({
      where: { id: itemId },
      include: { subItens: { include: { subItens: true } } },
    })
    if (!item) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Item não encontrado.')
    await db.lixeira.create({
      data: { tipo: 'item', nome: item.nome, estrutura: item, excluidoPorId: usuarioId },
    })
  }

  async contarFilhosSistema(sistemaId: string) {
    const modulos = await this.prisma.modulo.findMany({
      where: { sistemaId },
      include: { _count: { select: { menus: true } } },
    })
    const qtdModulos = modulos.length
    const qtdMenus = modulos.reduce((acc, m) => acc + m._count.menus, 0)
    const relatorios = await this.prisma.relatorioFixo.count({ where: { sistemaId } })
    return { modulos: qtdModulos, menus: qtdMenus, relatorios }
  }

  async contarFilhosModulo(moduloId: string) {
    return this.prisma.menu.count({ where: { moduloId } })
  }

  async contarFilhosMenu(menuId: string) {
    return this.prisma.itemFuncionalidade.count({ where: { menuId } })
  }

  async contarFilhosItem(itemId: string) {
    return this.prisma.itemFuncionalidade.count({ where: { parentId: itemId } })
  }
}
