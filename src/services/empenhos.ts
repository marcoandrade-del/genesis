import { PrismaClient, Prisma, type TipoEmpenho } from '@prisma/client'
import { ErroNegocio } from '../errors.js'
import { trimOuNull, parseDecimalPositivo } from './planos-contratacao.js'
import { saldoDisponivel } from './reservas-dotacao.js'
import { resumirEmpenho, validarLancamento } from './saldos-empenho.js'

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

  /**
   * Ficha de empenho: o empenho + a razão imutável (movimentos) + o resumo das 6
   * colunas/saldos (Specs 22-06-2026 §8). É a "movimentação da despesa" da ficha.
   */
  async ficha(id: string) {
    const empenho = await this.prisma.empenho.findUnique({
      where: { id },
      include: {
        fornecedor: { select: { razaoSocial: true, cnpj: true, cpf: true } },
        dotacaoDespesa: {
          include: {
            unidadeOrcamentaria: { select: { codigo: true, nome: true, orgao: { select: { codigo: true, nome: true } } } },
            contaDespesa: { select: { codigo: true, descricao: true } },
            fonteRecurso: { select: { codigo: true, nomenclatura: true } },
          },
        },
      },
    })
    if (!empenho) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Empenho não encontrado.')
    const movimentos = await this.prisma.movimentoEmpenho.findMany({
      where: { empenhoId: id },
      orderBy: [{ data: 'asc' }, { criadoEm: 'asc' }],
    })
    return { empenho, movimentos, resumo: resumirEmpenho(movimentos) }
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

  /**
   * Estorna o empenho (do saldo a liquidar). O valor define se é parcial ou total —
   * o núcleo valida `Σ estornos ≤ saldo do empenho` e a anterioridade. Ao zerar o net
   * empenhado, vira ANULADO. Estorna o empenhado na dotação.
   */
  async estornar(id: string, valor: string | number, usuarioId: string, data: Date = new Date()) {
    const empenho = await this.prisma.empenho.findUnique({ where: { id } })
    if (!empenho) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Empenho não encontrado.')
    const v = parseDecimalPositivo(valor, 'Valor do estorno')
    const movimentos = await this.prisma.movimentoEmpenho.findMany({ where: { empenhoId: id } })
    validarLancamento(movimentos, { tipo: 'ESTORNO_EMPENHO', valor: v, data }, { empenho: empenho.data })
    return this.prisma.$transaction(async (tx) => {
      await tx.movimentoEmpenho.create({
        data: { entidadeId: empenho.entidadeId, empenhoId: id, tipo: 'ESTORNO_EMPENHO', valor: v, data, criadoPorId: usuarioId, historico: `Estorno do empenho ${empenho.numero}` },
      })
      await tx.dotacaoDespesa.update({ where: { id: empenho.dotacaoDespesaId }, data: { valorEmpenhado: { decrement: v } } })
      if (resumirEmpenho([...movimentos, { tipo: 'ESTORNO_EMPENHO', valor: v }]).netEmpenhado.isZero()) {
        await tx.empenho.update({ where: { id }, data: { status: 'ANULADO' } })
      }
      return { id, estornado: v.toFixed(2) }
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
