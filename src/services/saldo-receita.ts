import { PrismaClient } from '@prisma/client'

export interface LinhaSaldoReceita {
  previsto: number
  arrecadado: number
  saldo: number // a arrecadar = previsto − arrecadado
}
export type SaldoReceitaPorConta = Map<string, LinhaSaldoReceita>

const r2 = (n: number) => Math.round(n * 100) / 100

/**
 * Saldo por conta do plano de RECEITA: previsto (LOA) × arrecadado ATÉ a data
 * (das arrecadações datadas) = saldo a arrecadar. Faz roll-up na árvore de
 * contas (folha → ancestrais), igual ao saldo orçamentário da despesa.
 */
export class SaldoReceitaService {
  constructor(private prisma: PrismaClient) {}

  async porConta(entidadeId: string, ano: number, dataRef: Date): Promise<SaldoReceitaPorConta> {
    const mapa: SaldoReceitaPorConta = new Map()
    const orcamento = await this.prisma.orcamento.findUnique({
      where: { entidadeId_ano: { entidadeId, ano } },
      select: { id: true },
    })
    if (!orcamento) return mapa

    const contas = await this.prisma.contaReceitaEntidade.findMany({
      where: { entidadeId, ano },
      select: { id: true, parentId: true },
    })
    const parent = new Map(contas.map((c) => [c.id, c.parentId]))

    const previsto = await this.prisma.previsaoReceita.groupBy({
      by: ['contaReceitaEntidadeId'],
      where: { orcamentoId: orcamento.id },
      _sum: { valorPrevisto: true },
    })
    // Arrecadação liga à conta via `previsao` (PrevisaoReceita.contaReceitaEntidadeId);
    // Arrecadacao não tem entidadeId/contaReceitaEntidadeId diretos. Escopo por orçamento.
    const arrecadacoes = await this.prisma.arrecadacao.findMany({
      where: { previsao: { orcamentoId: orcamento.id }, data: { gte: new Date(Date.UTC(ano, 0, 1)), lte: dataRef } },
      select: { valor: true, tipo: true, previsao: { select: { contaReceitaEntidadeId: true } } },
    })

    // Roll-up: a folha e todos os ancestrais recebem o valor.
    const acumular = (contaId: string, campo: 'previsto' | 'arrecadado', v: number) => {
      let id: string | null = contaId
      const visitados = new Set<string>()
      while (id && !visitados.has(id)) {
        visitados.add(id)
        const row = mapa.get(id) ?? { previsto: 0, arrecadado: 0, saldo: 0 }
        row[campo] += v
        mapa.set(id, row)
        id = parent.get(id) ?? null
      }
    }
    for (const p of previsto) acumular(p.contaReceitaEntidadeId, 'previsto', Number(p._sum.valorPrevisto ?? 0))
    for (const a of arrecadacoes) acumular(a.previsao.contaReceitaEntidadeId, 'arrecadado', (a.tipo === 'ESTORNO' ? -1 : 1) * Number(a.valor))

    for (const row of mapa.values()) {
      row.previsto = r2(row.previsto)
      row.arrecadado = r2(row.arrecadado)
      row.saldo = r2(row.previsto - row.arrecadado)
    }
    return mapa
  }

  /**
   * Arrecadado por conta e por MÊS (jan→dez = índices 0..11), com roll-up na
   * árvore. Agrega `Arrecadacao.valor` igual ao `porConta` (a soma dos 12 meses
   * reconcilia com a coluna "Arrecadado"). Read-only. Usado no desdobramento
   * mensal/bimestral/quadrimestral da tela do plano de receita.
   */
  async arrecadadoMensal(entidadeId: string, ano: number): Promise<Map<string, number[]>> {
    const mapa = new Map<string, number[]>()
    const orcamento = await this.prisma.orcamento.findUnique({ where: { entidadeId_ano: { entidadeId, ano } }, select: { id: true } })
    if (!orcamento) return mapa
    const contas = await this.prisma.contaReceitaEntidade.findMany({
      where: { entidadeId, ano },
      select: { id: true, parentId: true },
    })
    const parent = new Map(contas.map((c) => [c.id, c.parentId]))
    // Arrecadacao liga à conta via `previsao` (não tem entidadeId/contaReceitaEntidadeId diretos).
    const arrecadacoes = await this.prisma.arrecadacao.findMany({
      where: { previsao: { orcamentoId: orcamento.id }, data: { gte: new Date(Date.UTC(ano, 0, 1)), lte: new Date(Date.UTC(ano, 11, 31)) } },
      select: { valor: true, tipo: true, data: true, previsao: { select: { contaReceitaEntidadeId: true } } },
    })
    const acumular = (contaId: string, mes: number, v: number) => {
      let id: string | null = contaId
      const visitados = new Set<string>()
      while (id && !visitados.has(id)) {
        visitados.add(id)
        const meses = mapa.get(id) ?? new Array<number>(12).fill(0)
        meses[mes] = (meses[mes] ?? 0) + v
        mapa.set(id, meses)
        id = parent.get(id) ?? null
      }
    }
    for (const a of arrecadacoes) acumular(a.previsao.contaReceitaEntidadeId, a.data.getUTCMonth(), (a.tipo === 'ESTORNO' ? -1 : 1) * Number(a.valor))
    for (const meses of mapa.values()) for (let i = 0; i < 12; i++) meses[i] = r2(meses[i] ?? 0)
    return mapa
  }
}
