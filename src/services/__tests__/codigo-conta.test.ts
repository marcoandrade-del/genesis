import { describe, it, expect } from 'vitest'
import { proximoCodigoDesdobramento } from '../codigo-conta.js'

describe('proximoCodigoDesdobramento', () => {
  it('preenche o primeiro segmento zerado — caso CAIXA do PCASP', () => {
    expect(proximoCodigoDesdobramento('1.1.1.1.1.01.00.00.00.00.00.00', [])).toBe('1.1.1.1.1.01.01.00.00.00.00.00')
  })

  it('NÃO anexa segmento além da máscara (mesma quantidade de níveis)', () => {
    const pai = '1.1.1.1.1.01.00.00.00.00.00.00'
    const r = proximoCodigoDesdobramento(pai, [])
    expect(r.split('.')).toHaveLength(pai.split('.').length)
  })

  it('sequencial = maior valor dos filhos naquele segmento + 1 (robusto a exclusões)', () => {
    expect(
      proximoCodigoDesdobramento('1.1.1.1.1.01.00.00.00.00.00.00', [
        '1.1.1.1.1.01.01.00.00.00.00.00',
        '1.1.1.1.1.01.03.00.00.00.00.00',
      ]),
    ).toBe('1.1.1.1.1.01.04.00.00.00.00.00')
  })

  it('mantém a largura do segmento (zero-pad) — máscara de despesa', () => {
    expect(proximoCodigoDesdobramento('3.1.90.11.00.00', [])).toBe('3.1.90.11.01.00')
  })

  it('máscara cheia (nenhum segmento zerado) → fallback anexa .NN', () => {
    expect(proximoCodigoDesdobramento('3.1.90.11', [])).toBe('3.1.90.11.01')
    expect(proximoCodigoDesdobramento('3.1.90.11', ['3.1.90.11.01', '3.1.90.11.02'])).toBe('3.1.90.11.03')
  })
})
