import { PrismaClient, Prisma } from '@prisma/client'

const D0 = () => new Prisma.Decimal(0)

export type DiaReceita = {
  data: Date
  arrecadadoDia: Prisma.Decimal // líquido do dia (ARRECADACAO − ESTORNO)
  arrecadadoAcumulado: Prisma.Decimal
}

export type SerieReceitaDiaria = {
  temOrcamento: boolean
  previstoTotal: Prisma.Decimal
  arrecadadoTotal: Prisma.Decimal
  dias: DiaReceita[]
}

/** Recorte da série: intervalo de datas (dentro do exercício) e/ou contas selecionadas. */
export type FiltroSerie = { de?: Date; ate?: Date; contaIds?: string[] }

/**
 * Acumulado diário da RECEITA: a evolução do arrecadado dia a dia (vs. o previsto),
 * lida direto das `Arrecadacao` — que já são o ledger datado da execução da receita
 * (uma linha por arrecadação/estorno). Não precisa de tabela materializada.
 */
export class ArrecadacaoDiariaService {
  constructor(private prisma: PrismaClient) {}

  async serie(entidadeId: string, ano: number, filtro: FiltroSerie = {}): Promise<SerieReceitaDiaria> {
    const orcamento = await this.prisma.orcamento.findUnique({
      where: { entidadeId_ano: { entidadeId, ano } },
      select: { id: true },
    })
    if (!orcamento) return { temOrcamento: false, previstoTotal: D0(), arrecadadoTotal: D0(), dias: [] }

    // Filtro de contas (receita) aplicado à previsão e à arrecadação.
    const contaWhere = filtro.contaIds?.length ? { contaReceitaEntidadeId: { in: filtro.contaIds } } : {}
    // Intervalo de datas dentro do exercício.
    const dataWhere =
      filtro.de || filtro.ate
        ? { data: { ...(filtro.de ? { gte: filtro.de } : {}), ...(filtro.ate ? { lte: filtro.ate } : {}) } }
        : {}

    const prev = await this.prisma.previsaoReceita.aggregate({
      where: { orcamentoId: orcamento.id, ...contaWhere },
      _sum: { valorPrevisto: true },
    })
    const previstoTotal = prev._sum.valorPrevisto ?? D0()

    const movs = await this.prisma.arrecadacao.groupBy({
      by: ['data', 'tipo'],
      where: { previsao: { orcamentoId: orcamento.id, ...contaWhere }, ...dataWhere },
      _sum: { valor: true },
    })

    // Líquido por dia: ARRECADACAO soma, ESTORNO subtrai.
    const porData = new Map<number, Prisma.Decimal>()
    for (const m of movs) {
      const t = m.data.getTime()
      const v = m._sum.valor ?? D0()
      const atual = porData.get(t) ?? D0()
      porData.set(t, m.tipo === 'ESTORNO' ? atual.minus(v) : atual.plus(v))
    }

    let acc = D0()
    const dias: DiaReceita[] = [...porData.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([t, net]) => {
        acc = acc.plus(net)
        return { data: new Date(t), arrecadadoDia: net, arrecadadoAcumulado: acc }
      })

    return { temOrcamento: true, previstoTotal, arrecadadoTotal: acc, dias }
  }
}
