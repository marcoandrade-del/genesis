import { describe, it, expect } from 'vitest'
import { agregarReceita, agregarDespesa } from '../conector.js'
import { naturezaReceita } from '../../../nucleo/pcasp.js'
import type { LinhaMsc } from '../../../siconfi/api.js'

/** Linha crua da MSC de receita (só os campos que o agregador usa). */
const l = (over: Partial<LinhaMsc>): LinhaMsc => ({
  conta_contabil: '521110000',
  poder_orgao: '10131',
  fonte_recursos: '1500',
  funcao: null,
  subfuncao: null,
  natureza_despesa: null,
  natureza_receita: '13210111',
  natureza_conta: 'D',
  valor: 0,
  ...over,
})

describe('naturezaReceita (8 díg MSC → PCASP 12 grupos)', () => {
  it('fatia pelos grupos e completa com zeros', () => {
    expect(naturezaReceita('13210111')).toBe('1.3.2.1.01.1.1.00.00.00.00.00')
    expect(naturezaReceita('17180111')).toBe('1.7.1.8.01.1.1.00.00.00.00.00')
  })
  it('já pontuada passa completando', () => {
    expect(naturezaReceita('1.7.1.8')).toBe('1.7.1.8.00.0.0.00.00.00.00.00')
  })
})

describe('agregarReceita (MSC 5.2.1.1.1 + 6.2.1.2 → LinhaReceita)', () => {
  it('funde previsão (521110000) e realizada (6212*) na mesma natureza×fonte', () => {
    const prev = [l({ conta_contabil: '521110000', valor: 1000 })]
    const real = [l({ conta_contabil: '621200000', natureza_conta: 'C', valor: 300 })]
    const m = agregarReceita(prev, real)
    expect(m).toHaveLength(1)
    expect(m[0]!.naturezaPcasp).toBe('1.3.2.1.01.1.1.00.00.00.00.00')
    expect(m[0]!.fonte.codigo).toBe('1500')
    expect(m[0]!.previsto).toBe(1000_00)
    expect(m[0]!.arrecadado).toBe(300_00)
  })

  it('fonte_recursos null vira balde "0" (não quebra o writer)', () => {
    const real = [l({ conta_contabil: '621200000', fonte_recursos: null, natureza_conta: 'C', valor: 25325.52 })]
    const [d] = agregarReceita([], real)
    expect(d!.fonte.codigo).toBe('0')
    expect(d!.arrecadado).toBe(25325_52)
  })

  it('previsto sem realizada e vice-versa coexistem', () => {
    const prev = [l({ conta_contabil: '521110000', natureza_receita: '11110000', valor: 500 })]
    const real = [l({ conta_contabil: '621200000', natureza_receita: '13210111', natureza_conta: 'C', valor: 200 })]
    const m = agregarReceita(prev, real)
    expect(m).toHaveLength(2)
    const so = m.find((x) => x.previsto !== undefined)!
    expect(so.arrecadado).toBeUndefined()
  })

  it('separa por fonte', () => {
    const prev = [
      l({ conta_contabil: '521110000', fonte_recursos: '1500', valor: 10 }),
      l({ conta_contabil: '521110000', fonte_recursos: '1540', valor: 20 }),
    ]
    expect(agregarReceita(prev, [])).toHaveLength(2)
  })

  it('ignora contas fora de 5.2.1.1.1 / 6.2.1.2 (deduções, reestimativa)', () => {
    const prev = [
      l({ conta_contabil: '521120101', valor: 999 }), // dedução 5.2.1.1.2
      l({ conta_contabil: '521210100', valor: 999 }), // 5.2.1.2.1
      l({ conta_contabil: '521110000', valor: 10 }), //  previsão inicial
    ]
    const m = agregarReceita(prev, [])
    expect(m).toHaveLength(1)
    expect(m[0]!.previsto).toBe(10_00)
  })

  it('filtra por poder_orgao (natureza×fonte iguais fundem no consolidado)', () => {
    const real = [
      l({ conta_contabil: '621200000', poder_orgao: '10131', natureza_conta: 'C', valor: 100 }),
      l({ conta_contabil: '621200000', poder_orgao: '20231', natureza_conta: 'C', valor: 40 }),
    ]
    const consolidado = agregarReceita([], real)
    expect(consolidado).toHaveLength(1) // receita é por natureza×fonte, sem órgão
    expect(consolidado[0]!.arrecadado).toBe(140_00)
    const so = agregarReceita([], real, '20231')
    expect(so).toHaveLength(1)
    expect(so[0]!.arrecadado).toBe(40_00)
  })
})

/** Linha crua da fixação da despesa (classe 5). */
const d = (over: Partial<LinhaMsc>): LinhaMsc => ({
  conta_contabil: '522110100',
  poder_orgao: '10131',
  fonte_recursos: '1500',
  funcao: '10',
  subfuncao: '301',
  natureza_despesa: '33900000',
  natureza_receita: null,
  natureza_conta: 'D',
  valor: 0,
  ...over,
})

describe('agregarDespesa (fixação MSC → autorizado)', () => {
  it('autorizado = inicial(5.2.2.1.1) + créditos(5.2.2.1.2) − cancelam.(5.2.2.1.9)', () => {
    const fix = [
      d({ conta_contabil: '522110100', valor: 1000 }), // inicial
      d({ conta_contabil: '522120100', valor: 200 }), //  crédito suplementar
      d({ conta_contabil: '522139900', valor: 999 }), //  5.2.2.1.3 — IGNORADO
      d({ conta_contabil: '522190209', natureza_conta: 'C', valor: 150 }), // cancelamento
    ]
    const m = agregarDespesa(fix)
    expect(m).toHaveLength(1)
    expect(m[0]!.autorizado).toBe(1050_00) // 1000 + 200 − 150
  })

  it('natureza sai em MODALIDADE (elemento zerado) p/ casar o empenho', () => {
    const [x] = agregarDespesa([d({ natureza_despesa: '33903001', valor: 1 })])
    expect(x!.naturezaPcasp).toBe('3.3.90.00.00.00')
  })

  it('separa por função×subfunção×natureza×fonte e filtra por poder', () => {
    const fix = [
      d({ poder_orgao: '10131', valor: 100 }),
      d({ poder_orgao: '20231', valor: 40 }),
    ]
    expect(agregarDespesa(fix)).toHaveLength(2)
    const so = agregarDespesa(fix, '20231')
    expect(so).toHaveLength(1)
    expect(so[0]!.autorizado).toBe(40_00)
  })
})
