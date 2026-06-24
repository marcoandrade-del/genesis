import { describe, it, expect } from 'vitest'
import { resolverParametroDespesa, type ParametroDespesaLido } from '../parametros-despesa.js'

const P = (naturezaCodigo: string): ParametroDespesaLido => ({ naturezaCodigo, contaVpdCodigo: `vpd-${naturezaCodigo}`, contaPassivoCodigo: `pas-${naturezaCodigo}` })

describe('resolverParametroDespesa', () => {
  const params = [P('3.1.90'), P('3.3.90'), P('3.3.90.30')]

  it('casa por prefixo (grupo de natureza)', () => {
    expect(resolverParametroDespesa(params, '3.1.90.07.00.00')?.naturezaCodigo).toBe('3.1.90')
  })
  it('prefixo MAIS LONGO vence (sub-elemento herda do mais específico)', () => {
    expect(resolverParametroDespesa(params, '3.3.90.30.07.00')?.naturezaCodigo).toBe('3.3.90.30')
    expect(resolverParametroDespesa(params, '3.3.90.39.57.00')?.naturezaCodigo).toBe('3.3.90')
  })
  it('casa por igualdade exata', () => {
    expect(resolverParametroDespesa(params, '3.3.90.30')?.naturezaCodigo).toBe('3.3.90.30')
  })
  it('respeita fronteira de segmento (3.1.9 não casa 3.1.90)', () => {
    expect(resolverParametroDespesa([P('3.1.9')], '3.1.90.07.00.00')).toBeNull()
  })
  it('retorna null quando nenhum casa', () => {
    expect(resolverParametroDespesa(params, '4.4.90.51.00.00')).toBeNull()
  })
  it('devolve as contas do parâmetro casado', () => {
    const r = resolverParametroDespesa(params, '3.1.90.11.00.00')
    expect(r).toMatchObject({ naturezaCodigo: '3.1.90', contaVpdCodigo: 'vpd-3.1.90', contaPassivoCodigo: 'pas-3.1.90' })
  })
})
