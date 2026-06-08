import { describe, it, expect } from 'vitest'
import ExcelJS from 'exceljs'
import { exportarResultado, formatoValido, nomeArquivo, FORMATOS } from '../relatorio-export.js'

const R = {
  colunas: ['Conta', 'Valor', 'Data'],
  linhas: [
    ['001', 1234.5, new Date(2026, 0, 15)],
    ['a;b"c', null, true],
  ] as unknown[][],
}
const VAZIO = { colunas: ['x'], linhas: [] as unknown[][] }

describe('relatorio-export', () => {
  describe('metadados', () => {
    it('FORMATOS tem os 8 formatos, incluindo pdf', () => {
      expect(FORMATOS.map((f) => f.id)).toEqual(['html', 'txt', 'pdf', 'csv', 'xls', 'doc', 'xml', 'json'])
    })
    it('formatoValido aceita conhecidos e rejeita o resto', () => {
      expect(formatoValido('csv')).toBe(true)
      expect(formatoValido('pdf')).toBe(true)
      expect(formatoValido('zip')).toBe(false)
    })
    it('nomeArquivo remove acentos/símbolos e cai em "relatorio" se vazio', () => {
      expect(nomeArquivo('Lançamentos 2026!', 'csv')).toBe('lancamentos_2026.csv')
      expect(nomeArquivo('***', 'xml')).toBe('relatorio.xml')
    })
  })

  describe('CSV', () => {
    it('tem BOM, separador ; e escapa campos com ;/aspas; data em pt-BR', async () => {
      const { conteudo, mime, ext, download } = await exportarResultado('csv', R, 't')
      const s = conteudo as string
      expect(s.charCodeAt(0)).toBe(0xfeff)
      const linhas = s.slice(1).split('\r\n')
      expect(linhas[0]).toBe('Conta;Valor;Data')
      expect(linhas[1]).toBe('001;1234.5;15/01/2026')
      expect(linhas[2]).toBe('"a;b""c";;true') // ; e " escapados; null vazio; boolean
      expect(mime).toContain('text/csv')
      expect(ext).toBe('csv')
      expect(download).toBe(true)
    })
  })

  describe('TXT', () => {
    it('título + linhas separadas por tab', async () => {
      const { conteudo } = await exportarResultado('txt', R, 'Meu Rel')
      const linhas = (conteudo as string).split('\r\n')
      expect(linhas[0]).toBe('Meu Rel')
      expect(linhas[2]).toBe('Conta\tValor\tData')
      expect(linhas[3]).toBe('001\t1234.5\t15/01/2026')
    })
  })

  describe('HTML', () => {
    it('monta tabela com título escapado', async () => {
      const { conteudo, mime } = await exportarResultado('html', R, 'Rel <b>')
      const s = conteudo as string
      expect(s).toContain('<title>Rel &lt;b&gt;</title>')
      expect(s).toContain('<th>Conta</th>')
      expect(s).toContain('<td>15/01/2026</td>')
      expect(mime).toContain('text/html')
    })
    it('mostra "Sem resultados" quando não há linhas', async () => {
      const { conteudo } = await exportarResultado('html', VAZIO, 't')
      expect(conteudo as string).toContain('Sem resultados')
    })
    it('sem colunas usa colspan 1 no aviso de vazio', async () => {
      const { conteudo } = await exportarResultado('html', { colunas: [], linhas: [] }, 't')
      expect(conteudo as string).toContain('colspan="1"')
    })
  })

  describe('XML', () => {
    it('uma <linha> por registro, com <campo nome>', async () => {
      const { conteudo, mime } = await exportarResultado('xml', R, 'Rel & Cia')
      const s = conteudo as string
      expect(s).toContain('<relatorio nome="Rel &amp; Cia">')
      expect(s).toContain('<campo nome="Conta">001</campo>')
      expect(s).toContain('<campo nome="Data">15/01/2026</campo>')
      expect(mime).toContain('application/xml')
    })
  })

  describe('JSON', () => {
    it('linhas como objetos; tipos nativos; data ISO local; null preservado', async () => {
      const { conteudo, mime } = await exportarResultado('json', R, 'Rel')
      const obj = JSON.parse(conteudo as string)
      expect(obj.relatorio).toBe('Rel')
      expect(obj.colunas).toEqual(['Conta', 'Valor', 'Data'])
      expect(obj.linhas[0]).toEqual({ Conta: '001', Valor: 1234.5, Data: '2026-01-15' })
      expect(obj.linhas[1]).toEqual({ Conta: 'a;b"c', Valor: null, Data: true })
      expect(mime).toContain('application/json')
    })
  })

  describe('XLS (exceljs)', () => {
    it('gera xlsx real; números são numéricos e o resto texto', async () => {
      const { conteudo, mime, ext } = await exportarResultado('xls', R, 'Rel')
      const buf = conteudo as Buffer
      expect(buf[0]).toBe(0x50) // PK (zip)
      expect(buf[1]).toBe(0x4b)
      expect(mime).toContain('spreadsheetml.sheet')
      expect(ext).toBe('xlsx')
      const wb = new ExcelJS.Workbook()
      await wb.xlsx.load(buf as unknown as ArrayBuffer)
      const ws = wb.worksheets[0]!
      expect(ws.getRow(1).getCell(1).value).toBe('Conta')
      expect(ws.getRow(2).getCell(1).value).toBe('001') // texto (zero à esquerda preservável)
      expect(ws.getRow(2).getCell(2).value).toBe(1234.5) // número
    })
  })

  describe('DOC (docx)', () => {
    it('gera docx real (zip não-vazio)', async () => {
      const { conteudo, mime, ext } = await exportarResultado('doc', R, 'Rel')
      const buf = conteudo as Buffer
      expect(buf[0]).toBe(0x50)
      expect(buf[1]).toBe(0x4b)
      expect(buf.length).toBeGreaterThan(500)
      expect(mime).toContain('wordprocessingml.document')
      expect(ext).toBe('docx')
    })
  })
})
