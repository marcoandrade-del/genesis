import { PrismaClient, Prisma, type ModalidadeLicitacao, type CriterioJulgamento } from '@prisma/client'
import { ErroNegocio } from '../errors.js'
import { validarAno, trimOuNull, parseDecimalPositivo, parseDecimalNaoNegativo, garantirCatalogoExiste } from './planos-contratacao.js'

export type DadosItemProcesso = {
  itemCatalogoId: string
  quantidade: string | number
  precoEstimadoUnitario: string | number
}

export type DadosLote = {
  numero: string
  descricao?: string | null
  itens: DadosItemProcesso[]
}

export type DadosProcesso = {
  ano: number
  numero: string
  modalidade: ModalidadeLicitacao
  criterioJulgamento: CriterioJulgamento
  objeto: string
  termoReferenciaId?: string | null
  dataAbertura?: Date | string | null
  observacoes?: string | null
  lotes: DadosLote[]
}

const MODALIDADES: ReadonlyArray<ModalidadeLicitacao> = ['PREGAO', 'CONCORRENCIA', 'DISPENSA', 'INEXIGIBILIDADE']
const CRITERIOS: ReadonlyArray<CriterioJulgamento> = ['POR_ITEM', 'POR_LOTE']

/**
 * Processo Licitatório (Edital/Certame). Estrutura Processo → Lote → ItemProcesso.
 * Julgamento por item (vencedor em cada item) ou por lote (vencedor do lote).
 * REGRA 3 (Teto de Preço): precoAdjudicadoUnitario ≤ precoEstimadoUnitario.
 * Conteúdo (lotes/itens) só editável enquanto ABERTO.
 */
export class ProcessosService {
  constructor(private prisma: PrismaClient) {}

  listar(entidadeId: string) {
    return this.prisma.processo.findMany({
      where: { entidadeId },
      orderBy: [{ ano: 'desc' }, { numero: 'desc' }],
      include: { _count: { select: { lotes: true, contratos: true, atas: true } } },
    })
  }

  buscarPorId(id: string) {
    return this.prisma.processo.findUnique({
      where: { id },
      include: {
        entidade: true,
        termoReferencia: { select: { id: true, objeto: true } },
        lotes: {
          orderBy: { numero: 'asc' },
          include: {
            fornecedorVencedor: { select: { id: true, razaoSocial: true } },
            itens: {
              orderBy: { criadoEm: 'asc' },
              include: {
                itemCatalogo: true,
                fornecedorVencedor: { select: { id: true, razaoSocial: true } },
              },
            },
          },
        },
      },
    })
  }

  async criar(entidadeId: string, dados: DadosProcesso) {
    const cab = await this.validarCabecalho(entidadeId, dados)
    const lotes = await this.validarLotes(dados.lotes)

    try {
      return await this.prisma.$transaction(async (tx) => {
        const processo = await tx.processo.create({ data: { entidadeId, ...cab } })
        for (const lote of lotes) {
          const novo = await tx.lote.create({
            data: { processoId: processo.id, numero: lote.numero, descricao: lote.descricao },
          })
          if (lote.itens.length > 0) {
            await tx.itemProcesso.createMany({ data: lote.itens.map((i) => ({ loteId: novo.id, ...i })) })
          }
        }
        return processo
      })
    } catch (e) {
      throw traduzirNumeroDuplicado(e, dados.numero, dados.ano)
    }
  }

  async atualizar(id: string, dados: DadosProcesso) {
    const processo = await this.carregarEditavel(id)
    const cab = await this.validarCabecalho(processo.entidadeId, dados)
    const lotes = await this.validarLotes(dados.lotes)

    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.lote.deleteMany({ where: { processoId: id } }) // casc. remove itens
        const atualizado = await tx.processo.update({ where: { id }, data: cab })
        for (const lote of lotes) {
          const novo = await tx.lote.create({ data: { processoId: id, numero: lote.numero, descricao: lote.descricao } })
          if (lote.itens.length > 0) {
            await tx.itemProcesso.createMany({ data: lote.itens.map((i) => ({ loteId: novo.id, ...i })) })
          }
        }
        return atualizado
      })
    } catch (e) {
      throw traduzirNumeroDuplicado(e, dados.numero, dados.ano)
    }
  }

  /** Julgamento POR_ITEM: define vencedor + preço adjudicado de um item (REGRA 3). */
  async adjudicarItem(itemProcessoId: string, fornecedorVencedorId: string, precoAdjudicado: string | number) {
    const item = await this.prisma.itemProcesso.findUnique({
      where: { id: itemProcessoId },
      include: { lote: { include: { processo: { select: { status: true, criterioJulgamento: true } } } } },
    })
    if (!item) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Item do processo não encontrado.')
    if (item.lote.processo.status !== 'ABERTO') {
      throw new ErroNegocio('CONFLITO', 'Só é possível julgar processo ABERTO.')
    }
    if (item.lote.processo.criterioJulgamento !== 'POR_ITEM') {
      throw new ErroNegocio('CONFLITO', 'Este processo é julgado por lote.')
    }
    const preco = await this.validarAdjudicacao(fornecedorVencedorId, precoAdjudicado, item.precoEstimadoUnitario)
    return this.prisma.itemProcesso.update({
      where: { id: itemProcessoId },
      data: { fornecedorVencedorId, precoAdjudicadoUnitario: preco },
    })
  }

  /** Julgamento POR_LOTE: define o vencedor do lote e o preço de cada item (REGRA 3). */
  async adjudicarLote(
    loteId: string,
    fornecedorVencedorId: string,
    itens: Array<{ itemProcessoId: string; precoAdjudicadoUnitario: string | number }>,
  ) {
    const lote = await this.prisma.lote.findUnique({
      where: { id: loteId },
      include: { processo: { select: { status: true, criterioJulgamento: true } }, itens: true },
    })
    if (!lote) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Lote não encontrado.')
    if (lote.processo.status !== 'ABERTO') throw new ErroNegocio('CONFLITO', 'Só é possível julgar processo ABERTO.')
    if (lote.processo.criterioJulgamento !== 'POR_LOTE') throw new ErroNegocio('CONFLITO', 'Este processo é julgado por item.')

    const fornecedor = await this.prisma.fornecedor.findUnique({ where: { id: fornecedorVencedorId } })
    if (!fornecedor || !fornecedor.ativo) throw new ErroNegocio('REQUISICAO_INVALIDA', 'Fornecedor inválido ou inativo.')

    const precosPorItem = new Map<string, Prisma.Decimal>()
    for (const adj of itens) {
      const item = lote.itens.find((i) => i.id === adj.itemProcessoId)
      if (!item) throw new ErroNegocio('REQUISICAO_INVALIDA', 'Item informado não pertence ao lote.')
      precosPorItem.set(item.id, this.checarTeto(adj.precoAdjudicadoUnitario, item.precoEstimadoUnitario))
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.lote.update({ where: { id: loteId }, data: { fornecedorVencedorId } })
      for (const [itemId, preco] of precosPorItem) {
        await tx.itemProcesso.update({
          where: { id: itemId },
          data: { fornecedorVencedorId, precoAdjudicadoUnitario: preco },
        })
      }
      return tx.lote.findUnique({ where: { id: loteId } })
    })
  }

  async homologar(id: string) {
    const processo = await this.prisma.processo.findUnique({ where: { id } })
    if (!processo) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Processo não encontrado.')
    if (processo.status !== 'ABERTO') throw new ErroNegocio('CONFLITO', 'Apenas processo ABERTO pode ser homologado.')
    return this.prisma.processo.update({ where: { id }, data: { status: 'HOMOLOGADO', dataHomologacao: new Date() } })
  }

  async cancelar(id: string) {
    const processo = await this.prisma.processo.findUnique({ where: { id } })
    if (!processo) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Processo não encontrado.')
    if (processo.status === 'HOMOLOGADO') throw new ErroNegocio('CONFLITO', 'Processo homologado não pode ser cancelado.')
    return this.prisma.processo.update({ where: { id }, data: { status: 'CANCELADO' } })
  }

  async excluir(id: string) {
    const processo = await this.prisma.processo.findUnique({
      where: { id },
      include: { _count: { select: { contratos: true, atas: true } } },
    })
    if (!processo) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Processo não encontrado.')
    if (processo.status === 'HOMOLOGADO') throw new ErroNegocio('CONFLITO', 'Processo homologado não pode ser excluído.')
    if (processo._count.contratos > 0 || processo._count.atas > 0) {
      throw new ErroNegocio('CONFLITO', 'Processo possui contratos/atas vinculados.')
    }
    await this.prisma.processo.delete({ where: { id } })
  }

  // ── privados ────────────────────────────────────────────────────────────────

  private async carregarEditavel(id: string) {
    const processo = await this.prisma.processo.findUnique({ where: { id } })
    if (!processo) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Processo não encontrado.')
    if (processo.status !== 'ABERTO') {
      throw new ErroNegocio('CONFLITO', 'Processo só pode ser editado enquanto ABERTO.')
    }
    return processo
  }

  private async validarCabecalho(entidadeId: string, dados: DadosProcesso) {
    validarAno(dados.ano)
    const numero = dados.numero?.trim()
    const objeto = dados.objeto?.trim()
    if (!numero) throw new ErroNegocio('REQUISICAO_INVALIDA', 'Número é obrigatório.')
    if (!objeto) throw new ErroNegocio('REQUISICAO_INVALIDA', 'Objeto é obrigatório.')
    if (!MODALIDADES.includes(dados.modalidade)) throw new ErroNegocio('REQUISICAO_INVALIDA', 'Modalidade inválida.')
    if (!CRITERIOS.includes(dados.criterioJulgamento)) throw new ErroNegocio('REQUISICAO_INVALIDA', 'Critério de julgamento inválido.')

    const termoReferenciaId = trimOuNull(dados.termoReferenciaId)
    if (termoReferenciaId) {
      const tr = await this.prisma.termoReferencia.findUnique({
        where: { id: termoReferenciaId },
        include: { documentoDemanda: { select: { entidadeId: true } } },
      })
      if (!tr || tr.documentoDemanda.entidadeId !== entidadeId) {
        throw new ErroNegocio('REQUISICAO_INVALIDA', 'Termo de Referência inválido para esta entidade.')
      }
    }
    return {
      ano: dados.ano,
      numero,
      modalidade: dados.modalidade,
      criterioJulgamento: dados.criterioJulgamento,
      objeto,
      termoReferenciaId,
      dataAbertura: parseData(dados.dataAbertura),
      observacoes: trimOuNull(dados.observacoes),
    }
  }

  private async validarLotes(lotes: DadosLote[]) {
    if (!Array.isArray(lotes) || lotes.length === 0) {
      throw new ErroNegocio('REQUISICAO_INVALIDA', 'Inclua ao menos um lote.')
    }
    const numerosLote = new Set<string>()
    const todosCatalogo: string[] = []
    const normalizados = lotes.map((lote) => {
      const numero = lote.numero?.trim()
      if (!numero) throw new ErroNegocio('REQUISICAO_INVALIDA', 'Número do lote é obrigatório.')
      if (numerosLote.has(numero)) throw new ErroNegocio('REQUISICAO_INVALIDA', `Lote "${numero}" repetido.`)
      numerosLote.add(numero)
      if (!Array.isArray(lote.itens) || lote.itens.length === 0) {
        throw new ErroNegocio('REQUISICAO_INVALIDA', `Lote "${numero}" precisa de ao menos um item.`)
      }
      const idsLote = new Set<string>()
      const itens = lote.itens.map((i) => {
        if (!i.itemCatalogoId?.trim()) throw new ErroNegocio('REQUISICAO_INVALIDA', 'Item do catálogo é obrigatório.')
        if (idsLote.has(i.itemCatalogoId)) throw new ErroNegocio('REQUISICAO_INVALIDA', 'Item do catálogo repetido no lote.')
        idsLote.add(i.itemCatalogoId)
        todosCatalogo.push(i.itemCatalogoId)
        return {
          itemCatalogoId: i.itemCatalogoId,
          quantidade: parseDecimalPositivo(i.quantidade, 'Quantidade'),
          precoEstimadoUnitario: parseDecimalNaoNegativo(i.precoEstimadoUnitario, 'Preço estimado unitário'),
        }
      })
      return { numero, descricao: trimOuNull(lote.descricao), itens }
    })
    // garantirCatalogoExiste rejeita duplicados globais; aqui os ids podem repetir
    // entre lotes diferentes, então valida só a existência (Set interno deduplica).
    await garantirCatalogoExiste(this.prisma, [...new Set(todosCatalogo)])
    return normalizados
  }

  private async validarAdjudicacao(fornecedorId: string, preco: string | number, precoEstimado: Prisma.Decimal) {
    const fornecedor = await this.prisma.fornecedor.findUnique({ where: { id: fornecedorId } })
    if (!fornecedor || !fornecedor.ativo) throw new ErroNegocio('REQUISICAO_INVALIDA', 'Fornecedor inválido ou inativo.')
    return this.checarTeto(preco, precoEstimado)
  }

  /** REGRA 3 — Teto de Preço: adjudicado ≤ estimado. */
  private checarTeto(preco: string | number, precoEstimado: Prisma.Decimal): Prisma.Decimal {
    const adjudicado = parseDecimalNaoNegativo(preco, 'Preço adjudicado unitário')
    if (adjudicado.greaterThan(precoEstimado)) {
      throw new ErroNegocio(
        'ENTIDADE_NAO_PROCESSAVEL',
        `Preço adjudicado (R$ ${adjudicado.toFixed(2)}) excede o estimado (R$ ${new Prisma.Decimal(precoEstimado).toFixed(2)}).`,
      )
    }
    return adjudicado
  }
}

function parseData(v: Date | string | null | undefined): Date | null {
  if (v === null || v === undefined || v === '') return null
  const d = v instanceof Date ? v : new Date(v)
  if (Number.isNaN(d.getTime())) throw new ErroNegocio('REQUISICAO_INVALIDA', `Data inválida: "${v}".`)
  return d
}

function traduzirNumeroDuplicado(e: unknown, numero: string, ano: number) {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
    return new ErroNegocio('CONFLITO', `Já existe um processo nº "${numero}" no exercício ${ano}.`)
  }
  return e
}
