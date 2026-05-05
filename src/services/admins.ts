import { PrismaClient, Prisma } from '@prisma/client'
import { ErroNegocio } from '../errors.js'

export class AdminsService {
  constructor(private prisma: PrismaClient) {}

  // ── AdminSistema ──────────────────────────────────────────────

  async listarAdminsSistema(sistemaId: string) {
    const sistema = await this.prisma.sistema.findUnique({ where: { id: sistemaId } })
    if (!sistema) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Sistema não encontrado.')
    return this.prisma.adminSistema.findMany({
      where: { sistemaId },
      include: { usuario: { select: { id: true, nomeCompleto: true, emailPrincipal: true, ativo: true } } },
      orderBy: { criadoEm: 'asc' },
    })
  }

  async adicionarAdminSistema(sistemaId: string, usuarioId: string) {
    const [sistema, usuario] = await Promise.all([
      this.prisma.sistema.findUnique({ where: { id: sistemaId } }),
      this.prisma.usuario.findUnique({ where: { id: usuarioId } }),
    ] as const)

    if (!sistema) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Sistema não encontrado.')
    if (!usuario) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Usuário não encontrado.')
    if (!usuario.ativo) throw new ErroNegocio('CONFLITO', 'Usuário inativo não pode ser administrador.')

    try {
      return await this.prisma.adminSistema.create({ data: { sistemaId, usuarioId } })
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ErroNegocio('CONFLITO', 'Usuário já é administrador deste sistema.')
      }
      throw e
    }
  }

  async removerAdminSistema(sistemaId: string, usuarioId: string) {
    const admin = await this.prisma.adminSistema.findUnique({
      where: { usuarioId_sistemaId: { usuarioId, sistemaId } },
    })
    if (!admin) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Administrador não encontrado.')

    const ativos = await this.prisma.adminSistema.count({ where: { sistemaId, ativo: true } })
    if (ativos <= 1 && admin.ativo) {
      throw new ErroNegocio('CONFLITO', 'O sistema deve ter pelo menos um administrador ativo.')
    }

    return this.prisma.adminSistema.delete({ where: { usuarioId_sistemaId: { usuarioId, sistemaId } } })
  }

  // ── AdminModulo ───────────────────────────────────────────────

  async listarAdminsModulo(moduloId: string) {
    const modulo = await this.prisma.modulo.findUnique({ where: { id: moduloId } })
    if (!modulo) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Módulo não encontrado.')
    return this.prisma.adminModulo.findMany({
      where: { moduloId },
      include: { usuario: { select: { id: true, nomeCompleto: true, emailPrincipal: true, ativo: true } } },
      orderBy: { criadoEm: 'asc' },
    })
  }

  async adicionarAdminModulo(moduloId: string, usuarioId: string) {
    const [modulo, usuario] = await Promise.all([
      this.prisma.modulo.findUnique({ where: { id: moduloId } }),
      this.prisma.usuario.findUnique({ where: { id: usuarioId } }),
    ] as const)

    if (!modulo) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Módulo não encontrado.')
    if (!usuario) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Usuário não encontrado.')
    if (!usuario.ativo) throw new ErroNegocio('CONFLITO', 'Usuário inativo não pode ser administrador.')

    try {
      return await this.prisma.adminModulo.create({ data: { moduloId, usuarioId } })
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ErroNegocio('CONFLITO', 'Usuário já é administrador deste módulo.')
      }
      throw e
    }
  }

  async removerAdminModulo(moduloId: string, usuarioId: string) {
    const admin = await this.prisma.adminModulo.findUnique({
      where: { usuarioId_moduloId: { usuarioId, moduloId } },
    })
    if (!admin) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Administrador não encontrado.')

    const ativos = await this.prisma.adminModulo.count({ where: { moduloId, ativo: true } })
    if (ativos <= 1 && admin.ativo) {
      throw new ErroNegocio('CONFLITO', 'O módulo deve ter pelo menos um administrador ativo.')
    }

    return this.prisma.adminModulo.delete({ where: { usuarioId_moduloId: { usuarioId, moduloId } } })
  }
}
