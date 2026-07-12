import { describe, it, expect } from 'vitest'
import { naturezaReceita, naturezaDespesaElemento, funcao2, subfuncao3, programa4 } from '../codigo.js'

describe('betha · normalização de códigos', () => {
  it('normaliza a natureza da receita crua p/ 12 grupos PCASP', () => {
    expect(naturezaReceita('17180111')).toBe('1.7.1.8.01.1.1.00.00.00.00.00')
  })

  it('normaliza a natureza da receita JÁ PONTUADA (completa com zeros)', () => {
    expect(naturezaReceita('1.7.1.8.01.1.1')).toBe('1.7.1.8.01.1.1.00.00.00.00.00')
    expect(naturezaReceita('1.1.1.0')).toBe('1.1.1.0.00.0.0.00.00.00.00.00')
  })

  it('trunca a natureza da despesa no ELEMENTO (pontuada ou crua)', () => {
    expect(naturezaDespesaElemento('3.1.90.11')).toBe('3.1.90.11.00.00')
    expect(naturezaDespesaElemento('319011')).toBe('3.1.90.11.00.00')
    // subitem é descartado (fica no nível elemento)
    expect(naturezaDespesaElemento('3.3.90.30.01')).toBe('3.3.90.30.00.00')
  })

  it('padroniza as dimensões da funcional-programática', () => {
    expect(funcao2('4')).toBe('04')
    expect(subfuncao3('122')).toBe('122')
    expect(programa4('2')).toBe('0002')
  })
})
