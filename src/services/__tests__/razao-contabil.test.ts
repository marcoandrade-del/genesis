import { describe, it, expect } from 'vitest'
import { Prisma } from '@prisma/client'
import { montarRazao, type ItemRazao } from '../razao-contabil.js'

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
