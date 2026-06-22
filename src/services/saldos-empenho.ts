import { Prisma, type TipoMovimentoEmpenho } from '@prisma/client'
import { ErroNegocio } from '../errors.js'

/**
 * Núcleo PURO da realização da despesa (Specs 22-06-2026 §8). Toda a aritmética
 * de saldos em cascata e a validação dos tetos/anterioridade vivem aqui, sobre a
 * razão imutável de um empenho (`MovimentoEmpenho`) — sem banco, 100% testável.
 *
 * As 6 colunas da movimentação saem de Σ por tipo; estorno é coluna à parte:
 *   net empenhado = EMPENHO − ESTORNO_EMPENHO
 *   net liquidado = LIQUIDACAO − ESTORNO_LIQUIDACAO
 *   net pago      = PAGAMENTO − ESTORNO_PAGAMENTO
 *   saldo do empenho (a liquidar) = net empenhado − net liquidado
 *   saldo a pagar do empenho      = net liquidado − net pago
 */

const ZERO = new Prisma.Decimal(0)

export type MovimentoLido = {
  tipo: TipoMovimentoEmpenho
  valor: Prisma.Decimal
  liquidacaoId?: string | null
  ordemPagamentoId?: string | null
}

export type ResumoEmpenho = {
  empenhado: Prisma.Decimal
  estornoEmpenho: Prisma.Decimal
  liquidado: Prisma.Decimal
  estornoLiquidacao: Prisma.Decimal
  pago: Prisma.Decimal
  estornoPagamento: Prisma.Decimal
  netEmpenhado: Prisma.Decimal
  netLiquidado: Prisma.Decimal
  netPago: Prisma.Decimal
  /** Saldo a liquidar do empenho = net empenhado − net liquidado. */
  saldoEmpenho: Prisma.Decimal
  /** Saldo a pagar do empenho = net liquidado − net pago. */
  saldoAPagar: Prisma.Decimal
}

const somaPorTipo = (movs: MovimentoLido[], tipo: TipoMovimentoEmpenho) =>
  movs.reduce((acc, m) => (m.tipo === tipo ? acc.plus(m.valor) : acc), ZERO)

/** Consolida as 6 colunas + nets + saldos da ficha de um empenho. */
export function resumirEmpenho(movs: MovimentoLido[]): ResumoEmpenho {
  const empenhado = somaPorTipo(movs, 'EMPENHO')
  const estornoEmpenho = somaPorTipo(movs, 'ESTORNO_EMPENHO')
  const liquidado = somaPorTipo(movs, 'LIQUIDACAO')
  const estornoLiquidacao = somaPorTipo(movs, 'ESTORNO_LIQUIDACAO')
  const pago = somaPorTipo(movs, 'PAGAMENTO')
  const estornoPagamento = somaPorTipo(movs, 'ESTORNO_PAGAMENTO')
  const netEmpenhado = empenhado.minus(estornoEmpenho)
  const netLiquidado = liquidado.minus(estornoLiquidacao)
  const netPago = pago.minus(estornoPagamento)
  return {
    empenhado,
    estornoEmpenho,
    liquidado,
    estornoLiquidacao,
    pago,
    estornoPagamento,
    netEmpenhado,
    netLiquidado,
    netPago,
    saldoEmpenho: netEmpenhado.minus(netLiquidado),
    saldoAPagar: netLiquidado.minus(netPago),
  }
}

/** Saldo de UMA liquidação = (liquidado − estornado) − (pago − estornado) dela. */
export function saldoDaLiquidacao(movs: MovimentoLido[], liquidacaoId: string): Prisma.Decimal {
  const doL = movs.filter((m) => m.liquidacaoId === liquidacaoId)
  const liq = somaPorTipo(doL, 'LIQUIDACAO').minus(somaPorTipo(doL, 'ESTORNO_LIQUIDACAO'))
  const pag = somaPorTipo(doL, 'PAGAMENTO').minus(somaPorTipo(doL, 'ESTORNO_PAGAMENTO'))
  return liq.minus(pag)
}

/** Pago líquido de UMA ordem de pagamento = PAGAMENTO − ESTORNO_PAGAMENTO dela. */
export function netPagoDaOrdem(movs: MovimentoLido[], ordemPagamentoId: string): Prisma.Decimal {
  const doP = movs.filter((m) => m.ordemPagamentoId === ordemPagamentoId)
  return somaPorTipo(doP, 'PAGAMENTO').minus(somaPorTipo(doP, 'ESTORNO_PAGAMENTO'))
}

export type NovoLancamento = {
  tipo: TipoMovimentoEmpenho
  valor: Prisma.Decimal
  data: Date
  liquidacaoId?: string | null
  ordemPagamentoId?: string | null
}

/** Datas dos documentos antecessores, para a regra de anterioridade. */
export type DatasReferencia = {
  empenho: Date
  liquidacao?: Date
  ordemPagamento?: Date
}

const exigir = (cond: boolean, msg: string) => {
  if (!cond) throw new ErroNegocio('ENTIDADE_NAO_PROCESSAVEL', msg)
}
const f2 = (d: Prisma.Decimal) => d.toFixed(2)

const exigirAnterioridade = (dataMov: Date, dataAntecessor: Date | undefined, oQue: string, fase: string) => {
  if (!dataAntecessor) throw new ErroNegocio('REQUISICAO_INVALIDA', `Data de ${fase} ausente para validar ${oQue}.`)
  if (dataMov.getTime() < dataAntecessor.getTime()) {
    throw new ErroNegocio('REQUISICAO_INVALIDA', `Data do ${oQue} não pode anteceder a ${fase}.`)
  }
}
const obrig = (id: string | null | undefined, campo: string): string => {
  if (!id) throw new ErroNegocio('REQUISICAO_INVALIDA', `${campo} é obrigatório para este lançamento.`)
  return id
}

/**
 * Valida um NOVO lançamento contra a razão atual do empenho — teto (Σ ≤ saldo do
 * estágio) e anterioridade de data. Lança `ErroNegocio` se violar. Os parciais e
 * múltiplos são livres: o teto incide sobre a SOMA, nunca sobre o valor avulso.
 *
 * O teto de EMPENHO (e reforço) é o saldo da DOTAÇÃO — validado no service, não
 * aqui (a razão do empenho não conhece a dotação).
 */
export function validarLancamento(movs: MovimentoLido[], novo: NovoLancamento, ref: DatasReferencia): void {
  if (!novo.valor.greaterThan(ZERO)) {
    throw new ErroNegocio('REQUISICAO_INVALIDA', 'Valor do lançamento deve ser positivo.')
  }
  const r = resumirEmpenho(movs)

  switch (novo.tipo) {
    case 'EMPENHO':
      // Teto = saldo da dotação (no service). Sem antecessor.
      break
    case 'ESTORNO_EMPENHO':
      exigir(novo.valor.lte(r.saldoEmpenho), `Estorno de empenho (${f2(novo.valor)}) excede o saldo do empenho (${f2(r.saldoEmpenho)}).`)
      exigirAnterioridade(novo.data, ref.empenho, 'estorno de empenho', 'empenho')
      break
    case 'LIQUIDACAO':
      exigir(novo.valor.lte(r.saldoEmpenho), `Liquidação (${f2(novo.valor)}) excede o saldo do empenho (${f2(r.saldoEmpenho)}).`)
      exigirAnterioridade(novo.data, ref.empenho, 'liquidação', 'empenho')
      break
    case 'ESTORNO_LIQUIDACAO': {
      const saldo = saldoDaLiquidacao(movs, obrig(novo.liquidacaoId, 'liquidacaoId'))
      exigir(novo.valor.lte(saldo), `Estorno de liquidação (${f2(novo.valor)}) excede o saldo da liquidação (${f2(saldo)}).`)
      exigirAnterioridade(novo.data, ref.liquidacao, 'estorno de liquidação', 'liquidação')
      break
    }
    case 'PAGAMENTO': {
      const saldo = saldoDaLiquidacao(movs, obrig(novo.liquidacaoId, 'liquidacaoId'))
      exigir(novo.valor.lte(saldo), `Pagamento (${f2(novo.valor)}) excede o saldo da liquidação (${f2(saldo)}).`)
      exigirAnterioridade(novo.data, ref.liquidacao, 'pagamento', 'liquidação')
      break
    }
    case 'ESTORNO_PAGAMENTO': {
      const np = netPagoDaOrdem(movs, obrig(novo.ordemPagamentoId, 'ordemPagamentoId'))
      exigir(novo.valor.lte(np), `Estorno de pagamento (${f2(novo.valor)}) excede o pago da OP (${f2(np)}).`)
      exigirAnterioridade(novo.data, ref.ordemPagamento, 'estorno de pagamento', 'ordem de pagamento')
      break
    }
  }
}
