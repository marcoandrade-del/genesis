import { describe, it, expect } from 'vitest'
import { Prisma } from '@prisma/client'
import { rollupSaldos, type NoSaldo } from '../saldo-contabil.js'

const D = (v: number) => new Prisma.Decimal(v)
const no = (p: Partial<NoSaldo> & { id: string }): NoSaldo => ({
  parentId: null, inicial: D(0), debito: D(0), credito: D(0), natureza: 'DEVEDORA', ...p,
})

// Saldos vêm em "saldo devedor COM SINAL": + = devedor, − = credor.
describe('rollupSaldos (balancete, saldo devedor com sinal)', () => {
  it('folha DEVEDORA: inicial + débito − crédito (positivo = devedor)', () => {
    const m = rollupSaldos([no({ id: 'a', inicial: D(100), debito: D(50), credito: D(20) })])
    expect(m.get('a')!.saldoAtual.toNumber()).toBe(130)
  })

  it('folha CREDORA: saldo credor sai NEGATIVO em termos de débito', () => {
    // inicialDevedor(0)=0; movimento universal: 0 + 10 − 40 = −30 (credor 30)
    const m = rollupSaldos([no({ id: 'b', natureza: 'CREDORA', inicial: D(0), debito: D(10), credito: D(40) })])
    expect(m.get('b')!.saldoAtual.toNumber()).toBe(-30)
  })

  it('conta retificadora (credora) SUBTRAI do grupo, não soma', () => {
    // ATIVO = CAIXA (devedora, +1000) + (-) Depreciação (credora, crédito 300 → −300)
    const m = rollupSaldos([
      no({ id: 'ativo', natureza: 'DEVEDORA' }),
      no({ id: 'caixa', parentId: 'ativo', natureza: 'DEVEDORA', debito: D(1000) }),
      no({ id: 'deprec', parentId: 'ativo', natureza: 'CREDORA', credito: D(300) }),
    ])
    expect(m.get('caixa')!.saldoAtual.toNumber()).toBe(1000)
    expect(m.get('deprec')!.saldoAtual.toNumber()).toBe(-300)
    expect(m.get('ativo')!.saldoAtual.toNumber()).toBe(700) // 1000 − 300, NÃO 1300
  })

  it('saldo inicial de conta credora também entra negativo no rollup', () => {
    const m = rollupSaldos([
      no({ id: 'p', natureza: 'DEVEDORA' }),
      no({ id: 'd', parentId: 'p', natureza: 'DEVEDORA', inicial: D(100) }),
      no({ id: 'c', parentId: 'p', natureza: 'CREDORA', inicial: D(40) }),
    ])
    expect(m.get('p')!.saldoInicial.toNumber()).toBe(60) // 100 − 40
  })

  it('totais de débito/crédito são somas BRUTAS (sempre ≥ 0) e rollup soma', () => {
    const m = rollupSaldos([
      no({ id: 'p', natureza: 'DEVEDORA' }),
      no({ id: 'a', parentId: 'p', natureza: 'DEVEDORA', debito: D(50), credito: D(20) }),
      no({ id: 'b', parentId: 'p', natureza: 'CREDORA', debito: D(10), credito: D(40) }),
    ])
    const p = m.get('p')!
    expect(p.totalDebito.toNumber()).toBe(60)
    expect(p.totalCredito.toNumber()).toBe(60)
    expect(p.saldoAtual.toNumber()).toBe(0) // (50−20) + (10−40) = 30 − 30
  })

  it('rollup em 3 níveis propaga o saldo com sinal', () => {
    const m = rollupSaldos([
      no({ id: 'raiz' }),
      no({ id: 'meio', parentId: 'raiz' }),
      no({ id: 'folha', parentId: 'meio', debito: D(70) }),
    ])
    expect(m.get('meio')!.saldoAtual.toNumber()).toBe(70)
    expect(m.get('raiz')!.saldoAtual.toNumber()).toBe(70)
  })
})
