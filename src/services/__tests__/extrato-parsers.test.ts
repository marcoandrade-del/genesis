import { describe, it, expect } from 'vitest'
import { parseCSV, parseOFX, parseExtrato, normalizarData, normalizarValor } from '../extrato-parsers.js'

describe('normalizarData', () => {
  it('aceita YYYY-MM-DD, DD/MM/YYYY e YYYYMMDD', () => {
    expect(normalizarData('2026-06-19')).toBe('2026-06-19')
    expect(normalizarData('19/06/2026')).toBe('2026-06-19')
    expect(normalizarData('20260619120000[-3:BRT]')).toBe('2026-06-19')
    expect(normalizarData('xx')).toBeNull()
  })
})

describe('normalizarValor', () => {
  it('aceita BR, US, sinal e parênteses', () => {
    expect(normalizarValor('1.234,56')).toEqual({ valor: '1234.56', negativo: false })
    expect(normalizarValor('1234.56')).toEqual({ valor: '1234.56', negativo: false })
    expect(normalizarValor('-50,00')).toEqual({ valor: '50.00', negativo: true })
    expect(normalizarValor('(75.00)')).toEqual({ valor: '75.00', negativo: true })
    expect(normalizarValor('100')).toEqual({ valor: '100.00', negativo: false })
    expect(normalizarValor('abc')).toBeNull()
  })
})

describe('parseCSV', () => {
  it('lê data;valor;histórico, pula cabeçalho, infere sentido pelo sinal', () => {
    const csv = 'data;valor;historico\n01/06/2026;1.234,56;FPM cota\n02/06/2026;-50,00;tarifa'
    const r = parseCSV(csv)
    expect(r).toHaveLength(2)
    expect(r[0]).toEqual({ data: '2026-06-01', valor: '1234.56', sentido: 'CREDITO', historico: 'FPM cota', documento: undefined })
    expect(r[1].sentido).toBe('DEBITO')
  })

  it('aceita delimitador vírgula', () => {
    const r = parseCSV('2026-06-10,100.00,ISS')
    expect(r[0]).toMatchObject({ data: '2026-06-10', valor: '100.00', sentido: 'CREDITO' })
  })

  it('vazio ou sem linha válida → erro', () => {
    expect(() => parseCSV('')).toThrow()
    expect(() => parseCSV('cabeçalho;sem;dados')).toThrow(/Nenhum movimento/)
  })
})

describe('parseOFX', () => {
  const ofx = `
    <BANKTRANLIST>
      <STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260601<TRNAMT>1234.56<MEMO>FPM<FITID>A1</STMTTRN>
      <STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260602<TRNAMT>-50.00<MEMO>tarifa<FITID>A2</STMTTRN>
    </BANKTRANLIST>`
  it('extrai STMTTRN com tipo, data, valor, memo e fitid', () => {
    const r = parseOFX(ofx)
    expect(r).toHaveLength(2)
    expect(r[0]).toEqual({ data: '2026-06-01', valor: '1234.56', sentido: 'CREDITO', historico: 'FPM', documento: 'A1' })
    expect(r[1].sentido).toBe('DEBITO')
  })

  it('sem transações → erro', () => {
    expect(() => parseOFX('<OFX></OFX>')).toThrow(/STMTTRN/)
  })
})

describe('parseExtrato', () => {
  it('despacha por formato; CNAB ainda não disponível', () => {
    expect(parseExtrato('CSV', '2026-06-10,100,ISS')).toHaveLength(1)
    expect(() => parseExtrato('CNAB', 'x')).toThrow(/CNAB/)
  })
})
