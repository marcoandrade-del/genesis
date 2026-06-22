import { PrismaClient, Prisma } from '@prisma/client'
import { ErroNegocio } from '../errors.js'
import { proximoCodigoDesdobramento } from './codigo-conta.js'

export type DadosDesdobrar = { codigo: string; descricao: string }

/**
 * Árvore de despesa COPIADA para a entidade. No nível da entidade tudo é
 * cláusula pétrea: não se edita nem exclui — a única ação é **desdobrar** uma
 * conta analítica (folha), que então vira sintética e ganha um filho analítico
 * (origem DESDOBRAMENTO). Exclusão/edição só no modelo do estado.
 */
export class ContasDespesaEntidadeService {
  constructor(private prisma: PrismaClient) {}

  listarRaizes(entidadeId: string, ano: number) {
    return this.prisma.contaDespesaEntidade.findMany({
      where: { entidadeId, ano, parentId: null },
      orderBy: { codigo: 'asc' },
    })
  }

  listarFilhos(parentId: string) {
    return this.prisma.contaDespesaEntidade.findMany({ where: { parentId }, orderBy: { codigo: 'asc' } })
  }

  buscarPorId(id: string) {
    return this.prisma.contaDespesaEntidade.findUnique({ where: { id } })
  }

  /** Sugestão de código para um novo filho: pai + sufixo sequencial de 2 dígitos. */
  async sugerirCodigo(parentId: string): Promise<string> {
    const pai = await this.prisma.contaDespesaEntidade.findUnique({ where: { id: parentId } })
    if (!pai) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Conta não encontrada.')
    const filhos = await this.prisma.contaDespesaEntidade.findMany({ where: { parentId }, select: { codigo: true } })
    return proximoCodigoDesdobramento(pai.codigo, filhos.map((f) => f.codigo))
  }

  /**
   * Desdobra uma conta analítica: cria um filho analítico (DESDOBRAMENTO) e
   * torna o pai sintético — tudo na mesma transação.
   */
  async desdobrar(contaId: string, dados: DadosDesdobrar) {
    const pai = await this.prisma.contaDespesaEntidade.findUnique({ where: { id: contaId } })
    if (!pai) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Conta não encontrada.')
    if (!pai.admiteMovimento) {
      const desdobramentos = await this.prisma.contaDespesaEntidade.count({
        where: { parentId: pai.id, origem: 'DESDOBRAMENTO' },
      })
      if (desdobramentos === 0) {
        throw new ErroNegocio('CONFLITO', 'Conta sintética do modelo não pode receber desdobramento direto — desdobre uma conta analítica.')
      }
    }
    const codigo = dados.codigo.trim()
    if (!codigo) throw new ErroNegocio('REQUISICAO_INVALIDA', 'O código é obrigatório.')
    if (!dados.descricao.trim()) throw new ErroNegocio('REQUISICAO_INVALIDA', 'A descrição é obrigatória.')

    try {
      return await this.prisma.$transaction(async (tx) => {
        // Dotação já executada não pode ser realocada por aqui: a movimentação da
        // despesa (reserva/empenho→liquidação→pagamento) é imutável e só se corrige
        // por estorno. Estorne a execução antes de desdobrar (Specs 22-06-2026, item 8).
        const executadas = await tx.dotacaoDespesa.count({
          where: {
            contaDespesaEntidadeId: pai.id,
            OR: [{ reservas: { some: {} } }, { empenhos: { some: {} } }],
          },
        })
        if (executadas > 0) {
          throw new ErroNegocio('CONFLITO', 'Esta conta de despesa já possui dotação com reserva ou empenho — estorne a execução antes de desdobrar.')
        }

        const filho = await tx.contaDespesaEntidade.create({
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
        // Reaponta as dotações orçamentárias da mãe para a filha analítica. Sem execução
        // (garantido acima), é só reclassificação — nenhuma reserva/empenho a mover.
        await tx.dotacaoDespesa.updateMany({
          where: { contaDespesaEntidadeId: pai.id },
          data: { contaDespesaEntidadeId: filho.id },
        })
        if (pai.admiteMovimento) {
          await tx.contaDespesaEntidade.update({ where: { id: pai.id }, data: { admiteMovimento: false } })
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
    const conta = await this.prisma.contaDespesaEntidade.findUnique({ where: { id } })
    if (!conta) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Conta não encontrada.')
    if (conta.origem !== 'DESDOBRAMENTO') {
      throw new ErroNegocio('CONFLITO', 'Só desdobramentos podem ser editados. Contas do modelo padrão são imutáveis.')
    }
    const nova = descricao.trim()
    if (!nova) throw new ErroNegocio('REQUISICAO_INVALIDA', 'A descrição é obrigatória.')
    return this.prisma.contaDespesaEntidade.update({ where: { id }, data: { descricao: nova } })
  }

  /** Exclui um DESDOBRAMENTO (cópias do modelo não se excluem aqui). Ao remover o
   *  último filho, o pai volta a ser analítica. */
  async excluir(id: string) {
    const conta = await this.prisma.contaDespesaEntidade.findUnique({ where: { id } })
    if (!conta) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Conta não encontrada.')
    if (conta.origem !== 'DESDOBRAMENTO') {
      throw new ErroNegocio('CONFLITO', 'Só desdobramentos podem ser excluídos. Contas do modelo são geridas no plano-modelo.')
    }
    const filhos = await this.prisma.contaDespesaEntidade.count({ where: { parentId: id } })
    if (filhos > 0) throw new ErroNegocio('CONFLITO', `Conta com ${filhos} filho(s) não pode ser excluída.`)
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.contaDespesaEntidade.delete({ where: { id } })
        if (conta.parentId) {
          const irmaos = await tx.contaDespesaEntidade.count({ where: { parentId: conta.parentId } })
          if (irmaos === 0) await tx.contaDespesaEntidade.update({ where: { id: conta.parentId }, data: { admiteMovimento: true } })
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
