import { describe, it, expect } from 'vitest'
import { Prisma } from '@prisma/client'
import { rollupSaldos, type NoSaldo } from '../saldo-contabil.js'

const D = (v: number) => new Prisma.Decimal(v)
const no = (p: Partial<NoSaldo> & { id: string }): NoSaldo => ({
  parentId: null, inicial: D(0), debito: D(0), credito: D(0), natureza: 'DEVEDORA', ...p,
})

describe('rollupSaldos', () => {
  it('folha DEVEDORA: saldo = inicial + (débito − crédito)', () => {
    const m = rollupSaldos([no({ id: 'a', inicial: D(100), debito: D(50), credito: D(20) })])
    expect(m.get('a')!.saldoAtual.toNumber()).toBe(130)
  })

  it('folha CREDORA: inverte o sinal de (débito − crédito)', () => {
    const m = rollupSaldos([no({ id: 'b', natureza: 'CREDORA', inicial: D(0), debito: D(10), credito: D(40) })])
    // 0 − (10 − 40) = 30
    expect(m.get('b')!.saldoAtual.toNumber()).toBe(30)
  })

  it('sintética soma os filhos (balancete), com naturezas mistas', () => {
    const m = rollupSaldos([
      no({ id: 'p', natureza: 'DEVEDORA' }), // sintética, sem movimento próprio
      no({ id: 'a', parentId: 'p', natureza: 'DEVEDORA', inicial: D(100), debito: D(50), credito: D(20) }), // 130
      no({ id: 'b', parentId: 'p', natureza: 'CREDORA', inicial: D(0), debito: D(10), credito: D(40) }), // 30
    ])
    const p = m.get('p')!
    expect(p.saldoInicial.toNumber()).toBe(100)
    expect(p.totalDebito.toNumber()).toBe(60)
    expect(p.totalCredito.toNumber()).toBe(60)
    expect(p.saldoAtual.toNumber()).toBe(160) // 130 + 30
  })

  it('rollup em 3 níveis', () => {
    const m = rollupSaldos([
      no({ id: 'raiz' }),
      no({ id: 'meio', parentId: 'raiz' }),
      no({ id: 'folha', parentId: 'meio', inicial: D(0), debito: D(70), credito: D(0) }), // 70
    ])
    expect(m.get('meio')!.saldoAtual.toNumber()).toBe(70)
    expect(m.get('raiz')!.saldoAtual.toNumber()).toBe(70)
    expect(m.get('raiz')!.totalDebito.toNumber()).toBe(70)
  })
})
