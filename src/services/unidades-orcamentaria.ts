import { PrismaClient, Prisma } from '@prisma/client'
import { ErroNegocio } from '../errors.js'

export type DadosUnidadeOrcamentaria = {
  codigo: string
  nome: string
  ativa?: boolean
  orgaoId?: string | null
}

/**
 * Unidade Orçamentária — estrutura orgânica da entidade (secretarias, fundos,
 * autarquias municipais). Cadastrada por entidade; o código é livre (sem
 * formato imposto), mas único por entidade.
 */
export class UnidadesOrcamentariaService {
  constructor(private prisma: PrismaClient) {}

  listar(entidadeId: string) {
    return this.prisma.unidadeOrcamentaria.findMany({
      where: { entidadeId },
      orderBy: { codigo: 'asc' },
    })
  }

  buscarPorId(id: string) {
    return this.prisma.unidadeOrcamentaria.findUnique({ where: { id } })
  }

  async criar(entidadeId: string, dados: DadosUnidadeOrcamentaria) {
    const codigo = dados.codigo.trim()
    const nome = dados.nome.trim()
    if (!codigo) throw new ErroNegocio('REQUISICAO_INVALIDA', 'Código é obrigatório.')
    if (!nome) throw new ErroNegocio('REQUISICAO_INVALIDA', 'Nome é obrigatório.')

    const entidade = await this.prisma.entidade.findUnique({ where: { id: entidadeId } })
    if (!entidade) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Entidade não encontrada.')

    try {
      return await this.prisma.unidadeOrcamentaria.create({
        data: { entidadeId, codigo, nome, ativa: dados.ativa ?? true, orgaoId: dados.orgaoId?.trim() || null },
      })
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ErroNegocio(
          'CONFLITO',
          `Já existe uma unidade orçamentária com o código "${codigo}" nesta entidade.`,
        )
      }
      throw e
    }
  }

  async atualizar(id: string, dados: DadosUnidadeOrcamentaria) {
    const codigo = dados.codigo.trim()
    const nome = dados.nome.trim()
    if (!codigo) throw new ErroNegocio('REQUISICAO_INVALIDA', 'Código é obrigatório.')
    if (!nome) throw new ErroNegocio('REQUISICAO_INVALIDA', 'Nome é obrigatório.')

    const uo = await this.prisma.unidadeOrcamentaria.findUnique({ where: { id } })
    if (!uo) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Unidade orçamentária não encontrada.')

    try {
      return await this.prisma.unidadeOrcamentaria.update({
        where: { id },
        data: { codigo, nome, ativa: dados.ativa ?? uo.ativa, orgaoId: dados.orgaoId !== undefined ? dados.orgaoId?.trim() || null : uo.orgaoId },
      })
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ErroNegocio(
          'CONFLITO',
          `Já existe uma unidade orçamentária com o código "${codigo}" nesta entidade.`,
        )
      }
      throw e
    }
  }

  async excluir(id: string) {
    const uo = await this.prisma.unidadeOrcamentaria.findUnique({ where: { id } })
    if (!uo) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Unidade orçamentária não encontrada.')
    // Quando a UO já estiver referenciada por dotações (PR3), bloquear aqui.
    // Por ora, nada referencia — pode excluir livremente.
    await this.prisma.unidadeOrcamentaria.delete({ where: { id } })
  }
}
