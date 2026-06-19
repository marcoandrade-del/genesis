import { describe, it, expect } from 'vitest'
import { parseCSV, parseOFX, parseCNAB240, parseExtrato, normalizarData, normalizarValor } from '../extrato-parsers.js'

/** Monta uma linha CNAB 240 colocando campos em posições 1-based. */
function linhaCnab(campos: Array<[number, string]>): string {
  const arr = Array(240).fill(' ')
  for (const [pos, str] of campos) for (let i = 0; i < str.length; i++) arr[pos - 1 + i] = str[i]
  return arr.join('')
}

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

describe('parseCNAB240', () => {
  const segT = linhaCnab([[8, '3'], [14, 'T'], [59, '0000000DOC123  ']])
  const segU = linhaCnab([[8, '3'], [14, 'U'], [78, '000000000012345'], [146, '15062026']])

  it('casa Segmento T (documento) + U (valor pago, data crédito) num crédito', () => {
    const r = parseCNAB240([segT, segU].join('\n'))
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ data: '2026-06-15', valor: '123.45', sentido: 'CREDITO' })
    expect(r[0].documento).toContain('DOC123')
  })

  it('ignora U com valor zero e arquivo sem linhas de 240', () => {
    const u0 = linhaCnab([[8, '3'], [14, 'U'], [78, '000000000000000'], [146, '15062026']])
    expect(() => parseCNAB240([segT, u0].join('\n'))).toThrow(/liquidado/)
    expect(() => parseCNAB240('linha curta')).toThrow(/240/)
  })
})

describe('parseExtrato', () => {
  it('despacha por formato (CSV/OFX/CNAB)', () => {
    expect(parseExtrato('CSV', '2026-06-10,100,ISS')).toHaveLength(1)
    const cnab = [linhaCnab([[8, '3'], [14, 'T'], [59, 'DOC1']]), linhaCnab([[8, '3'], [14, 'U'], [78, '000000000010000'], [146, '01062026']])].join('\n')
    expect(parseExtrato('CNAB', cnab)).toHaveLength(1)
  })
})
