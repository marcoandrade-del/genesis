import { PrismaClient, Prisma } from '@prisma/client'

export type Natureza = 'DEVEDORA' | 'CREDORA' | 'MISTA'

export type SaldoConta = {
  // saldoInicial e saldoAtual vêm em "saldo devedor COM SINAL": positivo = saldo
  // devedor, negativo = saldo credor. É o que permite o rollup do balancete —
  // uma conta credora/retificadora (ex.: "(-) Depreciação Acumulada") entra
  // negativa e SUBTRAI do grupo, em vez de somar. Exibir sempre |valor| + lado.
  saldoInicial: Prisma.Decimal
  totalDebito: Prisma.Decimal // soma bruta dos débitos (sempre ≥ 0)
  totalCredito: Prisma.Decimal // soma bruta dos créditos (sempre ≥ 0)
  saldoAtual: Prisma.Decimal
  // Atributos PCASP da conta (do modelo padrão; NÃO agregam — valem por conta).
  natureza: Natureza | null
  naturezaInformacao: string | null
  superavitFinanceiro: string | null
  funcao: string | null
}

/** Nó com os valores PRÓPRIOS de uma conta (sem agregação dos filhos). */
export type NoSaldo = {
  id: string
  parentId: string | null
  inicial: Prisma.Decimal // magnitude armazenada (≥ 0); o lado vem da natureza
  debito: Prisma.Decimal
  credito: Prisma.Decimal
  natureza: Natureza | null
  naturezaInformacao: string | null
  superavitFinanceiro: string | null
  funcao: string | null
}

const D = (v: Prisma.Decimal.Value = 0) => new Prisma.Decimal(v)

/** Saldo inicial em termos de DÉBITO (com sinal): conta credora entra negativa. */
function inicialDevedor(no: NoSaldo): Prisma.Decimal {
  return no.natureza === 'CREDORA' ? no.inicial.negated() : no.inicial
}

/**
 * Agrega os saldos pela árvore (balancete), em SALDO DEVEDOR COM SINAL. Em
 * termos de débito, todo débito soma e todo crédito subtrai (universal, sem
 * ramo por natureza); a natureza entra só para dar o sinal do saldo inicial.
 * Assim o saldo de uma sintética = soma (com sinal) dos filhos, e contas
 * credoras/retificadoras subtraem do grupo — o jeito certo de fechar o balancete.
 */
export function rollupSaldos(nos: NoSaldo[]): Map<string, SaldoConta> {
  const porId = new Map(nos.map((n) => [n.id, n]))
  const filhos = new Map<string, string[]>()
  for (const n of nos) {
    if (n.parentId && porId.has(n.parentId)) {
      const arr = filhos.get(n.parentId) ?? []
      arr.push(n.id)
      filhos.set(n.parentId, arr)
    }
  }

  const memo = new Map<string, SaldoConta>()
  const calc = (id: string): SaldoConta => {
    const cache = memo.get(id)
    if (cache) return cache
    const no = porId.get(id)!
    let inicial = inicialDevedor(no)
    let debito = no.debito
    let credito = no.credito
    let atual = inicial.plus(no.debito).minus(no.credito)
    for (const f of filhos.get(id) ?? []) {
      const cf = calc(f)
      inicial = inicial.plus(cf.saldoInicial)
      debito = debito.plus(cf.totalDebito)
      credito = credito.plus(cf.totalCredito)
      atual = atual.plus(cf.saldoAtual)
    }
    const r: SaldoConta = {
      saldoInicial: inicial, totalDebito: debito, totalCredito: credito, saldoAtual: atual,
      natureza: no.natureza, naturezaInformacao: no.naturezaInformacao,
      superavitFinanceiro: no.superavitFinanceiro, funcao: no.funcao,
    }
    memo.set(id, r)
    return r
  }
  for (const n of nos) calc(n.id)
  return memo
}

/**
 * Saldos contábeis de uma entidade/exercício. O saldo atual é calculado até uma
 * data de referência (default: hoje), somando os lançamentos até a data; o sinal
 * segue a natureza da conta (lida do modelo padrão via `modeloContaId`).
 */
export class SaldoContabilService {
  constructor(private prisma: PrismaClient) {}

  async calcular(entidadeId: string, ano: number, dataRef: Date): Promise<Map<string, SaldoConta>> {
    const contas = await this.prisma.contaContabilEntidade.findMany({
      where: { entidadeId, ano },
      select: { id: true, parentId: true, modeloContaId: true },
    })

    // Natureza vem do modelo padrão (ContaContabilEntidade não tem o campo).
    const modeloIds = [...new Set(contas.map((c) => c.modeloContaId).filter((x): x is string => !!x))]
    const modelos = modeloIds.length
      ? await this.prisma.conta.findMany({
          where: { id: { in: modeloIds } },
          select: { id: true, naturezaSaldo: true, naturezaInformacao: true, superavitFinanceiro: true, funcao: true },
        })
      : []
    const atribPorModelo = new Map(modelos.map((m) => [m.id, m]))

    const iniciais = await this.prisma.saldoInicialAno.findMany({
      where: { entidadeId, ano },
      select: { contaId: true, valor: true },
    })
    const inicialPorConta = new Map(iniciais.map((s) => [s.contaId, s.valor]))

    // Débito/crédito acumulados até a data, direto dos lançamentos (precisão diária).
    const movs = await this.prisma.lancamentoItem.groupBy({
      by: ['contaId', 'tipo'],
      where: { lancamento: { entidadeId, data: { lte: dataRef } } },
      _sum: { valor: true },
    })
    const debPorConta = new Map<string, Prisma.Decimal>()
    const credPorConta = new Map<string, Prisma.Decimal>()
    for (const m of movs) {
      const alvo = m.tipo === 'DEBITO' ? debPorConta : credPorConta
      alvo.set(m.contaId, m._sum.valor ?? D())
    }

    const nos: NoSaldo[] = contas.map((c) => {
      const m = c.modeloContaId ? atribPorModelo.get(c.modeloContaId) : null
      return {
        id: c.id,
        parentId: c.parentId,
        inicial: inicialPorConta.get(c.id) ?? D(),
        debito: debPorConta.get(c.id) ?? D(),
        credito: credPorConta.get(c.id) ?? D(),
        natureza: (m?.naturezaSaldo as Natureza | null) ?? null,
        naturezaInformacao: m?.naturezaInformacao ?? null,
        superavitFinanceiro: m?.superavitFinanceiro ?? null,
        funcao: m?.funcao ?? null,
      }
    })
    return rollupSaldos(nos)
  }
}
