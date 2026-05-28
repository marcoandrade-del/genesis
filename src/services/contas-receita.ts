import { PrismaClient, Prisma } from '@prisma/client'
import { ErroNegocio } from '../errors.js'

// A Natureza da Receita do MCASP tem 8 dígitos base, mas os TCEs estaduais
// estendem o detalhamento (o PR chega a ~12 segmentos). Teto generoso.
export const NIVEL_MAX_RECEITA = 12

export type DadosCriarContaReceita = {
  planoId: string
  codigo: string
  descricao: string
  parentId?: string | null
  admiteMovimento?: boolean
}

export type DadosAtualizarContaReceita = {
  codigo?: string
  descricao?: string
  admiteMovimento?: boolean
}

/**
 * Conta da árvore do Plano de Contas da Receita. Espelha ContasService.
 *
 * Invariantes:
 *  1. nível 1..NIVEL_MAX_RECEITA, derivado do parent.
 *  2. admiteMovimento=true (analítica) ⟹ conta é folha (sem filhos).
 *  3. Proibido filho em conta que admite movimento; proibido marcar
 *     admiteMovimento em conta com filhos.
 *  4. Exclusão proibida quando há filhos.
 *  5. Código único por plano (FK do DB via @@unique).
 */
export class ContasReceitaService {
  constructor(private prisma: PrismaClient) {}

  async listar(planoId: string) {
    return this.prisma.contaReceita.findMany({ where: { planoId }, orderBy: { codigo: 'asc' } })
  }

  buscarPorId(id: string) {
    return this.prisma.contaReceita.findUnique({ where: { id } })
  }

  async criar(dados: DadosCriarContaReceita) {
    const plano = await this.prisma.planoContasReceita.findUnique({ where: { id: dados.planoId } })
    if (!plano) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Plano de contas da receita não encontrado.')

    let nivel = 1
    if (dados.parentId) {
      const parent = await this.prisma.contaReceita.findUnique({ where: { id: dados.parentId } })
      if (!parent) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Conta pai não encontrada.')
      if (parent.planoId !== dados.planoId) {
        throw new ErroNegocio('REQUISICAO_INVALIDA', 'Conta pai pertence a outro plano.')
      }
      if (parent.admiteMovimento) {
        throw new ErroNegocio('CONFLITO', 'Não é possível adicionar filho a uma conta que admite movimento.')
      }
      nivel = parent.nivel + 1
      if (nivel > NIVEL_MAX_RECEITA) {
        throw new ErroNegocio('CONFLITO', `Profundidade máxima de ${NIVEL_MAX_RECEITA} níveis excedida.`)
      }
    }

    try {
      return await this.prisma.contaReceita.create({
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

  /** Atualiza codigo/descricao/admiteMovimento. O parent é imutável aqui. */
  async atualizar(id: string, dados: DadosAtualizarContaReceita) {
    const conta = await this.prisma.contaReceita.findUnique({ where: { id } })
    if (!conta) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Conta não encontrada.')

    if (dados.admiteMovimento === true && conta.admiteMovimento === false) {
      const filhos = await this.prisma.contaReceita.count({ where: { parentId: id } })
      if (filhos > 0) {
        throw new ErroNegocio('CONFLITO', 'Conta com filhos não pode admitir movimento.')
      }
    }

    try {
      return await this.prisma.contaReceita.update({ where: { id }, data: dados })
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError) {
        if (e.code === 'P2002') throw new ErroNegocio('CONFLITO', 'Já existe uma conta com esse código neste plano.')
        if (e.code === 'P2025') throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Conta não encontrada.')
      }
      throw e
    }
  }

  async excluir(id: string) {
    const conta = await this.prisma.contaReceita.findUnique({ where: { id } })
    if (!conta) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Conta não encontrada.')

    const filhos = await this.prisma.contaReceita.count({ where: { parentId: id } })
    if (filhos > 0) {
      throw new ErroNegocio('CONFLITO', `Conta com ${filhos} filho(s) não pode ser excluída.`)
    }

    await this.prisma.contaReceita.delete({ where: { id } })
  }
}
