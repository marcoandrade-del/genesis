import { PrismaClient, Prisma } from '@prisma/client'
import type { Natureza } from './saldo-contabil.js'

const D0 = () => new Prisma.Decimal(0)

export type DiaSaldo = {
  data: Date
  debito: Prisma.Decimal
  credito: Prisma.Decimal
  /** Saldo corrido no lado NATURAL da conta (mesma convenção do razão). */
  saldoAcumulado: Prisma.Decimal
}

export type SerieDiaria = {
  natureza: Natureza | null
  saldoInicial: Prisma.Decimal
  dias: DiaSaldo[]
  totalDebito: Prisma.Decimal
  totalCredito: Prisma.Decimal
  saldoFinal: Prisma.Decimal
}

/** Variação do saldo por um movimento, conforme a natureza (CREDORA inverte). */
function delta(natureza: Natureza | null, debito: Prisma.Decimal, credito: Prisma.Decimal): Prisma.Decimal {
  return natureza === 'CREDORA' ? credito.minus(debito) : debito.minus(credito)
}

/**
 * Acumulado diário de uma conta contábil, a partir do agregado materializado
 * `MovimentoDiarioConta` (não re-soma os lançamentos). Devolve o saldo corrido
 * dia a dia no lado natural da conta — a "evolução diária" do saldo no exercício.
 */
export class SaldoDiarioService {
  constructor(private prisma: PrismaClient) {}

  async serie(entidadeId: string, contaId: string, ano: number): Promise<SerieDiaria> {
    const conta = await this.prisma.contaContabilEntidade.findUnique({
      where: { id: contaId },
      select: { modeloContaId: true },
    })
    let natureza: Natureza | null = null
    if (conta?.modeloContaId) {
      const m = await this.prisma.conta.findUnique({ where: { id: conta.modeloContaId }, select: { naturezaSaldo: true } })
      natureza = (m?.naturezaSaldo as Natureza | null) ?? null
    }

    const inicialRow = await this.prisma.saldoInicialAno.findUnique({
      where: { entidadeId_contaId_ano: { entidadeId, contaId, ano } },
      select: { valor: true },
    })
    const saldoInicial = inicialRow?.valor ?? D0()

    const rows = await this.prisma.movimentoDiarioConta.findMany({
      where: { entidadeId, contaId, data: { gte: new Date(Date.UTC(ano, 0, 1)), lte: new Date(Date.UTC(ano, 11, 31)) } },
      orderBy: { data: 'asc' },
      select: { data: true, totalDebito: true, totalCredito: true },
    })

    let saldo = saldoInicial
    let totalDebito = D0()
    let totalCredito = D0()
    const dias: DiaSaldo[] = rows.map((r) => {
      totalDebito = totalDebito.plus(r.totalDebito)
      totalCredito = totalCredito.plus(r.totalCredito)
      saldo = saldo.plus(delta(natureza, r.totalDebito, r.totalCredito))
      return { data: r.data, debito: r.totalDebito, credito: r.totalCredito, saldoAcumulado: saldo }
    })

    return { natureza, saldoInicial, dias, totalDebito, totalCredito, saldoFinal: saldo }
  }
}
