import { PrismaClient, Prisma, type NivelAcessoEntidade } from '@prisma/client'
import { ErroNegocio } from '../errors.js'

const NIVEIS_VALIDOS: ReadonlyArray<NivelAcessoEntidade> = ['LEITURA', 'ESCRITA', 'ADMIN']

// Hierarquia: ADMIN ⊃ ESCRITA ⊃ LEITURA.
// `ESCRITA` cumpre `LEITURA`; `ADMIN` cumpre todos.
const PESO: Record<NivelAcessoEntidade, number> = {
  LEITURA: 1,
  ESCRITA: 2,
  ADMIN: 3,
}

export type DadosAcesso = {
  usuarioId: string
  entidadeId: string
  nivel: NivelAcessoEntidade | string
  ativo?: boolean
}

/**
 * AcessoEntidade: permissão de um usuário comum (não-admin do sistema) sobre
 * uma Entidade municipal específica. Único por (usuário, entidade) — um nível
 * por par. Usado pelo login de usuário para listar entidades acessíveis e por
 * middlewares para autorizar operações dentro do contexto da entidade.
 */
export class AcessosEntidadeService {
  constructor(private prisma: PrismaClient) {}

  /** Lista acessos de um usuário, com dados da entidade. */
  listarPorUsuario(usuarioId: string) {
    return this.prisma.acessoEntidade.findMany({
      where: { usuarioId, ativo: true },
      include: {
        entidade: {
          include: { municipio: { include: { estado: { select: { sigla: true, nome: true } } } } },
        },
      },
      orderBy: [{ entidade: { municipio: { nome: 'asc' } } }, { entidade: { nome: 'asc' } }],
    })
  }

  /** Lista acessos de uma entidade, com dados do usuário. */
  listarPorEntidade(entidadeId: string) {
    return this.prisma.acessoEntidade.findMany({
      where: { entidadeId, ativo: true },
      include: { usuario: { select: { id: true, nomeCompleto: true, emailPrincipal: true } } },
      orderBy: { usuario: { nomeCompleto: 'asc' } },
    })
  }

  buscarPorId(id: string) {
    return this.prisma.acessoEntidade.findUnique({ where: { id } })
  }

  /** Verifica se o usuário tem pelo menos `nivelMinimo` sobre a entidade. */
  async usuarioPodeAcessar(
    usuarioId: string,
    entidadeId: string,
    nivelMinimo: NivelAcessoEntidade = 'LEITURA',
  ): Promise<boolean> {
    const acesso = await this.prisma.acessoEntidade.findUnique({
      where: { usuarioId_entidadeId: { usuarioId, entidadeId } },
    })
    if (!acesso || !acesso.ativo) return false
    return PESO[acesso.nivel] >= PESO[nivelMinimo]
  }

  /** Concede ou atualiza acesso (upsert). */
  async conceder(dados: DadosAcesso) {
    const { usuarioId, entidadeId, nivel } = this.validar(dados)

    const [usuario, entidade] = await Promise.all([
      this.prisma.usuario.findUnique({ where: { id: usuarioId } }),
      this.prisma.entidade.findUnique({ where: { id: entidadeId } }),
    ])
    if (!usuario) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Usuário não encontrado.')
    if (!entidade) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Entidade não encontrada.')

    return this.prisma.acessoEntidade.upsert({
      where: { usuarioId_entidadeId: { usuarioId, entidadeId } },
      create: { usuarioId, entidadeId, nivel, ativo: dados.ativo ?? true },
      update: { nivel, ativo: dados.ativo ?? true },
    })
  }

  /** Revoga acesso (delete físico). Para suspender temporariamente, use `atualizar` com `ativo=false`. */
  async revogar(id: string) {
    const existente = await this.prisma.acessoEntidade.findUnique({ where: { id } })
    if (!existente) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Acesso não encontrado.')
    try {
      await this.prisma.acessoEntidade.delete({ where: { id } })
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2003') {
        throw new ErroNegocio('CONFLITO', 'Acesso vinculado a registros e não pode ser removido.')
      }
      throw e
    }
  }

  async atualizar(id: string, dados: { nivel?: NivelAcessoEntidade | string; ativo?: boolean }) {
    const existente = await this.prisma.acessoEntidade.findUnique({ where: { id } })
    if (!existente) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Acesso não encontrado.')

    let nivel: NivelAcessoEntidade | undefined
    if (dados.nivel !== undefined) {
      if (!NIVEIS_VALIDOS.includes(dados.nivel as NivelAcessoEntidade)) {
        throw new ErroNegocio(
          'REQUISICAO_INVALIDA',
          `Nível inválido: "${dados.nivel}". Use LEITURA, ESCRITA ou ADMIN.`,
        )
      }
      nivel = dados.nivel as NivelAcessoEntidade
    }

    return this.prisma.acessoEntidade.update({
      where: { id },
      data: {
        ...(nivel !== undefined ? { nivel } : {}),
        ...(dados.ativo !== undefined ? { ativo: dados.ativo } : {}),
      },
    })
  }

  private validar(dados: DadosAcesso): {
    usuarioId: string
    entidadeId: string
    nivel: NivelAcessoEntidade
  } {
    const usuarioId = dados.usuarioId?.trim() ?? ''
    const entidadeId = dados.entidadeId?.trim() ?? ''
    if (!usuarioId) throw new ErroNegocio('REQUISICAO_INVALIDA', 'usuarioId é obrigatório.')
    if (!entidadeId) throw new ErroNegocio('REQUISICAO_INVALIDA', 'entidadeId é obrigatório.')
    if (!NIVEIS_VALIDOS.includes(dados.nivel as NivelAcessoEntidade)) {
      throw new ErroNegocio(
        'REQUISICAO_INVALIDA',
        `Nível inválido: "${dados.nivel}". Use LEITURA, ESCRITA ou ADMIN.`,
      )
    }
    return { usuarioId, entidadeId, nivel: dados.nivel as NivelAcessoEntidade }
  }
}
