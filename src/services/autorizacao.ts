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
