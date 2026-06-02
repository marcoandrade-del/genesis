import { PrismaClient, Prisma, type TipoItemCatalogo } from '@prisma/client'
import { ErroNegocio } from '../errors.js'

export type DadosItemCatalogo = {
  tipo: TipoItemCatalogo
  codigo: string
  descricao: string
  unidadeMedida: string
  ativo?: boolean
}

const TIPOS: ReadonlyArray<TipoItemCatalogo> = ['MATERIAL', 'SERVICO']

/**
 * Catálogo central de itens (CATMAT/CATSER). Cadastro global e reutilizado por
 * todas as entidades — itens de PCA, DOD e TR referenciam o catálogo para
 * padronizar descrições e unidades. Código único por tipo.
 */
export class ItensCatalogoService {
  constructor(private prisma: PrismaClient) {}

  listar(filtro: { tipo?: TipoItemCatalogo; apenasAtivos?: boolean } = {}) {
    return this.prisma.itemCatalogo.findMany({
      where: {
        ...(filtro.tipo ? { tipo: filtro.tipo } : {}),
        ...(filtro.apenasAtivos ? { ativo: true } : {}),
      },
      orderBy: [{ tipo: 'asc' }, { codigo: 'asc' }],
    })
  }

  buscarPorId(id: string) {
    return this.prisma.itemCatalogo.findUnique({ where: { id } })
  }

  async criar(dados: DadosItemCatalogo) {
    const limpos = this.validar(dados)
    try {
      return await this.prisma.itemCatalogo.create({ data: limpos })
    } catch (e) {
      throw this.traduzirConflito(e, limpos.tipo, limpos.codigo)
    }
  }

  async atualizar(id: string, dados: DadosItemCatalogo) {
    const existente = await this.prisma.itemCatalogo.findUnique({ where: { id } })
    if (!existente) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Item de catálogo não encontrado.')
    const limpos = this.validar(dados)
    try {
      return await this.prisma.itemCatalogo.update({ where: { id }, data: limpos })
    } catch (e) {
      throw this.traduzirConflito(e, limpos.tipo, limpos.codigo)
    }
  }

  async excluir(id: string) {
    const existente = await this.prisma.itemCatalogo.findUnique({ where: { id } })
    if (!existente) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Item de catálogo não encontrado.')
    try {
      await this.prisma.itemCatalogo.delete({ where: { id } })
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2003') {
        throw new ErroNegocio(
          'CONFLITO',
          'Item em uso por PCA, demanda ou termo de referência — não pode ser excluído.',
        )
      }
      throw e
    }
  }

  private validar(dados: DadosItemCatalogo): DadosItemCatalogo {
    if (!TIPOS.includes(dados.tipo)) {
      throw new ErroNegocio('REQUISICAO_INVALIDA', 'Tipo deve ser MATERIAL ou SERVICO.')
    }
    const codigo = dados.codigo?.trim()
    const descricao = dados.descricao?.trim()
    const unidadeMedida = dados.unidadeMedida?.trim()
    if (!codigo) throw new ErroNegocio('REQUISICAO_INVALIDA', 'Código é obrigatório.')
    if (!descricao) throw new ErroNegocio('REQUISICAO_INVALIDA', 'Descrição é obrigatória.')
    if (!unidadeMedida) throw new ErroNegocio('REQUISICAO_INVALIDA', 'Unidade de medida é obrigatória.')
    return { tipo: dados.tipo, codigo, descricao, unidadeMedida, ativo: dados.ativo ?? true }
  }

  private traduzirConflito(e: unknown, tipo: TipoItemCatalogo, codigo: string) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return new ErroNegocio('CONFLITO', `Já existe um item ${tipo} com o código "${codigo}".`)
    }
    return e
  }
}
