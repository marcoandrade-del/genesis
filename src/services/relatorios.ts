import { PrismaClient } from '@prisma/client'
import { ErroNegocio } from '../errors.js'

// ── Relatórios Fixos (definidos pelo sistema) ─────────────────────────────────

type CriarFixoDados = { nome: string; descricao?: string; rota: string }
type AtualizarFixoDados = { nome?: string; descricao?: string; rota?: string; ativo?: boolean }

// ── Relatórios Personalizados (criados pelo usuário) ──────────────────────────

type CriarPersonalizadoDados = { nome: string; descricao?: string; configuracao: object }
type AtualizarPersonalizadoDados = { nome?: string; descricao?: string; configuracao?: object; ativo?: boolean }

export class RelatoriosService {
  constructor(private prisma: PrismaClient) {}

  // ── Fixos ─────────────────────────────────────────────────────

  async listarFixos(sistemaId: string) {
    const sistema = await this.prisma.sistema.findUnique({ where: { id: sistemaId } })
    if (!sistema) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Sistema não encontrado.')
    return this.prisma.relatorioFixo.findMany({
      where: { sistemaId },
      orderBy: { nome: 'asc' },
    })
  }

  buscarFixoPorId(id: string) {
    return this.prisma.relatorioFixo.findUnique({ where: { id } })
  }

  async criarFixo(sistemaId: string, dados: CriarFixoDados) {
    const sistema = await this.prisma.sistema.findUnique({ where: { id: sistemaId } })
    if (!sistema) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Sistema não encontrado.')
    if (!sistema.ativo) throw new ErroNegocio('CONFLITO', 'Não é possível adicionar relatórios a um sistema inativo.')
    return this.prisma.relatorioFixo.create({ data: { ...dados, sistemaId } })
  }

  async atualizarFixo(id: string, dados: AtualizarFixoDados) {
    return this.prisma.relatorioFixo.update({ where: { id }, data: dados })
  }

  async excluirFixo(id: string) {
    const favoritos = await this.prisma.favoritoRelatorio.count({ where: { relatorioFixoId: id } })
    if (favoritos > 0) throw new ErroNegocio('CONFLITO', 'Não é possível excluir um relatório com favoritos vinculados.')
    return this.prisma.relatorioFixo.delete({ where: { id } })
  }

  // ── Personalizados ────────────────────────────────────────────

  async listarPersonalizados(usuarioId: string) {
    const usuario = await this.prisma.usuario.findUnique({ where: { id: usuarioId } })
    if (!usuario) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Usuário não encontrado.')
    return this.prisma.relatorioPersonalizado.findMany({
      where: { usuarioId },
      orderBy: { nome: 'asc' },
    })
  }

  buscarPersonalizadoPorId(id: string) {
    return this.prisma.relatorioPersonalizado.findUnique({ where: { id } })
  }

  async criarPersonalizado(usuarioId: string, dados: CriarPersonalizadoDados) {
    const usuario = await this.prisma.usuario.findUnique({ where: { id: usuarioId } })
    if (!usuario) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Usuário não encontrado.')
    if (!usuario.ativo) throw new ErroNegocio('CONFLITO', 'Usuário inativo não pode criar relatórios.')

    return this.prisma.relatorioPersonalizado.create({ data: { ...dados, usuarioId } })
  }

  async atualizarPersonalizado(id: string, dados: AtualizarPersonalizadoDados) {
    return this.prisma.relatorioPersonalizado.update({ where: { id }, data: dados })
  }

  async excluirPersonalizado(id: string) {
    const favoritos = await this.prisma.favoritoRelatorio.count({ where: { relatorioPersonalizadoId: id } })
    if (favoritos > 0) throw new ErroNegocio('CONFLITO', 'Não é possível excluir um relatório com favoritos vinculados.')
    return this.prisma.relatorioPersonalizado.delete({ where: { id } })
  }
}
