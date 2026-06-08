import ExcelJS from 'exceljs'
import { Document, Packer, Paragraph, Table, TableRow, TableCell, TextRun, HeadingLevel, WidthType } from 'docx'
import { analisarColunas, totalGeralRow, rotuloGeral, indiceRotulo, type Totais } from './relatorio-totais.js'

export type ResultadoExport = { colunas: string[]; linhas: unknown[][]; truncado?: boolean }
export type FormatoExport = 'html' | 'txt' | 'pdf' | 'csv' | 'xls' | 'doc' | 'xml' | 'json'
export type ArquivoExport = { conteudo: string | Buffer; mime: string; ext: string; download: boolean }

// Metadados dos formatos — alimenta o dropdown da prévia e a validação da rota.
// `download: false` abre no navegador (nova aba); `true` baixa como anexo.
export const FORMATOS: { id: FormatoExport; label: string; ext: string; icone: string; download: boolean }[] = [
  { id: 'html', label: 'HTML', ext: 'html', icone: 'bi-filetype-html', download: false },
  { id: 'txt', label: 'Texto (TXT)', ext: 'txt', icone: 'bi-filetype-txt', download: true },
  { id: 'pdf', label: 'PDF', ext: 'pdf', icone: 'bi-file-earmark-pdf', download: false },
  { id: 'csv', label: 'CSV', ext: 'csv', icone: 'bi-filetype-csv', download: true },
  { id: 'xls', label: 'Excel (XLSX)', ext: 'xlsx', icone: 'bi-file-earmark-excel', download: true },
  { id: 'doc', label: 'Word (DOCX)', ext: 'docx', icone: 'bi-file-earmark-word', download: true },
  { id: 'xml', label: 'XML', ext: 'xml', icone: 'bi-filetype-xml', download: true },
  { id: 'json', label: 'JSON', ext: 'json', icone: 'bi-filetype-json', download: true },
]

const VALIDOS = new Set<string>(FORMATOS.map((f) => f.id))
export function formatoValido(f: string): f is FormatoExport {
  return VALIDOS.has(f)
}

/** Nome de arquivo seguro a partir do título do relatório (sem acento/símbolos). */
export function nomeArquivo(titulo: string, ext: string): string {
  const base =
    titulo
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .toLowerCase() || 'relatorio'
  return `${base}.${ext}`
}

const pad2 = (n: number) => String(n).padStart(2, '0')
// Datas pelos componentes LOCAIS (evita o deslocamento de fuso do toISOString).
const dataBR = (d: Date) => `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`
const dataISO = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`

// Célula para formatos textuais/humanos (TXT, CSV, HTML, DOC, XML).
function celulaTexto(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (v instanceof Date) return dataBR(v)
  return String(v)
}
// Célula para JSON: mantém tipos nativos (número/booleano), data como ISO local.
function celulaJson(v: unknown): unknown {
  if (v === null || v === undefined) return null
  if (v instanceof Date) return dataISO(v)
  return v
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
}

function gerarHtml(r: ResultadoExport, titulo: string, total: string[] | null): string {
  const ths = r.colunas.map((c) => `<th>${esc(c)}</th>`).join('')
  const trs = r.linhas.length
    ? r.linhas.map((row) => `<tr>${row.map((v) => `<td>${esc(celulaTexto(v))}</td>`).join('')}</tr>`).join('')
    : `<tr><td colspan="${r.colunas.length || 1}" style="text-align:center;color:#888">Sem resultados.</td></tr>`
  const tot = total ? `<tr class="total">${total.map((v) => `<td>${esc(v)}</td>`).join('')}</tr>` : ''
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>${esc(titulo)}</title><style>
    body{font-family:sans-serif;font-size:13px;color:#111;margin:24px}
    h1{font-size:18px;margin:0 0 12px}
    table{width:100%;border-collapse:collapse}
    th,td{border:1px solid #ccc;padding:4px 8px;text-align:left}
    th{background:#f2f2f2}
    tr.total td{font-weight:bold;background:#f2f2f2}
  </style></head><body><h1>${esc(titulo)}</h1>
  <table><thead><tr>${ths}</tr></thead><tbody>${trs}${tot}</tbody></table></body></html>`
}

function gerarTxt(r: ResultadoExport, titulo: string, total: string[] | null): string {
  const linhas = [titulo, '', r.colunas.join('\t'), ...r.linhas.map((row) => row.map(celulaTexto).join('\t'))]
  if (total) linhas.push('', total.join('\t'))
  return linhas.join('\r\n')
}

function campoCsv(v: unknown): string {
  const s = celulaTexto(v)
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
function gerarCsv(r: ResultadoExport, total: string[] | null): string {
  // Separador ';' + BOM UTF-8 = abre certinho no Excel pt-BR.
  const linhas = [r.colunas.map(campoCsv).join(';'), ...r.linhas.map((row) => row.map(campoCsv).join(';'))]
  if (total) linhas.push(total.map(campoCsv).join(';'))
  return '﻿' + linhas.join('\r\n')
}

function gerarXml(r: ResultadoExport, titulo: string, total: string[] | null): string {
  const corpo = r.linhas
    .map((row) => {
      const campos = r.colunas.map((c, i) => `<campo nome="${esc(c)}">${esc(celulaTexto(row[i]))}</campo>`).join('')
      return `  <linha>${campos}</linha>`
    })
    .join('\n')
  const tot = total
    ? `\n  <total>${r.colunas.map((c, i) => `<campo nome="${esc(c)}">${esc(total[i] ?? '')}</campo>`).join('')}</total>`
    : ''
  return `<?xml version="1.0" encoding="UTF-8"?>\n<relatorio nome="${esc(titulo)}">\n${corpo}${tot}\n</relatorio>`
}

function gerarJson(r: ResultadoExport, titulo: string, t: Totais): string {
  const linhas = r.linhas.map((row) => {
    const obj: Record<string, unknown> = {}
    r.colunas.forEach((c, i) => {
      obj[c] = celulaJson(row[i])
    })
    return obj
  })
  const totalGeral: Record<string, number> = {}
  r.colunas.forEach((c, i) => {
    if (t.numericas[i]) totalGeral[c] = t.soma[i]!
  })
  const temTotal = r.linhas.length > 0 && t.algumaNumerica
  return JSON.stringify({ relatorio: titulo, colunas: r.colunas, linhas, ...(temTotal ? { totalGeral } : {}) }, null, 2)
}

async function gerarXls(r: ResultadoExport, t: Totais): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Relatório')
  ws.addRow(r.colunas).font = { bold: true }
  for (const row of r.linhas) {
    // Números viram célula numérica (somável); o resto vira texto (preserva
    // código de conta com zero à esquerda, datas em dd/mm/aaaa etc.).
    ws.addRow(row.map((v) => (typeof v === 'number' ? v : celulaTexto(v))))
  }
  if (r.linhas.length > 0 && t.algumaNumerica) {
    const idx = indiceRotulo(t.numericas)
    const linha = r.colunas.map((_, i) => (i === idx ? rotuloGeral(r.truncado) : t.numericas[i] ? t.soma[i]! : ''))
    ws.addRow(linha).font = { bold: true }
  }
  ws.columns.forEach((col) => {
    col.width = 22
  })
  return Buffer.from(await wb.xlsx.writeBuffer())
}

async function gerarDoc(r: ResultadoExport, titulo: string, total: string[] | null): Promise<Buffer> {
  const linhaTabela = (celulas: string[], bold: boolean) =>
    new TableRow({
      children: celulas.map(
        (c) => new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: c, bold })] })] }),
      ),
    })
  const rows = [
    linhaTabela(r.colunas, true),
    ...r.linhas.map((row) => linhaTabela(r.colunas.map((_, i) => celulaTexto(row[i])), false)),
  ]
  if (total) rows.push(linhaTabela(total, true))
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({ text: titulo, heading: HeadingLevel.HEADING_1 }),
          new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows }),
        ],
      },
    ],
  })
  return Packer.toBuffer(doc)
}

/**
 * Gera o arquivo de exportação no formato pedido (exceto PDF, tratado na rota
 * pois precisa do cabeçalho/rodapé + paginação Playwright). `titulo` = nome do
 * relatório. Toda coluna de valor recebe automaticamente a linha de TOTAL GERAL.
 */
export async function exportarResultado(
  formato: Exclude<FormatoExport, 'pdf'>,
  r: ResultadoExport,
  titulo: string,
): Promise<ArquivoExport> {
  const t = analisarColunas(r)
  const total = totalGeralRow(r, t) // string[] | null
  switch (formato) {
    case 'html':
      return { conteudo: gerarHtml(r, titulo, total), mime: 'text/html; charset=utf-8', ext: 'html', download: false }
    case 'txt':
      return { conteudo: gerarTxt(r, titulo, total), mime: 'text/plain; charset=utf-8', ext: 'txt', download: true }
    case 'csv':
      return { conteudo: gerarCsv(r, total), mime: 'text/csv; charset=utf-8', ext: 'csv', download: true }
    case 'xml':
      return { conteudo: gerarXml(r, titulo, total), mime: 'application/xml; charset=utf-8', ext: 'xml', download: true }
    case 'json':
      return { conteudo: gerarJson(r, titulo, t), mime: 'application/json; charset=utf-8', ext: 'json', download: true }
    case 'xls':
      return {
        conteudo: await gerarXls(r, t),
        mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        ext: 'xlsx',
        download: true,
      }
    case 'doc':
      return {
        conteudo: await gerarDoc(r, titulo, total),
        mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        ext: 'docx',
        download: true,
      }
  }
}
