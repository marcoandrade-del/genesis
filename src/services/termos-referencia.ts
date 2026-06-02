import { PrismaClient, Prisma } from '@prisma/client'
import { ErroNegocio } from '../errors.js'
import { trimOuNull, parseDecimalPositivo, parseDecimalNaoNegativo, garantirCatalogoExiste } from './planos-contratacao.js'

export type DadosItemTermo = {
  itemCatalogoId: string
  quantidade: string | number
  precoUnitarioEstimado: string | number
}

export type DadosTermo = {
  objeto: string
  observacoes?: string | null
  itens: DadosItemTermo[]
}

/**
 * TR — Termo de Referência. Detalhamento técnico do DOD + pesquisa de preço de
 * mercado (1:1 com o DOD). Cada item recebe um preço unitário estimado; o Preço
 * Máximo Aceitável do item é quantidade × precoUnitarioEstimado (calculado, não
 * armazenado). Itens substituídos integralmente a cada salvamento.
 */
export class TermosReferenciaService {
  constructor(private prisma: PrismaClient) {}

  buscarPorId(id: string) {
    return this.prisma.termoReferencia.findUnique({
      where: { id },
      include: {
        documentoDemanda: { include: { entidade: true } },
        itens: { include: { itemCatalogo: true }, orderBy: { criadoEm: 'asc' } },
      },
    })
  }

  buscarPorDemanda(documentoDemandaId: string) {
    return this.prisma.termoReferencia.findUnique({
      where: { documentoDemandaId },
      include: { itens: { include: { itemCatalogo: true }, orderBy: { criadoEm: 'asc' } } },
    })
  }

  async criar(documentoDemandaId: string, dados: DadosTermo) {
    const dod = await this.prisma.documentoDemanda.findUnique({ where: { id: documentoDemandaId } })
    if (!dod) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Demanda não encontrada.')
    const objeto = this.validarObjeto(dados)
    const itens = await this.validarItens(dados.itens)

    try {
      return await this.prisma.$transaction(async (tx) => {
        const tr = await tx.termoReferencia.create({
          data: { documentoDemandaId, objeto, observacoes: trimOuNull(dados.observacoes) },
        })
        if (itens.length > 0) {
          await tx.itemTermoReferencia.createMany({ data: itens.map((i) => ({ termoReferenciaId: tr.id, ...i })) })
        }
        return tr
      })
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ErroNegocio('CONFLITO', 'Esta demanda já possui um Termo de Referência.')
      }
      throw e
    }
  }

  async atualizar(id: string, dados: DadosTermo) {
    const existente = await this.prisma.termoReferencia.findUnique({ where: { id } })
    if (!existente) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Termo de Referência não encontrado.')
    const objeto = this.validarObjeto(dados)
    const itens = await this.validarItens(dados.itens)

    return this.prisma.$transaction(async (tx) => {
      await tx.itemTermoReferencia.deleteMany({ where: { termoReferenciaId: id } })
      const tr = await tx.termoReferencia.update({
        where: { id },
        data: { objeto, observacoes: trimOuNull(dados.observacoes) },
      })
      if (itens.length > 0) {
        await tx.itemTermoReferencia.createMany({ data: itens.map((i) => ({ termoReferenciaId: id, ...i })) })
      }
      return tr
    })
  }

  async excluir(id: string) {
    const tr = await this.prisma.termoReferencia.findUnique({
      where: { id },
      include: { _count: { select: { reservas: true } } },
    })
    if (!tr) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Termo de Referência não encontrado.')
    if (tr._count.reservas > 0) {
      throw new ErroNegocio('CONFLITO', 'TR possui reservas de dotação vinculadas — não pode ser excluído.')
    }
    // onDelete: Cascade remove os itens automaticamente.
    await this.prisma.termoReferencia.delete({ where: { id } })
  }

  private validarObjeto(dados: DadosTermo) {
    const objeto = dados.objeto?.trim()
    if (!objeto) throw new ErroNegocio('REQUISICAO_INVALIDA', 'Objeto é obrigatório.')
    return objeto
  }

  private async validarItens(itens: DadosItemTermo[]) {
    if (!Array.isArray(itens)) throw new ErroNegocio('REQUISICAO_INVALIDA', 'Itens inválidos.')
    const normalizados = itens.map((i) => ({
      itemCatalogoId: i.itemCatalogoId,
      quantidade: parseDecimalPositivo(i.quantidade, 'Quantidade'),
      precoUnitarioEstimado: parseDecimalNaoNegativo(i.precoUnitarioEstimado, 'Preço unitário estimado'),
    }))
    for (const i of normalizados) {
      if (!i.itemCatalogoId?.trim()) {
        throw new ErroNegocio('REQUISICAO_INVALIDA', 'Item do catálogo é obrigatório.')
      }
    }
    await garantirCatalogoExiste(this.prisma, normalizados.map((i) => i.itemCatalogoId))
    return normalizados
  }
}

/** Preço Máximo Aceitável total do TR: Σ quantidade × precoUnitarioEstimado. */
export function totalTermoReferencia(
  itens: ReadonlyArray<{ quantidade: Prisma.Decimal; precoUnitarioEstimado: Prisma.Decimal }>,
): Prisma.Decimal {
  return itens.reduce(
    (acc, i) => acc.plus(new Prisma.Decimal(i.quantidade).times(i.precoUnitarioEstimado)),
    new Prisma.Decimal(0),
  )
}
