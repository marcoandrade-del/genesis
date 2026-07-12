import { describe, it, expect } from 'vitest'
import { resolverParametroDespesa, validarCategoriaDebito, type ParametroDespesaLido } from '../parametros-despesa.js'

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

describe('validarCategoriaDebito', () => {
  it('aceita cada categoria com a classe de débito correta', () => {
    expect(validarCategoriaDebito('CUSTEIO', '3.3.1.1.1.99')).toBeNull()
    expect(validarCategoriaDebito('PESSOAL', '3.1.1.1.1.01')).toBeNull()
    expect(validarCategoriaDebito('JUROS', '3.4.1.1.1.01')).toBeNull()
    expect(validarCategoriaDebito('CAPITAL', '1.2.3.1.1.01')).toBeNull()
    expect(validarCategoriaDebito('AMORTIZACAO', '2.2.2.1.1.02')).toBeNull()
  })
  it('rejeita quando a classe do débito não bate com a categoria', () => {
    expect(validarCategoriaDebito('CAPITAL', '3.3.1.1.1.99')).toMatch(/espera conta débito da classe 1/)
    expect(validarCategoriaDebito('AMORTIZACAO', '3.4.1.1.1.01')).toMatch(/classe 2/)
    expect(validarCategoriaDebito('CUSTEIO', '1.2.3.1.1.01')).toMatch(/classe 3/)
  })
  it('sem categoria (null/undefined) não valida — retorna null', () => {
    expect(validarCategoriaDebito(null, '9.9.9')).toBeNull()
    expect(validarCategoriaDebito(undefined, '9.9.9')).toBeNull()
  })
  it('conta vazia acusa classe "(vazia)"', () => {
    expect(validarCategoriaDebito('CUSTEIO', '')).toMatch(/da classe \(vazia\)/)
  })
})
