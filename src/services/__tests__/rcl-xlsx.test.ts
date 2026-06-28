import { describe, it, expect } from 'vitest'
import ExcelJS from 'exceljs'
import { lerXlsxBase64 } from '../rcl-xlsx.js'

async function xlsxBase64(): Promise<string> {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Mapeamento')
  ws.addRow(['Natureza', 'Dedução'])
  ws.addRow(['1.7.5.1.50', 'FUNDEB'])
  ws.addRow(['1.2.1.5', 'Contribuição RPPS'])
  const buf = await wb.xlsx.writeBuffer()
  return Buffer.from(buf as ArrayBuffer).toString('base64')
}

describe('lerXlsxBase64', () => {
  it('extrai o texto da aba (cabeçalho da aba + linhas tab-separadas)', async () => {
    const texto = await lerXlsxBase64(await xlsxBase64())
    expect(texto).toContain('Aba: Mapeamento')
    expect(texto).toContain('1.7.5.1.50')
    expect(texto).toContain('FUNDEB')
    expect(texto).toContain('Contribuição RPPS')
  })

  it('trunca pelo maxChars', async () => {
    const texto = await lerXlsxBase64(await xlsxBase64(), { maxChars: 10 })
    expect(texto).toContain('truncado')
    expect(texto.length).toBeLessThan(40)
  })

  it('respeita maxLinhas', async () => {
    const texto = await lerXlsxBase64(await xlsxBase64(), { maxLinhas: 1 })
    expect(texto).toContain('Natureza')
    expect(texto).not.toContain('FUNDEB') // 2ª linha cortada
  })
})
