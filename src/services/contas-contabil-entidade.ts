import { PrismaClient, Prisma } from '@prisma/client'
import { ErroNegocio } from '../errors.js'

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
    const filhos = await this.prisma.contaContabilEntidade.count({ where: { parentId } })
    return `${pai.codigo}.${String(filhos + 1).padStart(2, '0')}`
  }

  async desdobrar(contaId: string, dados: DadosDesdobrar) {
    const pai = await this.prisma.contaContabilEntidade.findUnique({ where: { id: contaId } })
    if (!pai) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Conta não encontrada.')
    if (!pai.admiteMovimento) {
      throw new ErroNegocio('CONFLITO', 'Só contas analíticas (que admitem movimento) podem ser desdobradas.')
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
        await tx.contaContabilEntidade.update({ where: { id: pai.id }, data: { admiteMovimento: false } })
        return filho
      })
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ErroNegocio('CONFLITO', `Já existe uma conta com o código "${codigo}" nesta entidade/exercício.`)
      }
      throw e
    }
  }
}
