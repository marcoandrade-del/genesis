import { PrismaClient, NivelAcesso, Prisma } from '@prisma/client'
import { ErroNegocio } from '../errors.js'

export class PermissoesService {
  constructor(private prisma: PrismaClient) {}

  async listarPorUsuario(usuarioId: string) {
    const usuario = await this.prisma.usuario.findUnique({ where: { id: usuarioId } })
    if (!usuario) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Usuário não encontrado.')
    return this.prisma.permissaoAcesso.findMany({
      where: { usuarioId },
      include: { item: { select: { id: true, nome: true, tipoFuncionalidade: true } } },
      orderBy: { criadoEm: 'asc' },
    })
  }

  async listarPorItem(itemId: string) {
    const item = await this.prisma.itemFuncionalidade.findUnique({ where: { id: itemId } })
    if (!item) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Item não encontrado.')
    return this.prisma.permissaoAcesso.findMany({
      where: { itemId },
      include: { usuario: { select: { id: true, nomeCompleto: true, emailPrincipal: true } } },
      orderBy: { criadoEm: 'asc' },
    })
  }

  buscarPorId(id: string) {
    return this.prisma.permissaoAcesso.findUnique({ where: { id } })
  }

  async conceder(usuarioId: string, dados: { itemId: string; nivel: NivelAcesso }) {
    const [usuario, item] = await Promise.all([
      this.prisma.usuario.findUnique({ where: { id: usuarioId } }),
      this.prisma.itemFuncionalidade.findUnique({ where: { id: dados.itemId } }),
    ] as const)

    if (!usuario) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Usuário não encontrado.')
    if (!usuario.ativo) throw new ErroNegocio('CONFLITO', 'Não é possível conceder permissão a usuário inativo.')
    if (!item) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Item não encontrado.')
    if (!item.ativo) throw new ErroNegocio('CONFLITO', 'Não é possível conceder permissão a item inativo.')

    try {
      return await this.prisma.permissaoAcesso.create({ data: { usuarioId, ...dados } })
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ErroNegocio('CONFLITO', 'Usuário já possui permissão para este item.')
      }
      throw e
    }
  }

  async atualizar(id: string, nivel: NivelAcesso) {
    return this.prisma.permissaoAcesso.update({ where: { id }, data: { nivel } })
  }

  async revogar(id: string) {
    return this.prisma.permissaoAcesso.delete({ where: { id } })
  }
}
