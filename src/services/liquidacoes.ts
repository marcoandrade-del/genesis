import { PrismaClient, Prisma } from '@prisma/client'
import { ErroNegocio } from '../errors.js'
import { trimOuNull, parseDecimalPositivo } from './planos-contratacao.js'
import { validarLancamento, netLiquidadoDaLiquidacao } from './saldos-empenho.js'

export type DadosLiquidacao = {
  empenhoId: string
  numero: string
  data?: Date | string | null
  valor: string | number
  notaFiscal?: string | null
  atesteResponsavel?: string | null
}

/**
 * Liquidação (2º estágio). Atesta o recebimento do bem/serviço com base na NF.
 *
 * REGRA 5 (Precedência): só existe sobre um Empenho ATIVO.
 * REGRA 4 (Amostragem Finitiva): a soma das liquidações de um empenho não pode
 * exceder o valor empenhado (controle via `valorLiquidado` materializado).
 */
export class LiquidacoesService {
  constructor(private prisma: PrismaClient) {}

  listar(entidadeId: string) {
    return this.prisma.liquidacao.findMany({
      where: { entidadeId },
      orderBy: { data: 'desc' },
      include: {
        empenho: { select: { numero: true, fornecedor: { select: { razaoSocial: true } } } },
        _count: { select: { ordensPagamento: true } },
      },
    })
  }

  buscarPorId(id: string) {
    return this.prisma.liquidacao.findUnique({
      where: { id },
      include: { empenho: { select: { id: true, numero: true, valor: true, valorLiquidado: true } } },
    })
  }

  async criar(entidadeId: string, dados: DadosLiquidacao, usuarioId: string) {
    const numero = dados.numero?.trim()
    if (!numero) throw new ErroNegocio('REQUISICAO_INVALIDA', 'Número da liquidação é obrigatório.')
    const valor = parseDecimalPositivo(dados.valor, 'Valor da liquidação')

    const empenho = await this.prisma.empenho.findUnique({ where: { id: dados.empenhoId } })
    if (!empenho || empenho.entidadeId !== entidadeId) {
      throw new ErroNegocio('REQUISICAO_INVALIDA', 'Empenho inválido para esta entidade.')
    }
    if (empenho.status !== 'ATIVO') {
      throw new ErroNegocio('CONFLITO', 'Só é possível liquidar empenho ATIVO.')
    }

    // Teto (Σ liquidações ≤ saldo do empenho) + anterioridade vêm da RAZÃO imutável.
    const data = dados.data ? new Date(dados.data) : new Date()
    const movimentos = await this.prisma.movimentoEmpenho.findMany({ where: { empenhoId: dados.empenhoId } })
    validarLancamento(movimentos, { tipo: 'LIQUIDACAO', valor, data }, { empenho: empenho.data })

    try {
      return await this.prisma.$transaction(async (tx) => {
        const liquidacao = await tx.liquidacao.create({
          data: {
            entidadeId,
            empenhoId: dados.empenhoId,
            numero,
            valor,
            notaFiscal: trimOuNull(dados.notaFiscal),
            atesteResponsavel: trimOuNull(dados.atesteResponsavel),
            data,
          },
        })
        await tx.empenho.update({ where: { id: dados.empenhoId }, data: { valorLiquidado: { increment: valor } } })
        // Razão: lançamento LIQUIDACAO da ficha do empenho.
        await tx.movimentoEmpenho.create({
          data: { entidadeId, empenhoId: dados.empenhoId, tipo: 'LIQUIDACAO', valor, data, liquidacaoId: liquidacao.id, criadoPorId: usuarioId, historico: `Liquidação ${numero}` },
        })
        return liquidacao
      })
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ErroNegocio('CONFLITO', `Já existe uma liquidação nº "${numero}" nesta entidade.`)
      }
      throw e
    }
  }

  /**
   * Estorna a liquidação (da parte ainda não paga). O valor define parcial/total —
   * o núcleo valida `Σ estornos ≤ saldo da liquidação` e a anterioridade. Ao zerar o
   * liquidado líquido, vira CANCELADA. Estorna o liquidado no empenho.
   */
  async estornar(id: string, valor: string | number, usuarioId: string, data: Date = new Date()) {
    const liquidacao = await this.prisma.liquidacao.findUnique({ where: { id }, include: { empenho: { select: { data: true } } } })
    if (!liquidacao) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Liquidação não encontrada.')
    const v = parseDecimalPositivo(valor, 'Valor do estorno')
    const movimentos = await this.prisma.movimentoEmpenho.findMany({ where: { empenhoId: liquidacao.empenhoId } })
    validarLancamento(movimentos, { tipo: 'ESTORNO_LIQUIDACAO', valor: v, data, liquidacaoId: id }, { empenho: liquidacao.empenho.data, liquidacao: liquidacao.data })
    return this.prisma.$transaction(async (tx) => {
      await tx.movimentoEmpenho.create({
        data: { entidadeId: liquidacao.entidadeId, empenhoId: liquidacao.empenhoId, tipo: 'ESTORNO_LIQUIDACAO', valor: v, data, liquidacaoId: id, criadoPorId: usuarioId, historico: `Estorno da liquidação ${liquidacao.numero}` },
      })
      await tx.empenho.update({ where: { id: liquidacao.empenhoId }, data: { valorLiquidado: { decrement: v } } })
      if (netLiquidadoDaLiquidacao([...movimentos, { tipo: 'ESTORNO_LIQUIDACAO', valor: v, liquidacaoId: id }], id).isZero()) {
        await tx.liquidacao.update({ where: { id }, data: { status: 'CANCELADA' } })
      }
      return { id, estornado: v.toFixed(2) }
    })
  }
}
