import { PrismaClient, type NivelAcessoEntidade } from '@prisma/client'
import { ErroNegocio } from '../errors.js'

const NIVEIS_VALIDOS: ReadonlyArray<NivelAcessoEntidade> = ['LEITURA', 'ESCRITA', 'ADMIN']

const incluiEntidadeCompleta = {
  entidade: {
    include: { municipio: { include: { estado: { select: { sigla: true, nome: true } } } } },
  },
} as const

/**
 * SolicitacaoAcessoEntidade: pedido de um usuário comum por acesso a uma
 * Entidade, com aprovação. O usuário SUGERE um nível; o aprovador (admin do
 * sistema na PR-1; admin da entidade na PR-2) decide o nível final ao aprovar,
 * criando/ativando o `AcessoEntidade` na mesma transação. A regra "no máximo 1
 * PENDENTE por (usuário, entidade)" é garantida aqui (Prisma não modela unique
 * parcial por status).
 */
export class SolicitacoesAcessoService {
  constructor(private prisma: PrismaClient) {}

  /** Usuário pede acesso. Barra entidade inativa, acesso já vigente e pendência duplicada. */
  async criar(dados: {
    usuarioId: string
    entidadeId: string
    nivelSolicitado: NivelAcessoEntidade | string
    justificativa?: string
  }) {
    const usuarioId = dados.usuarioId?.trim() ?? ''
    const entidadeId = dados.entidadeId?.trim() ?? ''
    if (!usuarioId) throw new ErroNegocio('REQUISICAO_INVALIDA', 'usuarioId é obrigatório.')
    if (!entidadeId) throw new ErroNegocio('REQUISICAO_INVALIDA', 'entidadeId é obrigatório.')
    if (!NIVEIS_VALIDOS.includes(dados.nivelSolicitado as NivelAcessoEntidade)) {
      throw new ErroNegocio(
        'REQUISICAO_INVALIDA',
        `Nível inválido: "${dados.nivelSolicitado}". Use LEITURA, ESCRITA ou ADMIN.`,
      )
    }

    const entidade = await this.prisma.entidade.findUnique({ where: { id: entidadeId } })
    if (!entidade || !entidade.ativo) {
      throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Entidade não encontrada ou inativa.')
    }

    const acessoVigente = await this.prisma.acessoEntidade.findUnique({
      where: { usuarioId_entidadeId: { usuarioId, entidadeId } },
    })
    if (acessoVigente?.ativo) {
      throw new ErroNegocio('CONFLITO', 'Você já tem acesso a esta entidade.')
    }

    const pendente = await this.prisma.solicitacaoAcessoEntidade.findFirst({
      where: { usuarioId, entidadeId, status: 'PENDENTE' },
    })
    if (pendente) {
      throw new ErroNegocio('CONFLITO', 'Já existe uma solicitação pendente para esta entidade.')
    }

    return this.prisma.solicitacaoAcessoEntidade.create({
      data: {
        usuarioId,
        entidadeId,
        nivelSolicitado: dados.nivelSolicitado as NivelAcessoEntidade,
        justificativa: dados.justificativa?.trim() || null,
      },
    })
  }

  /** Solicitações do próprio usuário (mais recentes primeiro). */
  listarMinhas(usuarioId: string) {
    return this.prisma.solicitacaoAcessoEntidade.findMany({
      where: { usuarioId },
      include: incluiEntidadeCompleta,
      orderBy: { criadoEm: 'desc' },
    })
  }

  /** Fila de pendentes (PR-1: admin do sistema vê todas). */
  listarPendentes() {
    return this.prisma.solicitacaoAcessoEntidade.findMany({
      where: { status: 'PENDENTE' },
      include: {
        usuario: { select: { id: true, nomeCompleto: true, emailPrincipal: true } },
        ...incluiEntidadeCompleta,
      },
      orderBy: { criadoEm: 'asc' },
    })
  }

  /** Usuário cancela a própria solicitação pendente. */
  async cancelar(id: string, usuarioId: string) {
    const sol = await this.prisma.solicitacaoAcessoEntidade.findUnique({ where: { id } })
    if (!sol || sol.usuarioId !== usuarioId) {
      throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Solicitação não encontrada.')
    }
    if (sol.status !== 'PENDENTE') {
      throw new ErroNegocio('CONFLITO', 'Só é possível cancelar uma solicitação pendente.')
    }
    return this.prisma.solicitacaoAcessoEntidade.update({
      where: { id },
      data: { status: 'CANCELADA' },
    })
  }

  /**
   * Aprova: cria/ativa o `AcessoEntidade` no nível concedido (o aprovador decide
   * o nível final, independente do sugerido) e marca a solicitação APROVADA — na
   * mesma transação.
   */
  async aprovar(
    id: string,
    aprovadorId: string,
    nivelConcedido: NivelAcessoEntidade | string,
    observacao?: string,
  ) {
    if (!NIVEIS_VALIDOS.includes(nivelConcedido as NivelAcessoEntidade)) {
      throw new ErroNegocio(
        'REQUISICAO_INVALIDA',
        `Nível inválido: "${nivelConcedido}". Use LEITURA, ESCRITA ou ADMIN.`,
      )
    }
    const sol = await this.prisma.solicitacaoAcessoEntidade.findUnique({ where: { id } })
    if (!sol) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Solicitação não encontrada.')
    if (sol.status !== 'PENDENTE') throw new ErroNegocio('CONFLITO', 'Solicitação já foi decidida.')

    const nivel = nivelConcedido as NivelAcessoEntidade
    return this.prisma.$transaction(async (tx) => {
      await tx.acessoEntidade.upsert({
        where: { usuarioId_entidadeId: { usuarioId: sol.usuarioId, entidadeId: sol.entidadeId } },
        create: { usuarioId: sol.usuarioId, entidadeId: sol.entidadeId, nivel, ativo: true },
        update: { nivel, ativo: true },
      })
      return tx.solicitacaoAcessoEntidade.update({
        where: { id },
        data: {
          status: 'APROVADA',
          nivelConcedido: nivel,
          decididoPorId: aprovadorId,
          decididoEm: new Date(),
          observacaoDecisao: observacao?.trim() || null,
        },
      })
    })
  }

  /** Rejeita a solicitação pendente. */
  async rejeitar(id: string, aprovadorId: string, observacao?: string) {
    const sol = await this.prisma.solicitacaoAcessoEntidade.findUnique({ where: { id } })
    if (!sol) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Solicitação não encontrada.')
    if (sol.status !== 'PENDENTE') throw new ErroNegocio('CONFLITO', 'Solicitação já foi decidida.')
    return this.prisma.solicitacaoAcessoEntidade.update({
      where: { id },
      data: {
        status: 'REJEITADA',
        decididoPorId: aprovadorId,
        decididoEm: new Date(),
        observacaoDecisao: observacao?.trim() || null,
      },
    })
  }
}
