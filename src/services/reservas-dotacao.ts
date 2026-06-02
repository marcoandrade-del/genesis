import { PrismaClient, Prisma } from '@prisma/client'
import { ErroNegocio } from '../errors.js'
import { trimOuNull, parseDecimalPositivo } from './planos-contratacao.js'

export type DadosReserva = {
  dotacaoDespesaId: string
  termoReferenciaId?: string | null
  numero: string
  valor: string | number
  observacoes?: string | null
}

/**
 * Reserva de Dotação (Pré-Empenho). Bloqueia saldo orçamentário da Dotação para
 * a futura contratação.
 *
 * REGRA 1 (Garantia de Saldo): o valor da reserva não pode exceder o saldo
 * disponível da dotação (autorizado − reservado − empenhado). Ao criar, o
 * `valorReservado` da DotacaoDespesa é incrementado na mesma transação; ao
 * cancelar, é estornado. A baixa definitiva (reserva → empenho) virá no PR-3.
 *
 * Obs.: o saldo é materializado; a checagem ocorre antes da transação. Em
 * altíssima concorrência sobre a mesma dotação há janela de corrida — aceitável
 * neste estágio (mesma abordagem dos agregados do projeto).
 */
export class ReservasDotacaoService {
  constructor(private prisma: PrismaClient) {}

  listar(entidadeId: string) {
    return this.prisma.reservaDotacao.findMany({
      where: { entidadeId },
      orderBy: { data: 'desc' },
      include: {
        dotacaoDespesa: { include: { unidadeOrcamentaria: true, contaDespesa: true, fonteRecurso: true } },
        termoReferencia: { select: { id: true, objeto: true } },
      },
    })
  }

  buscarPorId(id: string) {
    return this.prisma.reservaDotacao.findUnique({
      where: { id },
      include: { dotacaoDespesa: true, termoReferencia: { select: { id: true, objeto: true } } },
    })
  }

  async criar(entidadeId: string, dados: DadosReserva) {
    const entidade = await this.prisma.entidade.findUnique({ where: { id: entidadeId } })
    if (!entidade) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Entidade não encontrada.')

    const numero = dados.numero?.trim()
    if (!numero) throw new ErroNegocio('REQUISICAO_INVALIDA', 'Número da reserva é obrigatório.')
    const valor = parseDecimalPositivo(dados.valor, 'Valor da reserva')

    const dotacao = await this.carregarDotacao(dados.dotacaoDespesaId, entidadeId)
    await this.validarTermo(dados.termoReferenciaId, entidadeId)

    // REGRA 1: valor não pode exceder o saldo disponível.
    const disponivel = saldoDisponivel(dotacao)
    if (valor.greaterThan(disponivel)) {
      throw new ErroNegocio(
        'ENTIDADE_NAO_PROCESSAVEL',
        `Saldo insuficiente na dotação: disponível R$ ${disponivel.toFixed(2)}, solicitado R$ ${valor.toFixed(2)}.`,
      )
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const reserva = await tx.reservaDotacao.create({
          data: {
            entidadeId,
            dotacaoDespesaId: dados.dotacaoDespesaId,
            termoReferenciaId: trimOuNull(dados.termoReferenciaId),
            numero,
            valor,
            observacoes: trimOuNull(dados.observacoes),
          },
        })
        await tx.dotacaoDespesa.update({
          where: { id: dados.dotacaoDespesaId },
          data: { valorReservado: { increment: valor } },
        })
        return reserva
      })
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ErroNegocio('CONFLITO', `Já existe uma reserva nº "${numero}" nesta entidade.`)
      }
      throw e
    }
  }

  /** Cancela uma reserva ATIVA e estorna o valor reservado na dotação. */
  async cancelar(id: string) {
    const reserva = await this.prisma.reservaDotacao.findUnique({ where: { id } })
    if (!reserva) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Reserva não encontrada.')
    if (reserva.status !== 'ATIVA') {
      throw new ErroNegocio('CONFLITO', `Só é possível cancelar reserva ATIVA (status atual: ${reserva.status}).`)
    }
    return this.prisma.$transaction(async (tx) => {
      const atualizada = await tx.reservaDotacao.update({ where: { id }, data: { status: 'CANCELADA' } })
      await tx.dotacaoDespesa.update({
        where: { id: reserva.dotacaoDespesaId },
        data: { valorReservado: { decrement: reserva.valor } },
      })
      return atualizada
    })
  }

  private async carregarDotacao(dotacaoDespesaId: string, entidadeId: string) {
    if (!dotacaoDespesaId?.trim()) {
      throw new ErroNegocio('REQUISICAO_INVALIDA', 'Dotação é obrigatória.')
    }
    const dotacao = await this.prisma.dotacaoDespesa.findUnique({
      where: { id: dotacaoDespesaId },
      include: { orcamento: { select: { entidadeId: true, status: true } } },
    })
    if (!dotacao || dotacao.orcamento.entidadeId !== entidadeId) {
      throw new ErroNegocio('REQUISICAO_INVALIDA', 'Dotação inválida para esta entidade.')
    }
    if (dotacao.orcamento.status === 'RASCUNHO') {
      throw new ErroNegocio('CONFLITO', 'Não é possível reservar contra orçamento em RASCUNHO.')
    }
    return dotacao
  }

  private async validarTermo(termoReferenciaId: string | null | undefined, entidadeId: string) {
    const id = trimOuNull(termoReferenciaId)
    if (!id) return
    const tr = await this.prisma.termoReferencia.findUnique({
      where: { id },
      include: { documentoDemanda: { select: { entidadeId: true } } },
    })
    if (!tr || tr.documentoDemanda.entidadeId !== entidadeId) {
      throw new ErroNegocio('REQUISICAO_INVALIDA', 'Termo de Referência inválido para esta entidade.')
    }
  }
}

/** Saldo disponível da dotação = autorizado − reservado − empenhado. */
export function saldoDisponivel(dotacao: {
  valorAutorizado: Prisma.Decimal
  valorReservado: Prisma.Decimal
  valorEmpenhado: Prisma.Decimal
}): Prisma.Decimal {
  return new Prisma.Decimal(dotacao.valorAutorizado)
    .minus(dotacao.valorReservado)
    .minus(dotacao.valorEmpenhado)
}
