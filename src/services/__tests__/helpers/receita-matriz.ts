import { CONTAS_EVENTO as C, TOKENS as T } from '../../motor-eventos-receita.js'
import type { PrismaMock } from './prisma-mock.js'

/** Matriz de eventos da arrecadação (espelha o seed): D/C por evento, com tokens. */
export const MATRIZ_RECEITA = [
  { codigo: '100', gatilho: 'ARRECADACAO', descricao: 'Arrecadação orçamentária', lancamentos: [{ ordem: 1, contaDebitoMascara: C.receitaRealizada, contaCreditoMascara: C.receitaARealizar }] },
  { codigo: '200', gatilho: 'ARRECADACAO', descricao: 'Disponibilidade por destinação de recursos (DDR)', lancamentos: [{ ordem: 1, contaDebitoMascara: T.DDR_CONTROLE, contaCreditoMascara: C.ddrDisponibilidade }] },
  { codigo: '300', gatilho: 'ARRECADACAO', descricao: 'Variação patrimonial aumentativa (receita efetiva)', lancamentos: [{ ordem: 1, contaDebitoMascara: T.CAIXA, contaCreditoMascara: T.CONTRAPARTIDA }] },
  { codigo: '400', gatilho: 'ARRECADACAO', descricao: 'Mutação por operação de crédito (passivo)', lancamentos: [{ ordem: 1, contaDebitoMascara: T.CAIXA, contaCreditoMascara: T.CONTRAPARTIDA }] },
  { codigo: '500', gatilho: 'ARRECADACAO', descricao: 'Mutação por alienação de bens (baixa de ativo)', lancamentos: [{ ordem: 1, contaDebitoMascara: T.CAIXA, contaCreditoMascara: T.CONTRAPARTIDA }] },
  { codigo: '560', gatilho: 'ARRECADACAO', descricao: 'Arrecadação de receita lançada (baixa do crédito a receber)', lancamentos: [{ ordem: 1, contaDebitoMascara: T.CAIXA, contaCreditoMascara: T.CONTRAPARTIDA }] },
]

/** Mocka `eventoContabil.findMany` p/ devolver a matriz da arrecadação (gatilho + codigo in). */
export function mockMatrizReceita(prisma: PrismaMock) {
  prisma.eventoContabil.findMany.mockImplementation((args: never) => {
    const where = (args as { where?: { gatilho?: string; codigo?: { in?: string[] } } })?.where ?? {}
    const ins = where.codigo?.in
    return Promise.resolve(
      MATRIZ_RECEITA.filter((e) => (!where.gatilho || e.gatilho === where.gatilho) && (!ins || ins.includes(e.codigo))) as never,
    )
  })
}
