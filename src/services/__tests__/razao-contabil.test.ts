import { describe, it, expect } from 'vitest'
import { Prisma } from '@prisma/client'
import { montarRazao, RazaoContabilService, type ItemRazao } from '../razao-contabil.js'
import { criarPrismaMock } from './helpers/prisma-mock.js'

const D = (v: number) => new Prisma.Decimal(v)
const dia = (n: number) => new Date(Date.UTC(2026, 2, n)) // março/2026
const item = (n: number, deb: number, cred: number): ItemRazao => ({ data: dia(n), historico: 'x', debito: D(deb), credito: D(cred) })

describe('montarRazao', () => {
  it('DEVEDORA: saldo corrente acumula débito − crédito', () => {
    const r = montarRazao(D(100), 'DEVEDORA', [item(5, 50, 0), item(10, 0, 20), item(10, 30, 0)])
    expect(r.movimentos.map((m) => m.saldo.toNumber())).toEqual([150, 130, 160])
    expect(r.totalDebito.toNumber()).toBe(80)
    expect(r.totalCredito.toNumber()).toBe(20)
    expect(r.saldoFinal.toNumber()).toBe(160)
  })

  it('CREDORA: inverte o sinal', () => {
    const r = montarRazao(D(0), 'CREDORA', [item(1, 0, 100), item(2, 30, 0)])
    // +100, depois −30
    expect(r.movimentos.map((m) => m.saldo.toNumber())).toEqual([100, 70])
    expect(r.saldoFinal.toNumber()).toBe(70)
  })

  it('agrupa totais por dia', () => {
    const r = montarRazao(D(0), 'DEVEDORA', [item(5, 50, 0), item(10, 0, 20), item(10, 30, 0)])
    expect(r.totaisPorDia).toEqual([
      { dia: 5, debito: D(50), credito: D(0) },
      { dia: 10, debito: D(30), credito: D(20) },
    ])
  })

  it('sem movimentos: saldo final = saldo anterior', () => {
    const r = montarRazao(D(250), 'DEVEDORA', [])
    expect(r.saldoFinal.toNumber()).toBe(250)
    expect(r.movimentos).toHaveLength(0)
    expect(r.totaisPorDia).toHaveLength(0)
  })
})

describe('RazaoContabilService.razaoDoPeriodo', () => {
  it('soma saldo anterior (movimentos antes do início) e os do período', async () => {
    const prisma = criarPrismaMock()
    const svc = new RazaoContabilService(prisma as never)
    prisma.saldoInicialAno.findUnique.mockResolvedValue({ valor: D(100) })
    prisma.lancamentoItem.groupBy.mockResolvedValue([
      { tipo: 'DEBITO', _sum: { valor: D(50) } },
      { tipo: 'CREDITO', _sum: { valor: D(20) } },
    ])
    prisma.lancamentoItem.findMany.mockResolvedValue([
      { tipo: 'DEBITO', valor: D(30), lancamento: { data: dia(10), historico: 'x', origemTipo: null, origemId: null, eventoCodigo: null } },
      { tipo: 'CREDITO', valor: D(10), lancamento: { data: dia(12), historico: 'y', origemTipo: null, origemId: null, eventoCodigo: null } },
    ])
    const r = await svc.razaoDoPeriodo('ent1', 'c1', 2026, 'DEVEDORA', dia(1), dia(30))
    expect(r.saldoAnterior.toNumber()).toBe(130) // 100 + (50 − 20)
    expect(r.saldoFinal.toNumber()).toBe(150) // 130 + 30 − 10
    expect(prisma.lancamentoItem.findMany.mock.calls[0]![0].where.lancamento.data).toEqual({ gte: dia(1), lte: dia(30) })
  })

  it('trata _sum nulo nos movimentos anteriores como zero', async () => {
    const prisma = criarPrismaMock()
    const svc = new RazaoContabilService(prisma as never)
    prisma.saldoInicialAno.findUnique.mockResolvedValue({ valor: D(0) })
    prisma.lancamentoItem.groupBy.mockResolvedValue([
      { tipo: 'DEBITO', _sum: { valor: null } },
      { tipo: 'CREDITO', _sum: { valor: null } },
    ])
    prisma.lancamentoItem.findMany.mockResolvedValue([])
    const r = await svc.razaoDoPeriodo('ent1', 'c1', 2026, 'DEVEDORA', dia(1), dia(30))
    expect(r.saldoAnterior.toNumber()).toBe(0)
  })

  it('sem de/ate cobre o exercício e trata saldo inicial ausente', async () => {
    const prisma = criarPrismaMock()
    const svc = new RazaoContabilService(prisma as never)
    prisma.saldoInicialAno.findUnique.mockResolvedValue(null)
    prisma.lancamentoItem.groupBy.mockResolvedValue([])
    prisma.lancamentoItem.findMany.mockResolvedValue([])
    const r = await svc.razaoDoPeriodo('ent1', 'c1', 2026, 'DEVEDORA')
    expect(r.saldoAnterior.toNumber()).toBe(0)
    const w = prisma.lancamentoItem.findMany.mock.calls[0]![0].where.lancamento.data
    expect(w.gte).toEqual(new Date(Date.UTC(2026, 0, 1)))
    expect(w.lte).toEqual(new Date(Date.UTC(2026, 11, 31)))
  })
})
