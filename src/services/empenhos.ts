import { PrismaClient, Prisma, type TipoEmpenho } from '@prisma/client'
import { ErroNegocio } from '../errors.js'
import { trimOuNull, parseDecimalPositivo } from './planos-contratacao.js'
import { saldoDisponivel } from './reservas-dotacao.js'

export type DadosEmpenho = {
  dotacaoDespesaId: string
  fornecedorId: string
  reservaDotacaoId?: string | null
  contratoId?: string | null
  ataRegistroPrecoId?: string | null
  numero: string
  tipo: TipoEmpenho
  data?: Date | string | null
  valor: string | number
  historico?: string | null
}

const TIPOS: ReadonlyArray<TipoEmpenho> = ['ORDINARIO', 'GLOBAL', 'ESTIMATIVO']

/**
 * Empenho (1º estágio da despesa). Compromete o orçamento e cria a obrigação
 * com o fornecedor.
 *
 * REGRA 2 (Conversão de Saldo): ao empenhar a partir de uma reserva, baixa a
 * reserva (status BAIXADA, estorna `valorReservado`) e soma `valorEmpenhado` na
 * dotação — sem duplicar o bloqueio. Empenho direto (sem reserva) consome o
 * saldo disponível. Tudo na mesma transação.
 */
export class EmpenhosService {
  constructor(private prisma: PrismaClient) {}

  listar(entidadeId: string) {
    return this.prisma.empenho.findMany({
      where: { entidadeId },
      orderBy: { data: 'desc' },
      include: {
        fornecedor: { select: { razaoSocial: true } },
        dotacaoDespesa: { include: { unidadeOrcamentaria: true, contaDespesa: true, fonteRecurso: true } },
        _count: { select: { liquidacoes: true } },
      },
    })
  }

  buscarPorId(id: string) {
    return this.prisma.empenho.findUnique({
      where: { id },
      include: { fornecedor: true, dotacaoDespesa: true, reservaDotacao: { select: { id: true, numero: true } } },
    })
  }

  async criar(entidadeId: string, dados: DadosEmpenho, usuarioId: string) {
    const entidade = await this.prisma.entidade.findUnique({ where: { id: entidadeId } })
    if (!entidade) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Entidade não encontrada.')

    const numero = dados.numero?.trim()
    if (!numero) throw new ErroNegocio('REQUISICAO_INVALIDA', 'Número do empenho é obrigatório.')
    if (!TIPOS.includes(dados.tipo)) throw new ErroNegocio('REQUISICAO_INVALIDA', 'Tipo de empenho inválido.')
    const valor = parseDecimalPositivo(dados.valor, 'Valor do empenho')

    const fornecedor = await this.prisma.fornecedor.findUnique({ where: { id: dados.fornecedorId } })
    if (!fornecedor || !fornecedor.ativo) throw new ErroNegocio('REQUISICAO_INVALIDA', 'Fornecedor inválido ou inativo.')

    const dotacao = await this.carregarDotacao(dados.dotacaoDespesaId, entidadeId)
    const reserva = await this.carregarReserva(dados.reservaDotacaoId, entidadeId, dados.dotacaoDespesaId)
    await this.validarVinculos(dados, entidadeId)

    if (reserva) {
      if (valor.greaterThan(reserva.valor)) {
        throw new ErroNegocio('REQUISICAO_INVALIDA', 'Valor do empenho não pode exceder o da reserva convertida.')
      }
    } else {
      const disp = saldoDisponivel(dotacao)
      if (valor.greaterThan(disp)) {
        throw new ErroNegocio(
          'ENTIDADE_NAO_PROCESSAVEL',
          `Saldo insuficiente na dotação: disponível R$ ${disp.toFixed(2)}, empenho R$ ${valor.toFixed(2)}.`,
        )
      }
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const empenho = await tx.empenho.create({
          data: {
            entidadeId,
            dotacaoDespesaId: dados.dotacaoDespesaId,
            fornecedorId: dados.fornecedorId,
            reservaDotacaoId: reserva?.id ?? null,
            contratoId: trimOuNull(dados.contratoId),
            ataRegistroPrecoId: trimOuNull(dados.ataRegistroPrecoId),
            numero,
            tipo: dados.tipo,
            valor,
            historico: trimOuNull(dados.historico),
            ...(dados.data ? { data: new Date(dados.data) } : {}),
          },
        })
        // Razão imutável: lançamento EMPENHO da ficha (Specs 22-06-2026 §8).
        await tx.movimentoEmpenho.create({
          data: { entidadeId, empenhoId: empenho.id, tipo: 'EMPENHO', valor, data: empenho.data, criadoPorId: usuarioId, historico: `Empenho ${numero}` },
        })
        if (reserva) {
          await tx.reservaDotacao.update({ where: { id: reserva.id }, data: { status: 'BAIXADA' } })
          await tx.dotacaoDespesa.update({
            where: { id: dados.dotacaoDespesaId },
            data: { valorReservado: { decrement: reserva.valor }, valorEmpenhado: { increment: valor } },
          })
        } else {
          await tx.dotacaoDespesa.update({
            where: { id: dados.dotacaoDespesaId },
            data: { valorEmpenhado: { increment: valor } },
          })
        }
        return empenho
      })
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ErroNegocio('CONFLITO', `Já existe um empenho nº "${numero}" nesta entidade.`)
      }
      throw e
    }
  }

  /** Anula um empenho ATIVO sem liquidações e estorna o empenhado na dotação. */
  async anular(id: string, usuarioId: string, data: Date = new Date()) {
    const empenho = await this.prisma.empenho.findUnique({ where: { id } })
    if (!empenho) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Empenho não encontrado.')
    if (empenho.status !== 'ATIVO') throw new ErroNegocio('CONFLITO', 'Apenas empenho ATIVO pode ser anulado.')
    if (!new Prisma.Decimal(empenho.valorLiquidado).isZero()) {
      throw new ErroNegocio('CONFLITO', 'Empenho com liquidações não pode ser anulado.')
    }
    return this.prisma.$transaction(async (tx) => {
      const atualizado = await tx.empenho.update({ where: { id }, data: { status: 'ANULADO' } })
      await tx.dotacaoDespesa.update({
        where: { id: empenho.dotacaoDespesaId },
        data: { valorEmpenhado: { decrement: empenho.valor } },
      })
      // Razão: ESTORNO_EMPENHO total (anulação é all-or-nothing; sem liquidações).
      await tx.movimentoEmpenho.create({
        data: { entidadeId: empenho.entidadeId, empenhoId: id, tipo: 'ESTORNO_EMPENHO', valor: empenho.valor, data, criadoPorId: usuarioId, historico: `Anulação do empenho ${empenho.numero}` },
      })
      return atualizado
    })
  }

  private async carregarDotacao(dotacaoDespesaId: string, entidadeId: string) {
    if (!dotacaoDespesaId?.trim()) throw new ErroNegocio('REQUISICAO_INVALIDA', 'Dotação é obrigatória.')
    const dotacao = await this.prisma.dotacaoDespesa.findUnique({
      where: { id: dotacaoDespesaId },
      include: { orcamento: { select: { entidadeId: true, status: true } } },
    })
    if (!dotacao || dotacao.orcamento.entidadeId !== entidadeId) {
      throw new ErroNegocio('REQUISICAO_INVALIDA', 'Dotação inválida para esta entidade.')
    }
    if (dotacao.orcamento.status === 'RASCUNHO') {
      throw new ErroNegocio('CONFLITO', 'Não é possível empenhar contra orçamento em RASCUNHO.')
    }
    return dotacao
  }

  private async carregarReserva(reservaId: string | null | undefined, entidadeId: string, dotacaoDespesaId: string) {
    const id = trimOuNull(reservaId)
    if (!id) return null
    const reserva = await this.prisma.reservaDotacao.findUnique({ where: { id } })
    if (!reserva || reserva.entidadeId !== entidadeId) {
      throw new ErroNegocio('REQUISICAO_INVALIDA', 'Reserva inválida para esta entidade.')
    }
    if (reserva.dotacaoDespesaId !== dotacaoDespesaId) {
      throw new ErroNegocio('REQUISICAO_INVALIDA', 'Reserva não pertence à dotação informada.')
    }
    if (reserva.status !== 'ATIVA') {
      throw new ErroNegocio('CONFLITO', `Reserva não está ATIVA (status: ${reserva.status}).`)
    }
    return reserva
  }

  private async validarVinculos(dados: DadosEmpenho, entidadeId: string) {
    const contratoId = trimOuNull(dados.contratoId)
    if (contratoId) {
      const c = await this.prisma.contrato.findUnique({ where: { id: contratoId } })
      if (!c || c.entidadeId !== entidadeId) throw new ErroNegocio('REQUISICAO_INVALIDA', 'Contrato inválido para esta entidade.')
    }
    const ataId = trimOuNull(dados.ataRegistroPrecoId)
    if (ataId) {
      const a = await this.prisma.ataRegistroPreco.findUnique({ where: { id: ataId } })
      if (!a || a.entidadeId !== entidadeId) throw new ErroNegocio('REQUISICAO_INVALIDA', 'Ata inválida para esta entidade.')
    }
  }
}
