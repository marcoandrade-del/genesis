import { PrismaClient, Prisma } from '@prisma/client'
import { ErroNegocio } from '../errors.js'

export type DadosCriarPlanoReceita = { descricao: string; ano: number; modeloContabilId: string }
export type DadosAtualizarPlanoReceita = { descricao?: string; ano?: number }

/**
 * Plano de Contas da Receita (orçamentário) — um por modelo contábil × ano.
 * Espelha PlanosDeContasService (plano contábil/patrimonial).
 */
export class PlanosContasReceitaService {
  constructor(private prisma: PrismaClient) {}

  async listar(modeloContabilId?: string) {
    return this.prisma.planoContasReceita.findMany({
      where: modeloContabilId ? { modeloContabilId } : undefined,
      orderBy: [{ modeloContabilId: 'asc' }, { ano: 'desc' }],
    })
  }

  buscarPorId(id: string) {
    return this.prisma.planoContasReceita.findUnique({ where: { id } })
  }

  async criar(dados: DadosCriarPlanoReceita) {
    const modelo = await this.prisma.modeloContabil.findUnique({ where: { id: dados.modeloContabilId } })
    if (!modelo) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Modelo contábil não encontrado.')

    try {
      return await this.prisma.planoContasReceita.create({ data: dados })
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ErroNegocio(
          'CONFLITO',
          `Já existe um plano de contas da receita para este modelo no ano ${dados.ano}.`,
        )
      }
      throw e
    }
  }

  /** Atualiza descricao/ano. O modelo é imutável (mover plano entre modelos é destrutivo). */
  async atualizar(id: string, dados: DadosAtualizarPlanoReceita) {
    try {
      return await this.prisma.planoContasReceita.update({ where: { id }, data: dados })
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError) {
        if (e.code === 'P2002') throw new ErroNegocio('CONFLITO', 'Já existe um plano de contas da receita para este modelo neste ano.')
        if (e.code === 'P2025') throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Plano de contas da receita não encontrado.')
      }
      throw e
    }
  }

  /** Excluir só é permitido se o plano não tem contas. */
  async excluir(id: string) {
    const plano = await this.prisma.planoContasReceita.findUnique({ where: { id } })
    if (!plano) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Plano de contas da receita não encontrado.')

    const contas = await this.prisma.contaReceita.count({ where: { planoId: id } })
    if (contas > 0) {
      throw new ErroNegocio('CONFLITO', `Plano com ${contas} conta(s) cadastrada(s) não pode ser excluído.`)
    }

    await this.prisma.planoContasReceita.delete({ where: { id } })
  }
}
