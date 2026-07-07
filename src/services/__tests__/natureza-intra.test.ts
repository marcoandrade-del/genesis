import { describe, it, expect } from 'vitest'
import { modalidadeAplicacao, ehDespesaIntra, ehReceitaIntra } from '../natureza-intra.js'

describe('natureza-intra', () => {
  it('modalidadeAplicacao extrai o 3º grupo da natureza de despesa', () => {
    expect(modalidadeAplicacao('3.1.90.11.00.00')).toBe('90')
    expect(modalidadeAplicacao('3.1.91.13.00.00')).toBe('91')
    expect(modalidadeAplicacao('4.4.90.52')).toBe('90')
    expect(modalidadeAplicacao('3.1')).toBeNull()
  })

  it('ehDespesaIntra: só modalidade 91', () => {
    expect(ehDespesaIntra('3.1.91.13.00.00')).toBe(true) // contribuição patronal intra (→ RPPS)
    expect(ehDespesaIntra('3.1.90.11.00.00')).toBe(false) // aplicação direta
    expect(ehDespesaIntra('3.3.90.39.00.00')).toBe(false)
    expect(ehDespesaIntra('4.4.91.52.00.00')).toBe(true)
  })

  it('ehReceitaIntra: categorias 7 (correntes intra) e 8 (capital intra)', () => {
    expect(ehReceitaIntra('7.2.1.8.01.1.1')).toBe(true) // contribuição patronal intra recebida pelo RPPS
    expect(ehReceitaIntra('8.1.1.0.00.0.0')).toBe(true)
    expect(ehReceitaIntra('1.1.1.8.01.1.1')).toBe(false) // imposto (corrente normal)
    expect(ehReceitaIntra('1.7.5.1.50')).toBe(false) // FUNDEB
    expect(ehReceitaIntra(' 7.0.0.0 ')).toBe(true) // tolera espaços
  })
})
