import { PrismaClient, Prisma } from '@prisma/client'
import type { Natureza } from './saldo-contabil.js'

const D0 = () => new Prisma.Decimal(0)

export type ItemRazao = { data: Date; historico: string; debito: Prisma.Decimal; credito: Prisma.Decimal }
export type MovimentoRazao = ItemRazao & { saldo: Prisma.Decimal }

export type Razao = {
  natureza: Natureza | null
  saldoAnterior: Prisma.Decimal
  movimentos: MovimentoRazao[]
  totaisPorDia: { dia: number; debito: Prisma.Decimal; credito: Prisma.Decimal }[]
  totalDebito: Prisma.Decimal
  totalCredito: Prisma.Decimal
  saldoFinal: Prisma.Decimal
}

/** Variação do saldo por um movimento, conforme a natureza (CREDORA inverte). */
function delta(natureza: Natureza | null, debito: Prisma.Decimal, credito: Prisma.Decimal): Prisma.Decimal {
  return natureza === 'CREDORA' ? credito.minus(debito) : debito.minus(credito)
}

/**
 * Monta o razão a partir do saldo anterior: saldo corrente acumulado por
 * movimento (na ordem dada), totais e o resumo por dia. Função pura — toda a
 * aritmética do razão fica testável sem banco.
 */
export function montarRazao(saldoAnterior: Prisma.Decimal, natureza: Natureza | null, itens: ItemRazao[]): Razao {
  let saldo = saldoAnterior
  let totalDebito = D0()
  let totalCredito = D0()
  const porDia = new Map<number, { debito: Prisma.Decimal; credito: Prisma.Decimal }>()

  const movimentos: MovimentoRazao[] = itens.map((it) => {
    totalDebito = totalDebito.plus(it.debito)
    totalCredito = totalCredito.plus(it.credito)
    saldo = saldo.plus(delta(natureza, it.debito, it.credito))
    const dia = it.data.getUTCDate()
    const acc = porDia.get(dia) ?? { debito: D0(), credito: D0() }
    porDia.set(dia, { debito: acc.debito.plus(it.debito), credito: acc.credito.plus(it.credito) })
    return { ...it, saldo }
  })

  const totaisPorDia = [...porDia.entries()].sort((a, b) => a[0] - b[0]).map(([dia, v]) => ({ dia, ...v }))
  return { natureza, saldoAnterior, movimentos, totaisPorDia, totalDebito, totalCredito, saldoFinal: saldo }
}

/**
 * Razão (livro de movimentações) de uma conta contábil analítica. Base do
 * drill-down do plano de contas: resumo mensal → total por dia → razão do mês.
 */
export class RazaoContabilService {
  constructor(private prisma: PrismaClient) {}

  /** Débito/crédito por mês (1..12) da conta no ano, a partir do agregado mensal. */
  async resumoMensal(entidadeId: string, contaId: string, ano: number) {
    const linhas = await this.prisma.resumoMensalConta.findMany({
      where: { entidadeId, contaId, ano },
      select: { mes: true, totalDebito: true, totalCredito: true },
    })
    const porMes = new Map(linhas.map((l) => [l.mes, l]))
    return Array.from({ length: 12 }, (_, i) => {
      const m = porMes.get(i + 1)
      return { mes: i + 1, debito: m?.totalDebito ?? D0(), credito: m?.totalCredito ?? D0() }
    })
  }

  /** Razão da conta num mês, com saldo anterior, saldo corrente e totais por dia. */
  async razaoDoMes(entidadeId: string, contaId: string, ano: number, mes: number, natureza: Natureza | null): Promise<Razao> {
    const mesInicio = new Date(Date.UTC(ano, mes - 1, 1))
    const mesFim = new Date(Date.UTC(ano, mes, 1)) // exclusivo

    const inicialRow = await this.prisma.saldoInicialAno.findUnique({
      where: { entidadeId_contaId_ano: { entidadeId, contaId, ano } },
      select: { valor: true },
    })
    const saldoInicial = inicialRow?.valor ?? D0()

    const antes = await this.prisma.lancamentoItem.groupBy({
      by: ['tipo'],
      where: { contaId, lancamento: { entidadeId, data: { lt: mesInicio } } },
      _sum: { valor: true },
    })
    let dAntes = D0()
    let cAntes = D0()
    for (const a of antes) {
      if (a.tipo === 'DEBITO') dAntes = a._sum.valor ?? D0()
      else cAntes = a._sum.valor ?? D0()
    }
    const saldoAnterior = saldoInicial.plus(delta(natureza, dAntes, cAntes))

    const itensDb = await this.prisma.lancamentoItem.findMany({
      where: { contaId, lancamento: { entidadeId, data: { gte: mesInicio, lt: mesFim } } },
      select: { tipo: true, valor: true, lancamento: { select: { data: true, historico: true } } },
      orderBy: [{ lancamento: { data: 'asc' } }, { id: 'asc' }],
    })

    const itens: ItemRazao[] = itensDb.map((it) => ({
      data: it.lancamento.data,
      historico: it.lancamento.historico,
      debito: it.tipo === 'DEBITO' ? it.valor : D0(),
      credito: it.tipo === 'CREDITO' ? it.valor : D0(),
    }))

    return montarRazao(saldoAnterior, natureza, itens)
  }
}
