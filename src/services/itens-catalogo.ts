import { PrismaClient, Prisma, type TipoItemCatalogo } from '@prisma/client'
import { ErroNegocio } from '../errors.js'

export type DadosItemCatalogo = {
  tipo: TipoItemCatalogo
  codigo: string
  descricao: string
  unidadeMedida: string
  ativo?: boolean
}

export type FiltroCatalogo = { tipo?: TipoItemCatalogo; apenasAtivos?: boolean; busca?: string }

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

  /** Conta itens com os mesmos filtros da listagem (sem carregar linhas). */
  contar(filtro: FiltroCatalogo = {}) {
    return this.prisma.itemCatalogo.count({ where: this.montarWhere(filtro) })
  }

  /**
   * Listagem paginada com busca por código/descrição. Necessária porque o
   * catálogo (CATMAT/CATSER) tem centenas de milhares de itens — listar tudo
   * de uma vez é impraticável.
   */
  async listarPaginado(opts: FiltroCatalogo & { pagina?: number; porPagina?: number }) {
    const porPagina = Math.min(Math.max(opts.porPagina ?? 50, 1), 200)
    const pagina = Math.max(opts.pagina ?? 1, 1)
    const where = this.montarWhere(opts)
    const [total, itens] = await Promise.all([
      this.prisma.itemCatalogo.count({ where }),
      this.prisma.itemCatalogo.findMany({
        where,
        orderBy: [{ tipo: 'asc' }, { codigo: 'asc' }],
        skip: (pagina - 1) * porPagina,
        take: porPagina,
      }),
    ])
    return { itens, total, pagina, porPagina, totalPaginas: Math.max(Math.ceil(total / porPagina), 1) }
  }

  private montarWhere(filtro: FiltroCatalogo): Prisma.ItemCatalogoWhereInput {
    const busca = filtro.busca?.trim()
    return {
      ...(filtro.tipo ? { tipo: filtro.tipo } : {}),
      ...(filtro.apenasAtivos ? { ativo: true } : {}),
      ...(busca
        ? { OR: [{ codigo: { contains: busca } }, { descricao: { contains: busca, mode: 'insensitive' } }] }
        : {}),
    }
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
