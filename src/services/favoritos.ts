import { PrismaClient, Prisma } from '@prisma/client'
import { ErroNegocio } from '../errors.js'

const incluirSubPastas = {
  subPastas: { orderBy: [{ ordem: 'asc' as const }, { nome: 'asc' as const }] },
}

type CriarPastaDados = { nome: string; ordem?: number; parentId?: string }
type AtualizarPastaDados = { nome?: string; ordem?: number }

type CriarFavoritoDados = {
  pastaId?: string
  relatorioFixoId?: string
  relatorioPersonalizadoId?: string
  ordem?: number
}

export class FavoritosService {
  constructor(private prisma: PrismaClient) {}

  // ── Pastas ────────────────────────────────────────────────────

  async listarPastas(usuarioId: string) {
    const usuario = await this.prisma.usuario.findUnique({ where: { id: usuarioId } })
    if (!usuario) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Usuário não encontrado.')
    return this.prisma.pastaFavorito.findMany({
      where: { usuarioId, parentId: null },
      include: incluirSubPastas,
      orderBy: [{ ordem: 'asc' }, { nome: 'asc' }],
    })
  }

  buscarPastaPorId(id: string) {
    return this.prisma.pastaFavorito.findUnique({ where: { id }, include: incluirSubPastas })
  }

  async criarPasta(usuarioId: string, dados: CriarPastaDados) {
    const usuario = await this.prisma.usuario.findUnique({ where: { id: usuarioId } })
    if (!usuario) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Usuário não encontrado.')

    if (dados.parentId) {
      const pai = await this.prisma.pastaFavorito.findUnique({ where: { id: dados.parentId } })
      if (!pai) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Pasta pai não encontrada.')
      if (pai.usuarioId !== usuarioId) throw new ErroNegocio('REQUISICAO_INVALIDA', 'A pasta pai deve pertencer ao mesmo usuário.')
    }

    return this.prisma.pastaFavorito.create({ data: { ...dados, usuarioId } })
  }

  async atualizarPasta(id: string, dados: AtualizarPastaDados) {
    return this.prisma.pastaFavorito.update({ where: { id }, data: dados, include: incluirSubPastas })
  }

  async excluirPasta(id: string) {
    const subPastas = await this.prisma.pastaFavorito.count({ where: { parentId: id } })
    if (subPastas > 0) throw new ErroNegocio('CONFLITO', 'Não é possível excluir uma pasta com subpastas vinculadas.')

    const favoritos = await this.prisma.favoritoRelatorio.count({ where: { pastaId: id } })
    if (favoritos > 0) throw new ErroNegocio('CONFLITO', 'Não é possível excluir uma pasta com favoritos vinculados.')

    return this.prisma.pastaFavorito.delete({ where: { id } })
  }

  // ── Favoritos ─────────────────────────────────────────────────

  async listarFavoritos(usuarioId: string) {
    const usuario = await this.prisma.usuario.findUnique({ where: { id: usuarioId } })
    if (!usuario) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Usuário não encontrado.')
    return this.prisma.favoritoRelatorio.findMany({
      where: { usuarioId },
      include: {
        pasta: { select: { id: true, nome: true } },
        relatorioFixo: { select: { id: true, nome: true } },
        relatorioPersonalizado: { select: { id: true, nome: true } },
      },
      orderBy: { ordem: 'asc' },
    })
  }

  buscarFavoritoPorId(id: string) {
    return this.prisma.favoritoRelatorio.findUnique({ where: { id } })
  }

  async adicionarFavorito(usuarioId: string, dados: CriarFavoritoDados) {
    const usuario = await this.prisma.usuario.findUnique({ where: { id: usuarioId } })
    if (!usuario) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Usuário não encontrado.')

    const temFixo = !!dados.relatorioFixoId
    const temPersonalizado = !!dados.relatorioPersonalizadoId
    if (!temFixo && !temPersonalizado) {
      throw new ErroNegocio('REQUISICAO_INVALIDA', 'Informe relatorioFixoId ou relatorioPersonalizadoId.')
    }
    if (temFixo && temPersonalizado) {
      throw new ErroNegocio('REQUISICAO_INVALIDA', 'Informe apenas um tipo de relatório por favorito.')
    }

    if (dados.relatorioFixoId) {
      const rel = await this.prisma.relatorioFixo.findUnique({ where: { id: dados.relatorioFixoId } })
      if (!rel) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Relatório fixo não encontrado.')
      const jaExiste = await this.prisma.favoritoRelatorio.findFirst({
        where: { usuarioId, relatorioFixoId: dados.relatorioFixoId },
      })
      if (jaExiste) throw new ErroNegocio('CONFLITO', 'Este relatório já está nos favoritos.')
    }

    if (dados.relatorioPersonalizadoId) {
      const rel = await this.prisma.relatorioPersonalizado.findUnique({ where: { id: dados.relatorioPersonalizadoId } })
      if (!rel) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Relatório personalizado não encontrado.')
      if (rel.usuarioId !== usuarioId) throw new ErroNegocio('REQUISICAO_INVALIDA', 'Relatório não pertence a este usuário.')
      const jaExiste = await this.prisma.favoritoRelatorio.findFirst({
        where: { usuarioId, relatorioPersonalizadoId: dados.relatorioPersonalizadoId },
      })
      if (jaExiste) throw new ErroNegocio('CONFLITO', 'Este relatório já está nos favoritos.')
    }

    if (dados.pastaId) {
      const pasta = await this.prisma.pastaFavorito.findUnique({ where: { id: dados.pastaId } })
      if (!pasta) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Pasta não encontrada.')
      if (pasta.usuarioId !== usuarioId) throw new ErroNegocio('REQUISICAO_INVALIDA', 'A pasta não pertence a este usuário.')
    }

    return this.prisma.favoritoRelatorio.create({ data: { ...dados, usuarioId } })
  }

  async moverFavorito(id: string, dados: { pastaId?: string | null; ordem?: number }) {
    return this.prisma.favoritoRelatorio.update({ where: { id }, data: dados })
  }

  async removerFavorito(id: string) {
    return this.prisma.favoritoRelatorio.delete({ where: { id } })
  }
}
