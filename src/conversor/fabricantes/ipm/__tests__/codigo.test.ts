import { describe, it, expect } from 'vitest'
import { naturezaReceita, naturezaDespesaElemento, naturezaDespesaModElem, decodeFuncional } from '../codigo.js'

describe('IPM · decodificação de código → PCASP', () => {
  it('receita: dropa o marcador e fatia nos segmentos', () => {
    expect(naturezaReceita('4111000000000000000')).toBe('1.1.1.0.00.0.0.00.00.00.00.00') // Impostos
    expect(naturezaReceita('4124000000000000000')).toBe('1.2.4.0.00.0.0.00.00.00.00.00') // Contrib. iluminação
    expect(naturezaReceita('4721000000000000000')).toBe('7.2.1.0.00.0.0.00.00.00.00.00') // intra-orçamentária
  })

  it('despesa (elemento): C.G.MM.EE.00.00', () => {
    expect(naturezaDespesaElemento('3319011000000000000')).toBe('3.1.90.11.00.00') // Vencimentos
    expect(naturezaDespesaElemento('3319113000000000000')).toBe('3.1.91.13.00.00') // patronal intra (mod 91)
    expect(naturezaDespesaElemento('3449051000000000000')).toBe('4.4.90.51.00.00') // Obras (capital)
  })

  it('despesa a partir de modalidade + nº do elemento', () => {
    expect(naturezaDespesaModElem('3319000000000000000', '11')).toBe('3.1.90.11.00.00')
    expect(naturezaDespesaModElem('3319000000000000000', '7')).toBe('3.1.90.07.00.00')
  })

  it('funcional → função/subfunção/programa', () => {
    expect(decodeFuncional('0004.0122.0057')).toEqual({ funcao: '04', subfuncao: '122', programa: '0057' })
    expect(decodeFuncional('0002.0062.0055')).toEqual({ funcao: '02', subfuncao: '062', programa: '0055' })
  })
})
