import { chromium, type Browser } from 'playwright'

export type DadosFaixa = {
  nomeEntidade: string
  enderecoEntidade: string
  nomeRelatorio: string
  brasao: string | null
  dataGeracao: string
  horaGeracao: string
}
export type Faixa = { altura: number; layout: unknown } | null
type ElLayout = { tipo: string; x: number; y: number }
export type ResultadoPdf = { colunas: string[]; linhas: unknown[][] }

function esc(s: unknown): string {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
}

function fmtCelula(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (v instanceof Date) return v.toLocaleDateString('pt-BR')
  return esc(v)
}

// Conteúdo de um elemento de faixa no PDF. NUMERO_PAGINA usa os spans nativos do
// Playwright (pageNumber/totalPages), que ele preenche por página.
function conteudoEl(tipo: string, d: DadosFaixa): string {
  switch (tipo) {
    case 'BRASAO':
      return d.brasao ? `<img src="${esc(d.brasao)}" style="max-height:40px;max-width:120px">` : ''
    case 'NOME_ENTIDADE': return esc(d.nomeEntidade)
    case 'NOME_RELATORIO': return esc(d.nomeRelatorio)
    case 'DATA_GERACAO': return esc(d.dataGeracao)
    case 'HORA_GERACAO': return esc(d.horaGeracao)
    case 'NUMERO_PAGINA': return 'Página <span class="pageNumber"></span> de <span class="totalPages"></span>'
    case 'ENDERECO_ENTIDADE': return esc(d.enderecoEntidade)
    default: return ''
  }
}

/** Template de faixa (header/footer) do Playwright a partir do layout. */
export function montarTemplateFaixa(faixa: Faixa, dados: DadosFaixa): string {
  if (!faixa) return '<span></span>'
  const lista: ElLayout[] = Array.isArray(faixa.layout) ? (faixa.layout as ElLayout[]) : []
  const els = lista
    .map((el) => `<div style="position:absolute;left:${Number(el.x) || 0}%;top:${Number(el.y) || 0}%">${conteudoEl(el.tipo, dados)}</div>`)
    .join('')
  return `<div style="position:relative;width:100%;height:${faixa.altura}px;font-size:10px;font-family:sans-serif;padding:0 12mm;box-sizing:border-box">${els}</div>`
}

/** Documento HTML (corpo do PDF) com a tabela do resultado. */
export function montarCorpoHtml(resultado: ResultadoPdf, titulo: string): string {
  const ths = resultado.colunas.map((c) => `<th>${esc(c)}</th>`).join('')
  const trs = resultado.linhas.length
    ? resultado.linhas.map((row) => `<tr>${row.map((v) => `<td>${fmtCelula(v)}</td>`).join('')}</tr>`).join('')
    : `<tr><td colspan="${resultado.colunas.length || 1}" style="text-align:center;color:#888">Sem resultados.</td></tr>`
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><style>
    body{font-family:sans-serif;font-size:11px;color:#111;margin:0}
    h1{font-size:14px;margin:0 0 8px}
    table{width:100%;border-collapse:collapse}
    th,td{border:1px solid #ccc;padding:3px 6px;text-align:left;font-family:monospace}
    th{background:#f2f2f2}
    tr{break-inside:avoid}
  </style></head><body>
    <h1>${esc(titulo)}</h1>
    <table><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table>
  </body></html>`
}

// Margem (mm) necessária para caber uma faixa de `altura` px, com folga.
export function margemParaFaixa(faixa: Faixa, padraoMm: number): number {
  if (!faixa) return padraoMm
  return Math.round((faixa.altura * 25.4) / 96) + 6
}

/* istanbul ignore next -- glue do Playwright; não roda em testes (CI sem chromium) */
let browser: Browser | null = null
/* istanbul ignore next */
async function getBrowser(): Promise<Browser> {
  if (!browser || !browser.isConnected()) {
    browser = await chromium.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] })
  }
  return browser
}

/**
 * Renderiza o corpo HTML em PDF A4 com header/footer repetidos por página.
 * Glue do Playwright — coberto por verify manual, não por testes unitários.
 */
/* istanbul ignore next */
export async function gerarPdf(opts: {
  corpoHtml: string
  header: string
  footer: string
  margemTopoMm: number
  margemRodapeMm: number
}): Promise<Buffer> {
  const b = await getBrowser()
  const page = await b.newPage()
  try {
    await page.setContent(opts.corpoHtml, { waitUntil: 'networkidle' })
    return await page.pdf({
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: opts.header,
      footerTemplate: opts.footer,
      margin: { top: `${opts.margemTopoMm}mm`, bottom: `${opts.margemRodapeMm}mm`, left: '12mm', right: '12mm' },
    })
  } finally {
    await page.close()
  }
}
