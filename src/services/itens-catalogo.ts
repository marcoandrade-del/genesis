import { PrismaClient, Prisma, type TipoItemCatalogo } from '@prisma/client'
import { ErroNegocio } from '../errors.js'
import { parseCSVLine } from './importador-plano-contas.js'

export type DadosItemCatalogo = {
  tipo: TipoItemCatalogo
  codigo: string
  descricao: string
  unidadeMedida: string
  ativo?: boolean
}

export type FiltroCatalogo = { tipo?: TipoItemCatalogo; apenasAtivos?: boolean; busca?: string }

/** Resultado da importação em massa: recebidos = linhas válidas no arquivo;
 *  criados = inseridos de fato; pulados = códigos que já existiam (skipDuplicates). */
export type ResultadoImportacaoCatalogo = { recebidos: number; criados: number; pulados: number }

const TIPOS: ReadonlyArray<TipoItemCatalogo> = ['MATERIAL', 'SERVICO']
const LOTE_IMPORTACAO = 5000

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

  /**
   * Importa um CSV (cabeçalho `codigo,descricao`) em massa, aplicando `tipo` e
   * `unidadeMedida` a todas as linhas. Idempotente: `skipDuplicates` sobre
   * `@@unique([tipo, codigo])` — códigos já existentes são pulados, não atualizados.
   * Inserção em lotes porque o catálogo (CATMAT/CATSER) tem ~centenas de milhares
   * de itens.
   */
  async importarCsv(
    csv: string,
    opts: { tipo: TipoItemCatalogo; unidadeMedida: string },
  ): Promise<ResultadoImportacaoCatalogo> {
    if (!TIPOS.includes(opts.tipo)) {
      throw new ErroNegocio('REQUISICAO_INVALIDA', 'Tipo deve ser MATERIAL ou SERVICO.')
    }
    const unidadeMedida = opts.unidadeMedida?.trim()
    if (!unidadeMedida) throw new ErroNegocio('REQUISICAO_INVALIDA', 'Unidade de medida é obrigatória.')

    const linhas = this.parseCatalogoCsv(csv)
    if (linhas.length === 0) throw new ErroNegocio('REQUISICAO_INVALIDA', 'CSV não contém linhas de dados.')

    // Dedup dentro do arquivo (1ª ocorrência vence) antes de tocar o banco.
    const porCodigo = new Map<string, string>()
    for (const l of linhas) if (!porCodigo.has(l.codigo)) porCodigo.set(l.codigo, l.descricao)
    const dados = [...porCodigo].map(([codigo, descricao]) => ({ tipo: opts.tipo, codigo, descricao, unidadeMedida }))

    let criados = 0
    for (let i = 0; i < dados.length; i += LOTE_IMPORTACAO) {
      const { count } = await this.prisma.itemCatalogo.createMany({
        data: dados.slice(i, i + LOTE_IMPORTACAO),
        skipDuplicates: true,
      })
      criados += count
    }
    return { recebidos: dados.length, criados, pulados: dados.length - criados }
  }

  /** Tokeniza o CSV de catálogo. Exige cabeçalho com `codigo` e `descricao`. */
  private parseCatalogoCsv(csv: string): { codigo: string; descricao: string }[] {
    const limpo = csv.replace(/^﻿/, '')
    const linhas = limpo.split(/\r?\n/).filter((l) => l.trim() !== '')
    if (linhas.length === 0) throw new ErroNegocio('REQUISICAO_INVALIDA', 'CSV vazio.')
    const header = parseCSVLine(linhas[0]!).map((c) => c.trim())
    const iCod = header.indexOf('codigo')
    const iDesc = header.indexOf('descricao')
    if (iCod < 0 || iDesc < 0) {
      throw new ErroNegocio('REQUISICAO_INVALIDA', 'Cabeçalho deve conter as colunas "codigo" e "descricao".')
    }
    const out: { codigo: string; descricao: string }[] = []
    for (let i = 1; i < linhas.length; i++) {
      const partes = parseCSVLine(linhas[i]!)
      const codigo = (partes[iCod] ?? '').trim()
      const descricao = (partes[iDesc] ?? '').trim()
      if (!codigo) throw new ErroNegocio('REQUISICAO_INVALIDA', `Linha ${i + 1}: código vazio.`)
      if (!descricao) throw new ErroNegocio('REQUISICAO_INVALIDA', `Linha ${i + 1}: descrição vazia.`)
      out.push({ codigo, descricao })
    }
    return out
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
