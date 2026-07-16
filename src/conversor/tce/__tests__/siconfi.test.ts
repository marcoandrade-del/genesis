import { describe, it, expect } from 'vitest'
import { agregarExecucao, type LinhaMsc } from '../siconfi.js'

/** Linha crua da MSC classe 6 (só os campos que o agregador usa). */
const l = (over: Partial<LinhaMsc>): LinhaMsc => ({
  conta_contabil: '622130100',
  poder_orgao: '10131',
  fonte_recursos: '1500',
  funcao: '10',
  subfuncao: '301',
  natureza_despesa: '31900101',
  valor: 0,
  ...over,
})

describe('agregarExecucao (MSC classe 6 → LinhaDespesa)', () => {
  it('decompõe o crédito empenhado 6.2.2.1.3.0X em empenhado/liquidado/pago', () => {
    // mesma dimensão, as 4 sub-contas do saldo do empenho
    const linhas = [
      l({ conta_contabil: '622130100', valor: 100 }), // a liquidar
      l({ conta_contabil: '622130200', valor: 10 }), //  em liquidação
      l({ conta_contabil: '622130300', valor: 30 }), //  liquidado a pagar
      l({ conta_contabil: '622130400', valor: 60 }), //  pago
    ]
    const [d] = agregarExecucao(linhas)
    expect(agregarExecucao(linhas)).toHaveLength(1)
    expect(d!.empenhado).toBe(200_00) // .01+.02+.03+.04
    expect(d!.liquidado).toBe(90_00) //  .03+.04
    expect(d!.pago).toBe(60_00) //       .04
  })

  it('natureza 8-díg (subelemento) normaliza p/ nível ELEMENTO', () => {
    const [d] = agregarExecucao([l({ natureza_despesa: '31900101', valor: 1 })])
    expect(d!.naturezaPcasp).toBe('3.1.90.01.00.00')
  })

  it('agrega subelementos distintos no mesmo elemento', () => {
    const linhas = [
      l({ conta_contabil: '622130100', natureza_despesa: '31900101', valor: 100 }),
      l({ conta_contabil: '622130100', natureza_despesa: '31900106', valor: 50 }),
    ]
    const m = agregarExecucao(linhas)
    expect(m).toHaveLength(1)
    expect(m[0]!.empenhado).toBe(150_00)
  })

  it('ignora contas fora da subárvore do empenho (6.2.2.1.3)', () => {
    const linhas = [
      l({ conta_contabil: '622110000', valor: 999 }), // crédito disponível
      l({ conta_contabil: '622130400', valor: 60 }), //  pago
    ]
    const m = agregarExecucao(linhas)
    expect(m).toHaveLength(1)
    expect(m[0]!.empenhado).toBe(60_00)
  })

  it('filtra por poder_orgao quando informado', () => {
    const linhas = [
      l({ poder_orgao: '10131', valor: 100 }),
      l({ poder_orgao: '20231', valor: 40 }),
    ]
    expect(agregarExecucao(linhas)).toHaveLength(2) // consolidado
    const so = agregarExecucao(linhas, '20231')
    expect(so).toHaveLength(1)
    expect(so[0]!.orgao.codigo).toBe('20231')
    expect(so[0]!.empenhado).toBe(40_00)
  })

  it('separa dimensões por função×subfunção×natureza×fonte', () => {
    const linhas = [
      l({ funcao: '10', fonte_recursos: '1500', valor: 10 }),
      l({ funcao: '12', fonte_recursos: '1500', valor: 20 }),
      l({ funcao: '12', fonte_recursos: '1540', valor: 30 }),
    ]
    expect(agregarExecucao(linhas)).toHaveLength(3)
  })
})
