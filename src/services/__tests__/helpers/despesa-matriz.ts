import { CONTAS_DESPESA as C, TOKENS as T } from '../../motor-eventos-despesa.js'
import type { PrismaMock } from './prisma-mock.js'

/**
 * Matriz de eventos da despesa (espelha o seed): cada evento com suas pernas D/C.
 * Pernas patrimoniais/financeiras usam tokens (@VPD/@PASSIVO/@CAIXA).
 */
export const MATRIZ_DESPESA = [
  { codigo: '600', gatilho: 'EMPENHO', descricao: 'Empenho — orçamentário', lancamentos: [{ ordem: 1, contaDebitoMascara: C.creditoDisponivel, contaCreditoMascara: C.empenhadoALiquidar }] },
  { codigo: '601', gatilho: 'EMPENHO', descricao: 'Empenho — controle DDR', lancamentos: [{ ordem: 1, contaDebitoMascara: C.ddrDisponivel, contaCreditoMascara: C.ddrComprEmpenho }] },
  { codigo: '700', gatilho: 'LIQUIDACAO', descricao: 'Liquidação — orçamentário', lancamentos: [{ ordem: 1, contaDebitoMascara: C.empenhadoALiquidar, contaCreditoMascara: C.liquidadoAPagar }] },
  { codigo: '701', gatilho: 'LIQUIDACAO', descricao: 'Liquidação — controle DDR', lancamentos: [{ ordem: 1, contaDebitoMascara: C.ddrComprEmpenho, contaCreditoMascara: C.ddrComprLiquidacao }] },
  { codigo: '702', gatilho: 'LIQUIDACAO', descricao: 'Liquidação — patrimonial', lancamentos: [{ ordem: 1, contaDebitoMascara: T.VPD, contaCreditoMascara: T.PASSIVO }] },
  { codigo: '800', gatilho: 'PAGAMENTO', descricao: 'Pagamento — orçamentário', lancamentos: [{ ordem: 1, contaDebitoMascara: C.liquidadoAPagar, contaCreditoMascara: C.pago }] },
  { codigo: '801', gatilho: 'PAGAMENTO', descricao: 'Pagamento — controle DDR', lancamentos: [{ ordem: 1, contaDebitoMascara: C.ddrComprLiquidacao, contaCreditoMascara: C.ddrUtilizada }] },
  { codigo: '802', gatilho: 'PAGAMENTO', descricao: 'Pagamento — financeiro', lancamentos: [{ ordem: 1, contaDebitoMascara: T.PASSIVO, contaCreditoMascara: T.CAIXA }] },
]

/** Mocka `eventoContabil.findMany` para devolver a matriz filtrada pelo gatilho. */
export function mockMatrizDespesa(prisma: PrismaMock) {
  prisma.eventoContabil.findMany.mockImplementation((args: never) => {
    const gatilho: string | undefined = (args as { where?: { gatilho?: string } })?.where?.gatilho
    return Promise.resolve(MATRIZ_DESPESA.filter((e) => !gatilho || e.gatilho === gatilho) as never)
  })
}
