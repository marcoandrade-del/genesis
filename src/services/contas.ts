import { PrismaClient, Prisma } from '@prisma/client'
import { ErroNegocio } from '../errors.js'

export const NIVEL_MAX = 6

export type DadosCriarConta = {
  planoId: string
  codigo: string
  descricao: string
  parentId?: string | null
  admiteMovimento?: boolean
}

export type DadosAtualizarConta = {
  codigo?: string
  descricao?: string
  admiteMovimento?: boolean
}

/**
 * Service do plano de contas — núcleo das regras de hierarquia.
 *
 * Invariantes mantidos pelas validações:
 *  1. nível 1..NIVEL_MAX, derivado do parent.
 *  2. admiteMovimento=true ⟹ conta é folha (sem filhos).
 *  3. Adicionar filho a uma conta com admiteMovimento=true: proibido.
 *  4. Marcar admiteMovimento=true em conta com filhos: proibido.
 *  5. Exclusão proibida quando há filhos OU LancamentoItem OU
 *     ResumoMensalConta != 0 OU SaldoInicialAno != 0.
 *  6. Código único por plano (FK do DB via @@unique).
 */
export class ContasService {
  constructor(private prisma: PrismaClient) {}

  async listar(planoId: string) {
    return this.prisma.conta.findMany({
      where: { planoId },
      orderBy: { codigo: 'asc' },
    })
  }

  buscarPorId(id: string) {
    return this.prisma.conta.findUnique({ where: { id } })
  }

  async criar(dados: DadosCriarConta) {
    const plano = await this.prisma.planoDeContas.findUnique({ where: { id: dados.planoId } })
    if (!plano) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Plano de contas não encontrado.')

    let nivel = 1
    if (dados.parentId) {
      const parent = await this.prisma.conta.findUnique({ where: { id: dados.parentId } })
      if (!parent) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Conta pai não encontrada.')
      if (parent.planoId !== dados.planoId) {
        throw new ErroNegocio('REQUISICAO_INVALIDA', 'Conta pai pertence a outro plano.')
      }
      if (parent.admiteMovimento) {
        throw new ErroNegocio('CONFLITO', 'Não é possível adicionar filho a uma conta que admite movimento.')
      }
      nivel = parent.nivel + 1
      if (nivel > NIVEL_MAX) {
        throw new ErroNegocio('CONFLITO', `Profundidade máxima de ${NIVEL_MAX} níveis excedida.`)
      }
    }

    try {
      return await this.prisma.conta.create({
        data: {
          planoId: dados.planoId,
          codigo: dados.codigo,
          descricao: dados.descricao,
          nivel,
          admiteMovimento: dados.admiteMovimento ?? false,
          parentId: dados.parentId ?? null,
        },
      })
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ErroNegocio('CONFLITO', `Já existe uma conta com o código "${dados.codigo}" neste plano.`)
      }
      throw e
    }
  }

  /**
   * Atualiza codigo / descricao / admiteMovimento. O parent é imutável aqui
   * — mover conta entre pais reorganiza a hierarquia e exige operação dedicada.
   */
  async atualizar(id: string, dados: DadosAtualizarConta) {
    const conta = await this.prisma.conta.findUnique({ where: { id } })
    if (!conta) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Conta não encontrada.')

    // Marcar admiteMovimento=true exige que a conta seja folha (sem filhos).
    if (dados.admiteMovimento === true && conta.admiteMovimento === false) {
      const filhos = await this.prisma.conta.count({ where: { parentId: id } })
      if (filhos > 0) {
        throw new ErroNegocio('CONFLITO', 'Conta com filhos não pode admitir movimento.')
      }
    }

    try {
      return await this.prisma.conta.update({ where: { id }, data: dados })
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError) {
        if (e.code === 'P2002') throw new ErroNegocio('CONFLITO', 'Já existe uma conta com esse código neste plano.')
        if (e.code === 'P2025') throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Conta não encontrada.')
      }
      throw e
    }
  }

  async excluir(id: string) {
    const conta = await this.prisma.conta.findUnique({ where: { id } })
    if (!conta) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Conta não encontrada.')

    const [filhos, lancs, resumos, saldos] = await Promise.all([
      this.prisma.conta.count({ where: { parentId: id } }),
      this.prisma.lancamentoItem.count({ where: { contaId: id } }),
      this.prisma.resumoMensalConta.count({ where: { contaId: id } }),
      this.prisma.saldoInicialAno.count({ where: { contaId: id } }),
    ])

    if (filhos > 0) {
      throw new ErroNegocio('CONFLITO', `Conta com ${filhos} filho(s) não pode ser excluída.`)
    }
    if (lancs + resumos + saldos > 0) {
      throw new ErroNegocio(
        'CONFLITO',
        `Conta com movimentação contábil não pode ser excluída (lançamentos=${lancs}, resumos=${resumos}, saldos=${saldos}).`,
      )
    }

    await this.prisma.conta.delete({ where: { id } })
  }
}
