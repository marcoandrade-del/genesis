import { PrismaClient, Prisma } from '@prisma/client'
import { ErroNegocio } from '../errors.js'
import { trimOuNull, parseDecimalPositivo } from './planos-contratacao.js'

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

    // REGRA 4: soma das liquidações ≤ valor empenhado.
    const disponivel = new Prisma.Decimal(empenho.valor).minus(empenho.valorLiquidado)
    if (valor.greaterThan(disponivel)) {
      throw new ErroNegocio(
        'ENTIDADE_NAO_PROCESSAVEL',
        `Liquidação excede o saldo do empenho: disponível R$ ${disponivel.toFixed(2)}, liquidação R$ ${valor.toFixed(2)}.`,
      )
    }

    // Anterioridade: a liquidação não pode anteceder o empenho.
    const data = dados.data ? new Date(dados.data) : new Date()
    if (data.getTime() < new Date(empenho.data).getTime()) {
      throw new ErroNegocio('REQUISICAO_INVALIDA', 'Data da liquidação não pode anteceder o empenho.')
    }

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

  /** Cancela liquidação ATIVA sem pagamentos e estorna o liquidado no empenho. */
  async cancelar(id: string, usuarioId: string, data: Date = new Date()) {
    const liquidacao = await this.prisma.liquidacao.findUnique({ where: { id } })
    if (!liquidacao) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Liquidação não encontrada.')
    if (liquidacao.status !== 'ATIVA') {
      throw new ErroNegocio('CONFLITO', `Só é possível cancelar liquidação ATIVA (status: ${liquidacao.status}).`)
    }
    if (!new Prisma.Decimal(liquidacao.valorPago).isZero()) {
      throw new ErroNegocio('CONFLITO', 'Liquidação com pagamentos não pode ser cancelada.')
    }
    return this.prisma.$transaction(async (tx) => {
      const atualizada = await tx.liquidacao.update({ where: { id }, data: { status: 'CANCELADA' } })
      await tx.empenho.update({ where: { id: liquidacao.empenhoId }, data: { valorLiquidado: { decrement: liquidacao.valor } } })
      // Razão: ESTORNO_LIQUIDACAO total (cancelamento all-or-nothing; sem pagamentos).
      await tx.movimentoEmpenho.create({
        data: { entidadeId: liquidacao.entidadeId, empenhoId: liquidacao.empenhoId, tipo: 'ESTORNO_LIQUIDACAO', valor: liquidacao.valor, data, liquidacaoId: id, criadoPorId: usuarioId, historico: `Cancelamento da liquidação ${liquidacao.numero}` },
      })
      return atualizada
    })
  }
}
