import { PrismaClient, Prisma } from '@prisma/client'
import { ErroNegocio } from '../errors.js'

// Natureza da despesa do MCASP: c.g.mm.ee.dd (6 segmentos no modelo). Teto
// generoso para acomodar desdobramentos posteriores na árvore.
export const NIVEL_MAX_DESPESA = 10

export type DadosCriarContaDespesa = {
  planoId: string
  codigo: string
  descricao: string
  parentId?: string | null
  admiteMovimento?: boolean
}

export type DadosAtualizarContaDespesa = {
  codigo?: string
  descricao?: string
  admiteMovimento?: boolean
}

/**
 * Conta da árvore do Plano de Contas da Despesa. Espelha ContasReceitaService.
 *
 * Invariantes:
 *  1. nível 1..NIVEL_MAX_DESPESA, derivado do parent.
 *  2. admiteMovimento=true (analítica) ⟹ conta é folha (sem filhos).
 *  3. Proibido filho em conta que admite movimento; proibido marcar
 *     admiteMovimento em conta com filhos.
 *  4. Exclusão proibida quando há filhos.
 *  5. Código único por plano (FK do DB via @@unique).
 */
export class ContasDespesaService {
  constructor(private prisma: PrismaClient) {}

  async listar(planoId: string) {
    return this.prisma.contaDespesa.findMany({ where: { planoId }, orderBy: { codigo: 'asc' } })
  }

  buscarPorId(id: string) {
    return this.prisma.contaDespesa.findUnique({ where: { id } })
  }

  async criar(dados: DadosCriarContaDespesa) {
    const plano = await this.prisma.planoContasDespesa.findUnique({ where: { id: dados.planoId } })
    if (!plano) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Plano de contas da despesa não encontrado.')

    let nivel = 1
    if (dados.parentId) {
      const parent = await this.prisma.contaDespesa.findUnique({ where: { id: dados.parentId } })
      if (!parent) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Conta pai não encontrada.')
      if (parent.planoId !== dados.planoId) {
        throw new ErroNegocio('REQUISICAO_INVALIDA', 'Conta pai pertence a outro plano.')
      }
      if (parent.admiteMovimento) {
        throw new ErroNegocio('CONFLITO', 'Não é possível adicionar filho a uma conta que admite movimento.')
      }
      nivel = parent.nivel + 1
      if (nivel > NIVEL_MAX_DESPESA) {
        throw new ErroNegocio('CONFLITO', `Profundidade máxima de ${NIVEL_MAX_DESPESA} níveis excedida.`)
      }
    }

    try {
      return await this.prisma.contaDespesa.create({
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
  async atualizar(id: string, dados: DadosAtualizarContaDespesa) {
    const conta = await this.prisma.contaDespesa.findUnique({ where: { id } })
    if (!conta) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Conta não encontrada.')

    if (dados.admiteMovimento === true && conta.admiteMovimento === false) {
      const filhos = await this.prisma.contaDespesa.count({ where: { parentId: id } })
      if (filhos > 0) {
        throw new ErroNegocio('CONFLITO', 'Conta com filhos não pode admitir movimento.')
      }
    }

    try {
      return await this.prisma.contaDespesa.update({ where: { id }, data: dados })
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError) {
        if (e.code === 'P2002') throw new ErroNegocio('CONFLITO', 'Já existe uma conta com esse código neste plano.')
        if (e.code === 'P2025') throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Conta não encontrada.')
      }
      throw e
    }
  }

  async excluir(id: string) {
    const conta = await this.prisma.contaDespesa.findUnique({ where: { id } })
    if (!conta) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Conta não encontrada.')

    const filhos = await this.prisma.contaDespesa.count({ where: { parentId: id } })
    if (filhos > 0) {
      throw new ErroNegocio('CONFLITO', `Conta com ${filhos} filho(s) não pode ser excluída.`)
    }

    await this.prisma.contaDespesa.delete({ where: { id } })
  }
}
