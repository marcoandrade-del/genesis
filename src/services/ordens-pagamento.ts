import { PrismaClient, Prisma } from '@prisma/client'
import { ErroNegocio } from '../errors.js'
import { trimOuNull, parseDecimalPositivo } from './planos-contratacao.js'
import { rotuloConta } from './contas-bancarias.js'
import { validarLancamento, netPagoDaOrdem } from './saldos-empenho.js'
import { MotorEventosDespesa, gravarEventos, isoData } from './motor-eventos-despesa.js'
import { LancamentosService } from './lancamentos.js'

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
  private motor: MotorEventosDespesa
  private lancamentos: LancamentosService

  constructor(private prisma: PrismaClient) {
    this.motor = new MotorEventosDespesa(prisma)
    this.lancamentos = new LancamentosService(prisma)
  }

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

  async criar(entidadeId: string, dados: DadosOrdemPagamento, usuarioId: string) {
    const numero = dados.numero?.trim()
    if (!numero) throw new ErroNegocio('REQUISICAO_INVALIDA', 'Número da OP é obrigatório.')
    if (!dados.contaBancariaId?.trim()) throw new ErroNegocio('REQUISICAO_INVALIDA', 'Conta bancária é obrigatória.')
    const valor = parseDecimalPositivo(dados.valor, 'Valor da OP')

    // Inclui a fonte do empenho (via dotação) para a trava conta×fonte abaixo, e a
    // natureza (sub-elemento) + exercício + dotação para o disparo contábil.
    const liquidacao = await this.prisma.liquidacao.findUnique({
      where: { id: dados.liquidacaoId },
      include: {
        empenho: {
          select: {
            data: true,
            dotacaoDespesaId: true,
            dotacaoDespesa: { select: { orcamento: { select: { ano: true } }, contaDespesa: { select: { codigo: true } }, fonteRecurso: { select: { codigo: true, nomenclatura: true } } } },
            subElementoConta: { select: { codigo: true } },
          },
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

    // Teto (Σ pagamentos ≤ saldo da liquidação) + anterioridade vêm da RAZÃO imutável.
    const data = dados.data ? new Date(dados.data) : new Date()
    const movimentos = await this.prisma.movimentoEmpenho.findMany({ where: { empenhoId: liquidacao.empenhoId } })
    validarLancamento(movimentos, { tipo: 'PAGAMENTO', valor, data, liquidacaoId: dados.liquidacaoId }, { empenho: liquidacao.empenho.data, liquidacao: liquidacao.data })

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
            data,
          },
        })
        await tx.liquidacao.update({ where: { id: dados.liquidacaoId }, data: { valorPago: { increment: valor } } })
        // Razão: lançamento PAGAMENTO da ficha (empenhoId via liquidação).
        await tx.movimentoEmpenho.create({
          data: { entidadeId, empenhoId: liquidacao.empenhoId, tipo: 'PAGAMENTO', valor, data, liquidacaoId: dados.liquidacaoId, ordemPagamentoId: op.id, criadoPorId: usuarioId, historico: `Pagamento ${numero}` },
        })
        // Integração contábil (Tabela de Eventos): pagamento dispara orçamentário +
        // DDR + financeiro (passivo/caixa), saindo o numerário pela conta bancária.
        await this.dispararPagamento(tx, {
          entidadeId,
          ano: liquidacao.empenho.dotacaoDespesa.orcamento.ano,
          dotacaoDespesaId: liquidacao.empenho.dotacaoDespesaId,
          naturezaCodigo: liquidacao.empenho.subElementoConta?.codigo ?? liquidacao.empenho.dotacaoDespesa.contaDespesa.codigo,
          caixaCodigo: conta.contaContabilCodigo,
          valor,
          data: isoData(data),
          historico: `Pagamento ${numero}`,
          origemId: op.id,
          criadoPorId: usuarioId,
        })
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

  /**
   * Estorna o pagamento de uma OP. O valor define parcial/total — o núcleo valida
   * `Σ estornos ≤ pago da OP` e a anterioridade. Ao zerar o pago líquido, vira
   * CANCELADA. Estorna o valor pago na liquidação.
   */
  async estornar(id: string, valor: string | number, usuarioId: string, data: Date = new Date()) {
    const op = await this.prisma.ordemPagamento.findUnique({
      where: { id },
      include: {
        contaBancariaRef: { select: { contaContabilCodigo: true } },
        liquidacao: {
          select: {
            empenhoId: true,
            empenho: {
              select: {
                dotacaoDespesaId: true,
                dotacaoDespesa: { select: { orcamento: { select: { ano: true } }, contaDespesa: { select: { codigo: true } } } },
                subElementoConta: { select: { codigo: true } },
              },
            },
          },
        },
      },
    })
    if (!op) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Ordem de pagamento não encontrada.')
    const v = parseDecimalPositivo(valor, 'Valor do estorno')
    const movimentos = await this.prisma.movimentoEmpenho.findMany({ where: { empenhoId: op.liquidacao.empenhoId } })
    validarLancamento(movimentos, { tipo: 'ESTORNO_PAGAMENTO', valor: v, data, ordemPagamentoId: id }, { empenho: data, ordemPagamento: op.data })
    return this.prisma.$transaction(async (tx) => {
      await tx.movimentoEmpenho.create({
        data: { entidadeId: op.entidadeId, empenhoId: op.liquidacao.empenhoId, tipo: 'ESTORNO_PAGAMENTO', valor: v, data, liquidacaoId: op.liquidacaoId, ordemPagamentoId: id, criadoPorId: usuarioId, historico: `Estorno do pagamento ${op.numero}` },
      })
      await tx.liquidacao.update({ where: { id: op.liquidacaoId }, data: { valorPago: { decrement: v } } })
      if (netPagoDaOrdem([...movimentos, { tipo: 'ESTORNO_PAGAMENTO', valor: v, ordemPagamentoId: id }], id).isZero()) {
        await tx.ordemPagamento.update({ where: { id }, data: { status: 'CANCELADA' } })
      }
      // Integração contábil: o estorno do pagamento inverte os eventos da OP.
      await this.dispararPagamento(tx, {
        entidadeId: op.entidadeId,
        ano: op.liquidacao.empenho.dotacaoDespesa.orcamento.ano,
        dotacaoDespesaId: op.liquidacao.empenho.dotacaoDespesaId,
        naturezaCodigo: op.liquidacao.empenho.subElementoConta?.codigo ?? op.liquidacao.empenho.dotacaoDespesa.contaDespesa.codigo,
        caixaCodigo: op.contaBancariaRef?.contaContabilCodigo ?? null,
        valor: v,
        data: isoData(data),
        historico: `Estorno do pagamento ${op.numero}`,
        origemId: id,
        criadoPorId: usuarioId,
        estorno: true,
      })
      return { id, estornado: v.toFixed(2) }
    })
  }

  /**
   * Dispara os lançamentos contábeis do pagamento (E800 orçamentário + E801 DDR
   * + E802 financeiro passivo/caixa) via Tabela de Eventos, na transação. `estorno`
   * inverte cada par D↔C. Falha (rollback) se o plano não tiver as folhas.
   */
  private async dispararPagamento(
    tx: Prisma.TransactionClient,
    args: {
      entidadeId: string
      ano: number
      dotacaoDespesaId: string
      naturezaCodigo: string
      caixaCodigo?: string | null
      valor: Prisma.Decimal
      data: string
      historico: string
      origemId: string
      criadoPorId: string
      estorno?: boolean
    },
  ) {
    const eventos = await this.motor.resolverPagamento(
      {
        entidadeId: args.entidadeId,
        ano: args.ano,
        dotacaoDespesaId: args.dotacaoDespesaId,
        naturezaCodigo: args.naturezaCodigo,
        caixaCodigo: args.caixaCodigo,
        valor: args.valor,
      },
      { estorno: args.estorno },
      tx,
    )
    await gravarEventos(
      this.lancamentos,
      eventos,
      { entidadeId: args.entidadeId, data: args.data, histBase: args.historico, origemTipo: 'PAGAMENTO', origemId: args.origemId, criadoPorId: args.criadoPorId },
      tx,
    )
  }
}
