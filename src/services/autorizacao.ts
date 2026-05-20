import { Prisma, type PrismaClient } from '@prisma/client'
import { ErroNegocio } from '../errors.js'

type TxOrClient = PrismaClient | Prisma.TransactionClient

const MSG = 'Apenas administradores vinculados podem realizar esta operação.'

export async function ehAdminSistema(
  prisma: TxOrClient,
  usuarioId: string,
  sistemaId: string,
): Promise<boolean> {
  const r = await prisma.adminSistema.findUnique({
    where: { usuarioId_sistemaId: { usuarioId, sistemaId } },
    select: { ativo: true },
  })
  return !!r?.ativo
}

export async function ehAdminModulo(
  prisma: TxOrClient,
  usuarioId: string,
  moduloId: string,
): Promise<boolean> {
  const direto = await prisma.adminModulo.findUnique({
    where: { usuarioId_moduloId: { usuarioId, moduloId } },
    select: { ativo: true },
  })
  if (direto?.ativo) return true
  const modulo = await prisma.modulo.findUnique({
    where: { id: moduloId },
    select: { sistemaId: true },
  })
  if (!modulo) return false
  return ehAdminSistema(prisma, usuarioId, modulo.sistemaId)
}

export async function assertAdminSistema(
  prisma: TxOrClient,
  usuarioId: string,
  sistemaId: string,
): Promise<void> {
  if (!(await ehAdminSistema(prisma, usuarioId, sistemaId))) {
    throw new ErroNegocio('NAO_AUTORIZADO', MSG)
  }
}

export async function assertAdminModulo(
  prisma: TxOrClient,
  usuarioId: string,
  moduloId: string,
): Promise<void> {
  if (!(await ehAdminModulo(prisma, usuarioId, moduloId))) {
    throw new ErroNegocio('NAO_AUTORIZADO', MSG)
  }
}

// Resolve menu → moduloId, então delega para assertAdminModulo.
export async function assertAdminMenu(
  prisma: TxOrClient,
  usuarioId: string,
  menuId: string,
): Promise<void> {
  const menu = await prisma.menu.findUnique({
    where: { id: menuId },
    select: { moduloId: true },
  })
  if (!menu) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Menu não encontrado.')
  await assertAdminModulo(prisma, usuarioId, menu.moduloId)
}

// Resolve item → menu → moduloId, então delega para assertAdminModulo.
export async function assertAdminItem(
  prisma: TxOrClient,
  usuarioId: string,
  itemId: string,
): Promise<void> {
  const item = await prisma.itemFuncionalidade.findUnique({
    where: { id: itemId },
    select: { menu: { select: { moduloId: true } } },
  })
  if (!item) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Item não encontrado.')
  await assertAdminModulo(prisma, usuarioId, item.menu.moduloId)
}
