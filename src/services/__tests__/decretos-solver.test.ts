import { describe, it, expect } from 'vitest'
import {
  filtrarPendentes,
  montarMovimentosPorDecreto,
  montarRegistrosPorDotacao,
  ordenarPorViabilidade,
  parseDespesaDecreto,
  resolverDeltasPendentes,
  type ItemPortalDecreto,
} from '../decretos-solver.js'

const item = (over: Partial<ItemPortalDecreto>): ItemPortalDecreto => ({
  despesa: '02.010.04.122.0002.2.001.3.3.90.30.00.00',
  valorInicial: 100,
  valor: 900,
  saldoAtualizado: 1000,
  decreto: '1/2026',
  natureza: 'Suplementar',
  fonteRecurso: 1000,
  sequencia: 1,
  ...over,
})
const KF = '02.010.04.122.0002.2.001.3.3.90.30.00.00|1000'

describe('decretos-solver', () => {
  it('parseDespesaDecreto: 13 segmentos com ação composta; outro formato → null', () => {
    expect(parseDespesaDecreto('02.010.04.122.0002.2.001.3.3.90.30.00.00')).toEqual({
      uo: '02.010', funcao: '04', subfuncao: '122', programa: '0002', acao: '2001', conta: '3.3.90.30.00.00',
    })
    expect(parseDespesaDecreto('02.010.04.122')).toBeNull()
  })

  it('montarRegistros: par {std, alt} por natureza; null/null vira o rótulo S/N; zero é pulado', () => {
    const porDot = montarRegistrosPorDotacao(
      [
        item({ natureza: 'Suplementar', valor: 900, valorInicial: 100 }),
        item({ natureza: 'Reduzida', valor: 900, valorInicial: 100, decreto: 'null/null' }),
        item({ valor: 0, valorInicial: 0, decreto: '9/2026' }),
      ],
      'S/N-X',
    )
    const regs = porDot.get(KF)!
    expect(regs).toHaveLength(2) // o zerado saiu
    expect(regs[0]).toMatchObject({ dec: '1/2026', std: 90000, alt: 10000, atual: 100000 })
    expect(regs[1]).toMatchObject({ dec: 'S/N-X', std: -10000, alt: -90000 })
  })

  it('filtrarPendentes remove lançados; dotação sem pendência some', () => {
    const porDot = montarRegistrosPorDotacao([item({}), item({ decreto: '2/2026' })], 'S/N')
    filtrarPendentes(porDot, new Set(['1/2026']))
    expect(porDot.get(KF)!.map((r) => r.dec)).toEqual(['2/2026'])
    filtrarPendentes(porDot, new Set(['2/2026']))
    expect(porDot.size).toBe(0)
  })

  it('resolver: fecha no padrão quando Σ std = atual − base', () => {
    const porDot = montarRegistrosPorDotacao([item({ valor: 300, valorInicial: 700 })], 'S/N')
    const r = resolverDeltasPendentes(porDot, () => 70000) // base 700 + 300 = 1000 ✓
    expect(r).toMatchObject({ fechaStd: 1, fechaFlip: 0 })
    expect(porDot.get(KF)![0]!.deltaFinal).toBe(30000)
  })

  it('resolver: usa o flip (alt) quando o padrão não fecha', () => {
    // Suplementar: std=+val=300, alt=+ini=700; base 300 → precisa +700 (flip)
    const porDot = montarRegistrosPorDotacao([item({ valor: 300, valorInicial: 700 })], 'S/N')
    const r = resolverDeltasPendentes(porDot, () => 30000)
    expect(r).toMatchObject({ fechaStd: 0, fechaFlip: 1 })
    expect(porDot.get(KF)![0]!.deltaFinal).toBe(70000)
  })

  it('resolver: sem combinação exata → ajuste com resíduo explícito (deltas ficam no padrão)', () => {
    const porDot = montarRegistrosPorDotacao([item({ valor: 300, valorInicial: 800 })], 'S/N')
    const r = resolverDeltasPendentes(porDot, () => 0) // alvo 1000; opções ±300/±800 não fecham
    expect(r.ajustes).toHaveLength(1)
    expect(r.ajustes[0]!.residuo).toBe(100000 - 30000)
    expect(porDot.get(KF)![0]!.deltaFinal).toBe(30000)
  })

  it('montarMovimentos: netting por dotação dentro do decreto; ajustes entram no S/N', () => {
    const porDot = montarRegistrosPorDotacao(
      [item({ valor: 500, valorInicial: 500 }), item({ natureza: 'Reduzida', valorInicial: 200, valor: 800 })],
      'S/N',
    )
    // mesmo decreto 1/2026: +500 e −200 → net REFORCO 300
    const regs = porDot.get(KF)!
    regs[0]!.deltaFinal = 50000
    regs[1]!.deltaFinal = -20000
    const mov = montarMovimentosPorDecreto(porDot, [{ kf: KF, dims: regs[0]!.dims, fonte: '1000', residuo: -7000 }], 'S/N-NOVO')
    expect(mov.get('1/2026')).toEqual([expect.objectContaining({ operacao: 'REFORCO', valor: 30000 })])
    expect(mov.get('S/N-NOVO')).toEqual([expect.objectContaining({ operacao: 'ANULACAO', valor: 7000 })])
  })

  it('ordenarPorViabilidade adia anulação até o reforço chegar; impossível → null', () => {
    const dims = parseDespesaDecreto('02.010.04.122.0002.2.001.3.3.90.30.00.00')!
    const mov = new Map([
      ['1/2026', [{ kf: KF, dims, fonte: '1000', operacao: 'ANULACAO' as const, valor: 500 }]],
      ['2/2026', [{ kf: KF, dims, fonte: '1000', operacao: 'REFORCO' as const, valor: 400 }]],
    ])
    // abre 200: 1/2026 (anula 500) só cabe DEPOIS do reforço de 2/2026
    expect(ordenarPorViabilidade(['1/2026', '2/2026'], mov, () => 200)).toEqual(['2/2026', '1/2026'])
    // abre 50: nem com o reforço (450 < 500) → null
    expect(ordenarPorViabilidade(['1/2026', '2/2026'], mov, () => 50)).toBeNull()
  })
})
