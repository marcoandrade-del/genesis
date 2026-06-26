import { PrismaClient, Prisma, type TipoMovimentoEmpenho } from '@prisma/client'

const D0 = () => new Prisma.Decimal(0)

export type DiaDespesa = {
  data: Date
  empenhadoDia: Prisma.Decimal // líquido do dia (EMPENHO − ESTORNO_EMPENHO)
  empenhadoAcumulado: Prisma.Decimal
  liquidadoDia: Prisma.Decimal // LIQUIDACAO − ESTORNO_LIQUIDACAO
  liquidadoAcumulado: Prisma.Decimal
  pagoDia: Prisma.Decimal // PAGAMENTO − ESTORNO_PAGAMENTO
  pagoAcumulado: Prisma.Decimal
}

export type SerieDespesaDiaria = {
  temOrcamento: boolean
  fixadoTotal: Prisma.Decimal
  empenhadoTotal: Prisma.Decimal
  liquidadoTotal: Prisma.Decimal
  pagoTotal: Prisma.Decimal
  dias: DiaDespesa[]
}

/** Recorte da série: intervalo de datas (dentro do exercício) e/ou contas de despesa. */
export type FiltroSerieDespesa = { de?: Date; ate?: Date; contaIds?: string[] }

// Cada movimento cai numa fase (emp/liq/pag) e soma ou subtrai (estorno) o líquido do dia.
const SINAL: Record<TipoMovimentoEmpenho, { campo: 'emp' | 'liq' | 'pag'; sinal: 1 | -1 }> = {
  EMPENHO: { campo: 'emp', sinal: 1 },
  ESTORNO_EMPENHO: { campo: 'emp', sinal: -1 },
  LIQUIDACAO: { campo: 'liq', sinal: 1 },
  ESTORNO_LIQUIDACAO: { campo: 'liq', sinal: -1 },
  PAGAMENTO: { campo: 'pag', sinal: 1 },
  ESTORNO_PAGAMENTO: { campo: 'pag', sinal: -1 },
}

/**
 * Acumulado diário da DESPESA: a evolução do empenhado/liquidado/pago dia a dia
 * (vs. o fixado), lida direto dos `MovimentoEmpenho` — que já são o ledger datado
 * da execução da despesa (uma linha por empenho/liquidação/pagamento e estornos).
 * Não precisa de tabela materializada, como o acumulado da receita (#113).
 *
 * Cada fase acumula INDEPENDENTE (empenhado ⊇ liquidado ⊇ pago no fim do ciclo,
 * mas dia a dia podem andar em ritmos diferentes), com estorno subtraindo.
 */
export class DespesaDiariaService {
  constructor(private prisma: PrismaClient) {}

  async serie(entidadeId: string, ano: number, filtro: FiltroSerieDespesa = {}): Promise<SerieDespesaDiaria> {
    const orcamento = await this.prisma.orcamento.findUnique({
      where: { entidadeId_ano: { entidadeId, ano } },
      select: { id: true },
    })
    if (!orcamento) {
      return { temOrcamento: false, fixadoTotal: D0(), empenhadoTotal: D0(), liquidadoTotal: D0(), pagoTotal: D0(), dias: [] }
    }

    const contaWhere = filtro.contaIds?.length ? { contaDespesaEntidadeId: { in: filtro.contaIds } } : {}
    const dataWhere =
      filtro.de || filtro.ate
        ? { data: { ...(filtro.de ? { gte: filtro.de } : {}), ...(filtro.ate ? { lte: filtro.ate } : {}) } }
        : {}

    const fix = await this.prisma.dotacaoDespesa.aggregate({
      where: { orcamentoId: orcamento.id, ...contaWhere },
      _sum: { valorAutorizado: true },
    })
    const fixadoTotal = fix._sum.valorAutorizado ?? D0()

    const movs = await this.prisma.movimentoEmpenho.groupBy({
      by: ['data', 'tipo'],
      where: { empenho: { dotacaoDespesa: { orcamentoId: orcamento.id, ...contaWhere } }, ...dataWhere },
      _sum: { valor: true },
    })

    // Líquido por dia, por fase: o tipo soma, o estorno da fase subtrai.
    const porData = new Map<number, { emp: Prisma.Decimal; liq: Prisma.Decimal; pag: Prisma.Decimal }>()
    for (const m of movs) {
      const t = m.data.getTime()
      const linha = porData.get(t) ?? { emp: D0(), liq: D0(), pag: D0() }
      const { campo, sinal } = SINAL[m.tipo]
      const v = m._sum.valor ?? D0()
      linha[campo] = sinal === 1 ? linha[campo].plus(v) : linha[campo].minus(v)
      porData.set(t, linha)
    }

    let accE = D0()
    let accL = D0()
    let accP = D0()
    const dias: DiaDespesa[] = [...porData.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([t, n]) => {
        accE = accE.plus(n.emp)
        accL = accL.plus(n.liq)
        accP = accP.plus(n.pag)
        return {
          data: new Date(t),
          empenhadoDia: n.emp,
          empenhadoAcumulado: accE,
          liquidadoDia: n.liq,
          liquidadoAcumulado: accL,
          pagoDia: n.pag,
          pagoAcumulado: accP,
        }
      })

    return { temOrcamento: true, fixadoTotal, empenhadoTotal: accE, liquidadoTotal: accL, pagoTotal: accP, dias }
  }
}
