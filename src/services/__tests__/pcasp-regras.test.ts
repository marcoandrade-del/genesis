import { describe, it, expect } from 'vitest'
import { validarParPcasp, validarEventoPcasp, type ContaParaRegra } from '../pcasp-regras.js'

const folha = (codigo: string, nat: ContaParaRegra['naturezaInformacao']): ContaParaRegra => ({ codigo, admiteMovimento: true, naturezaInformacao: nat })

describe('validarParPcasp', () => {
  it('par válido (mesmo subsistema, folhas, contas distintas) → sem violação', () => {
    const d = folha('3.3.2.1.1.01.00.00.00.00.00.00', 'PATRIMONIAL')
    const c = folha('2.1.3.1.1.01.01.00.00.00.00.00', 'PATRIMONIAL')
    expect(validarParPcasp(d.codigo, c.codigo, d, c)).toEqual([])
  })

  it('mistura de subsistemas (Patrimonial × Orçamentária) → SUBSISTEMAS_DISTINTOS', () => {
    const d = folha('6.2.2.1.1.00.00.00.00.00.00.00', 'ORCAMENTARIA')
    const c = folha('2.1.3.1.1.01.01.00.00.00.00.00', 'PATRIMONIAL')
    const v = validarParPcasp(d.codigo, c.codigo, d, c)
    expect(v.map((x) => x.regra)).toContain('SUBSISTEMAS_DISTINTOS')
  })

  it('conta inexistente no plano → CONTA_INEXISTENTE', () => {
    const c = folha('2.1.3.1.1.01.01.00.00.00.00.00', 'PATRIMONIAL')
    const v = validarParPcasp('9.9.9', c.codigo, null, c)
    expect(v.map((x) => x.regra)).toContain('CONTA_INEXISTENTE')
  })

  it('conta sintética (não folha) → CONTA_SINTETICA', () => {
    const d: ContaParaRegra = { codigo: '3.3', admiteMovimento: false, naturezaInformacao: 'PATRIMONIAL' }
    const c = folha('2.1.3.1.1.01.01.00.00.00.00.00', 'PATRIMONIAL')
    const v = validarParPcasp(d.codigo, c.codigo, d, c)
    expect(v.map((x) => x.regra)).toContain('CONTA_SINTETICA')
  })

  it('débito = crédito → DEBITO_IGUAL_CREDITO', () => {
    const a = folha('3.3.2.1.1.01.00.00.00.00.00.00', 'PATRIMONIAL')
    const v = validarParPcasp(a.codigo, a.codigo, a, a)
    expect(v.map((x) => x.regra)).toContain('DEBITO_IGUAL_CREDITO')
  })

  it('natureza da informação ausente em um lado → não acusa subsistema (degrada)', () => {
    const d = folha('6.2.2.1.1.00.00.00.00.00.00.00', 'ORCAMENTARIA')
    const c: ContaParaRegra = { codigo: '6.2.2.1.3.01.00.00.00.00.00.00', admiteMovimento: true, naturezaInformacao: null }
    expect(validarParPcasp(d.codigo, c.codigo, d, c)).toEqual([])
  })

  it('orçamentário dentro da mesma classe (6×6) é válido', () => {
    const d = folha('6.2.2.1.1.00.00.00.00.00.00.00', 'ORCAMENTARIA')
    const c = folha('6.2.2.1.3.01.00.00.00.00.00.00', 'ORCAMENTARIA')
    expect(validarParPcasp(d.codigo, c.codigo, d, c)).toEqual([])
  })
})

describe('validarEventoPcasp', () => {
  it('rotula a violação com o índice do par', () => {
    const mapa = new Map<string, ContaParaRegra>([
      ['6.2.2.1.1.00.00.00.00.00.00.00', folha('6.2.2.1.1.00.00.00.00.00.00.00', 'ORCAMENTARIA')],
      ['2.1.3.1.1.01.01.00.00.00.00.00', folha('2.1.3.1.1.01.01.00.00.00.00.00', 'PATRIMONIAL')],
    ])
    const v = validarEventoPcasp([{ contaDebitoMascara: '6.2.2.1.1.00.00.00.00.00.00.00', contaCreditoMascara: '2.1.3.1.1.01.01.00.00.00.00.00' }], mapa)
    expect(v).toHaveLength(1)
    expect(v[0].mensagem).toMatch(/^Par 1:/)
  })

  it('evento todo válido → sem violações', () => {
    const mapa = new Map<string, ContaParaRegra>([
      ['6.2.2.1.1.00.00.00.00.00.00.00', folha('6.2.2.1.1.00.00.00.00.00.00.00', 'ORCAMENTARIA')],
      ['6.2.2.1.3.01.00.00.00.00.00.00', folha('6.2.2.1.3.01.00.00.00.00.00.00', 'ORCAMENTARIA')],
    ])
    expect(validarEventoPcasp([{ contaDebitoMascara: '6.2.2.1.1.00.00.00.00.00.00.00', contaCreditoMascara: '6.2.2.1.3.01.00.00.00.00.00.00' }], mapa)).toEqual([])
  })
})
