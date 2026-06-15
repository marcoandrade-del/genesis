import { PrismaClient, Prisma } from '@prisma/client'
import { ErroNegocio } from '../errors.js'
import { trimOuNull, parseDecimalPositivo } from './planos-contratacao.js'
import { rotuloConta } from './contas-bancarias.js'

export type DadosOrdemPagamento = {
  liquidacaoId: string
  numero: string
  data?: Date | string | null
  valor: string | number
  contaBancariaId: string
  comprovante?: string | null
}

/**
 * Ordem de Pagamento (3º estágio). Autoriza o pagamento ao fornecedor.
 *
 * REGRA 5 (Precedência): só existe sobre uma Liquidação ATIVA. A soma das OPs de
 * uma liquidação não pode exceder o valor liquidado (controle via `valorPago`).
 */
export class OrdensPagamentoService {
  constructor(private prisma: PrismaClient) {}

  listar(entidadeId: string) {
    return this.prisma.ordemPagamento.findMany({
      where: { entidadeId },
      orderBy: { data: 'desc' },
      include: { liquidacao: { select: { numero: true, empenho: { select: { numero: true } } } } },
    })
  }

  buscarPorId(id: string) {
    return this.prisma.ordemPagamento.findUnique({
      where: { id },
      include: { liquidacao: { select: { id: true, numero: true } } },
    })
  }

  async criar(entidadeId: string, dados: DadosOrdemPagamento) {
    const numero = dados.numero?.trim()
    if (!numero) throw new ErroNegocio('REQUISICAO_INVALIDA', 'Número da OP é obrigatório.')
    if (!dados.contaBancariaId?.trim()) throw new ErroNegocio('REQUISICAO_INVALIDA', 'Conta bancária é obrigatória.')
    const valor = parseDecimalPositivo(dados.valor, 'Valor da OP')

    // Inclui a fonte do empenho (via dotação) para a trava conta×fonte abaixo.
    const liquidacao = await this.prisma.liquidacao.findUnique({
      where: { id: dados.liquidacaoId },
      include: {
        empenho: {
          select: { dotacaoDespesa: { select: { fonteRecurso: { select: { codigo: true, nomenclatura: true } } } } },
        },
      },
    })
    if (!liquidacao || liquidacao.entidadeId !== entidadeId) {
      throw new ErroNegocio('REQUISICAO_INVALIDA', 'Liquidação inválida para esta entidade.')
    }
    if (liquidacao.status !== 'ATIVA') {
      throw new ErroNegocio('CONFLITO', 'Só é possível pagar liquidação ATIVA.')
    }

    // REGRA (Marco, 2026-05-28): pagamentos de uma fonte só podem sair pelas
    // contas bancárias daquela fonte. A fonte da OP é a da dotação do empenho.
    const fonte = liquidacao.empenho.dotacaoDespesa.fonteRecurso
    const conta = await this.prisma.contaBancaria.findUnique({ where: { id: dados.contaBancariaId.trim() } })
    if (!conta || conta.entidadeId !== entidadeId) {
      throw new ErroNegocio('REQUISICAO_INVALIDA', 'Conta bancária inválida para esta entidade.')
    }
    if (!conta.ativa) {
      throw new ErroNegocio('ENTIDADE_NAO_PROCESSAVEL', 'A conta bancária está inativa.')
    }
    if (conta.fonteCodigo !== fonte.codigo) {
      throw new ErroNegocio(
        'ENTIDADE_NAO_PROCESSAVEL',
        `Pagamentos da fonte ${fonte.codigo} (${fonte.nomenclatura}) só podem sair de contas bancárias vinculadas a ela — a conta escolhida pertence à fonte ${conta.fonteCodigo}.`,
      )
    }

    const disponivel = new Prisma.Decimal(liquidacao.valor).minus(liquidacao.valorPago)
    if (valor.greaterThan(disponivel)) {
      throw new ErroNegocio(
        'ENTIDADE_NAO_PROCESSAVEL',
        `Pagamento excede o saldo da liquidação: disponível R$ ${disponivel.toFixed(2)}, OP R$ ${valor.toFixed(2)}.`,
      )
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const op = await tx.ordemPagamento.create({
          data: {
            entidadeId,
            liquidacaoId: dados.liquidacaoId,
            numero,
            valor,
            contaBancaria: rotuloConta(conta),
            contaBancariaId: conta.id,
            comprovante: trimOuNull(dados.comprovante),
            ...(dados.data ? { data: new Date(dados.data) } : {}),
          },
        })
        await tx.liquidacao.update({ where: { id: dados.liquidacaoId }, data: { valorPago: { increment: valor } } })
        return op
      })
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ErroNegocio('CONFLITO', `Já existe uma OP nº "${numero}" nesta entidade.`)
      }
      throw e
    }
  }

  /** Confirma o pagamento (EMITIDA → PAGA), registrando o comprovante. */
  async confirmarPagamento(id: string, comprovante?: string | null) {
    const op = await this.prisma.ordemPagamento.findUnique({ where: { id } })
    if (!op) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Ordem de pagamento não encontrada.')
    if (op.status !== 'EMITIDA') throw new ErroNegocio('CONFLITO', 'Apenas OP EMITIDA pode ser confirmada.')
    return this.prisma.ordemPagamento.update({
      where: { id },
      data: { status: 'PAGA', comprovante: trimOuNull(comprovante) ?? op.comprovante },
    })
  }

  /** Cancela uma OP (EMITIDA ou PAGA) e estorna o valor pago na liquidação. */
  async cancelar(id: string) {
    const op = await this.prisma.ordemPagamento.findUnique({ where: { id } })
    if (!op) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Ordem de pagamento não encontrada.')
    if (op.status === 'CANCELADA') throw new ErroNegocio('CONFLITO', 'OP já está cancelada.')
    return this.prisma.$transaction(async (tx) => {
      const atualizada = await tx.ordemPagamento.update({ where: { id }, data: { status: 'CANCELADA' } })
      await tx.liquidacao.update({ where: { id: op.liquidacaoId }, data: { valorPago: { decrement: op.valor } } })
      return atualizada
    })
  }
}
