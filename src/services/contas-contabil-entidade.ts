import { PrismaClient, Prisma } from '@prisma/client'
import { ErroNegocio } from '../errors.js'
import { proximoCodigoDesdobramento } from './codigo-conta.js'

export type DadosDesdobrar = { codigo: string; descricao: string }

/**
 * Árvore contábil (patrimonial) COPIADA para a entidade. Cláusula pétrea: não
 * se edita nem exclui — a única ação é desdobrar conta analítica (vira
 * sintética, filho nasce analítico, origem DESDOBRAMENTO).
 */
export class ContasContabilEntidadeService {
  constructor(private prisma: PrismaClient) {}

  listarRaizes(entidadeId: string, ano: number) {
    return this.prisma.contaContabilEntidade.findMany({
      where: { entidadeId, ano, parentId: null },
      orderBy: { codigo: 'asc' },
    })
  }

  listarFilhos(parentId: string) {
    return this.prisma.contaContabilEntidade.findMany({ where: { parentId }, orderBy: { codigo: 'asc' } })
  }

  buscarPorId(id: string) {
    return this.prisma.contaContabilEntidade.findUnique({ where: { id } })
  }

  async sugerirCodigo(parentId: string): Promise<string> {
    const pai = await this.prisma.contaContabilEntidade.findUnique({ where: { id: parentId } })
    if (!pai) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Conta não encontrada.')
    const filhos = await this.prisma.contaContabilEntidade.findMany({ where: { parentId }, select: { codigo: true } })
    return proximoCodigoDesdobramento(pai.codigo, filhos.map((f) => f.codigo))
  }

  /**
   * Adiciona um filho-desdobramento a uma conta. Permitido quando a conta é
   * ANALÍTICA (1º filho — ela vira sintética) OU quando ela já é um
   * DESDOBRAMENTO-PAI (adiciona mais um irmão). Não se desdobra direto uma
   * sintética do modelo. Assim dá pra desdobrar uma conta em vários filhos.
   */
  async desdobrar(contaId: string, dados: DadosDesdobrar) {
    const pai = await this.prisma.contaContabilEntidade.findUnique({ where: { id: contaId } })
    if (!pai) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Conta não encontrada.')
    if (!pai.admiteMovimento) {
      const desdobramentos = await this.prisma.contaContabilEntidade.count({
        where: { parentId: pai.id, origem: 'DESDOBRAMENTO' },
      })
      if (desdobramentos === 0) {
        throw new ErroNegocio('CONFLITO', 'Conta sintética do modelo não pode receber desdobramento direto — desdobre uma conta analítica.')
      }
    } else {
      // Analítica (1º desdobramento): se já tem saldo/movimento, o desdobramento
      // simples deixaria os valores presos na sintética. Exige o fluxo que
      // redistribui (épico #85) para não perder a trilha desde o início do ano.
      const [movs, si] = await Promise.all([
        this.prisma.lancamentoItem.count({ where: { contaId: pai.id } }),
        this.prisma.saldoInicialAno.findUnique({
          where: { entidadeId_contaId_ano: { entidadeId: pai.entidadeId, contaId: pai.id, ano: pai.ano } },
          select: { valor: true },
        }),
      ])
      if (movs > 0 || (si && !si.valor.isZero())) {
        throw new ErroNegocio(
          'CONFLITO',
          'Esta conta já tem saldo inicial ou movimento — use "Desdobrar com distribuição" para redistribuir os valores aos filhos.',
        )
      }
    }
    const codigo = dados.codigo.trim()
    if (!codigo) throw new ErroNegocio('REQUISICAO_INVALIDA', 'O código é obrigatório.')
    if (!dados.descricao.trim()) throw new ErroNegocio('REQUISICAO_INVALIDA', 'A descrição é obrigatória.')

    try {
      return await this.prisma.$transaction(async (tx) => {
        const filho = await tx.contaContabilEntidade.create({
          data: {
            entidadeId: pai.entidadeId,
            ano: pai.ano,
            codigo,
            descricao: dados.descricao.trim(),
            nivel: pai.nivel + 1,
            admiteMovimento: true,
            origem: 'DESDOBRAMENTO',
            parentId: pai.id,
          },
        })
        // Só vira sintética na 1ª vez (analítica). Desdobramento-pai já é sintética.
        if (pai.admiteMovimento) {
          await tx.contaContabilEntidade.update({ where: { id: pai.id }, data: { admiteMovimento: false } })
        }
        return filho
      })
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ErroNegocio('CONFLITO', `Já existe uma conta com o código "${codigo}" nesta entidade/exercício.`)
      }
      throw e
    }
  }

  /** Edita a descrição de um DESDOBRAMENTO (contas do modelo são imutáveis). */
  async editarDescricao(id: string, descricao: string) {
    const conta = await this.prisma.contaContabilEntidade.findUnique({ where: { id } })
    if (!conta) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Conta não encontrada.')
    if (conta.origem !== 'DESDOBRAMENTO') {
      throw new ErroNegocio('CONFLITO', 'Só desdobramentos podem ser editados. Contas do modelo padrão são imutáveis.')
    }
    const nova = descricao.trim()
    if (!nova) throw new ErroNegocio('REQUISICAO_INVALIDA', 'A descrição é obrigatória.')
    return this.prisma.contaContabilEntidade.update({ where: { id }, data: { descricao: nova } })
  }

  /**
   * Exclui um DESDOBRAMENTO da entidade (cópias do modelo não se excluem aqui —
   * são geridas no plano-modelo). Bloqueia se tem filhos ou movimentação. Ao
   * remover o último filho, o pai volta a ser analítica.
   */
  async excluir(id: string) {
    const conta = await this.prisma.contaContabilEntidade.findUnique({ where: { id } })
    if (!conta) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Conta não encontrada.')
    if (conta.origem !== 'DESDOBRAMENTO') {
      throw new ErroNegocio('CONFLITO', 'Só desdobramentos podem ser excluídos. Contas do modelo são geridas no plano-modelo.')
    }
    const filhos = await this.prisma.contaContabilEntidade.count({ where: { parentId: id } })
    if (filhos > 0) throw new ErroNegocio('CONFLITO', `Conta com ${filhos} filho(s) não pode ser excluída.`)

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.contaContabilEntidade.delete({ where: { id } })
        if (conta.parentId) {
          const irmaos = await tx.contaContabilEntidade.count({ where: { parentId: conta.parentId } })
          if (irmaos === 0) await tx.contaContabilEntidade.update({ where: { id: conta.parentId }, data: { admiteMovimento: true } })
        }
      })
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2003') {
        throw new ErroNegocio('CONFLITO', 'Conta com movimentação não pode ser excluída.')
      }
      throw e
    }
    return conta
  }
}
