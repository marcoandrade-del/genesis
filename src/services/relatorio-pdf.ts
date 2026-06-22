import { chromium, type Browser } from 'playwright'
import { montarRender } from './relatorio-totais.js'
import type { ElementoLayout } from './cabecalhos-rodapes.js'

export type DadosFaixa = {
  nomeEntidade: string
  enderecoEntidade: string
  nomeRelatorio: string
  brasao: string | null
  dataGeracao: string
  horaGeracao: string
}
export type Faixa = { altura: number; layout: unknown } | null
type ElLayout = ElementoLayout
export type ResultadoPdf = { colunas: string[]; linhas: unknown[][]; truncado?: boolean }

function esc(s: unknown): string {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
}

// CSS inline de formatação do elemento (fonte/estilo + âncora horizontal via transform).
function estiloElemento(el: ElLayout): string {
  const s: string[] = []
  if (el.fonte) s.push(`font-family:${el.fonte}`)
  if (el.tamanho) s.push(`font-size:${el.tamanho}px`)
  if (el.negrito) s.push('font-weight:bold')
  if (el.italico) s.push('font-style:italic')
  if (el.sublinhado) s.push('text-decoration:underline')
  if (el.alinhamento === 'center') s.push('transform:translateX(-50%)')
  else if (el.alinhamento === 'right') s.push('transform:translateX(-100%)')
  return s.join(';')
}

// Conteúdo de um elemento de faixa no PDF. NUMERO_PAGINA usa os spans nativos do
// Playwright (pageNumber/totalPages), que ele preenche por página.
function conteudoEl(el: ElLayout, d: DadosFaixa): string {
  switch (el.tipo) {
    case 'BRASAO': {
      if (!d.brasao) return ''
      const dim = [
        el.brasaoLargura ? `width:${el.brasaoLargura}px` : '',
        el.brasaoAltura ? `height:${el.brasaoAltura}px` : '',
      ].filter(Boolean).join(';')
      const estilo = dim || 'max-height:40px;max-width:120px'
      return `<img src="${esc(d.brasao)}" style="${estilo}">`
    }
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
    .map((el) => {
      const estilo = estiloElemento(el)
      return `<div style="position:absolute;left:${Number(el.x) || 0}%;top:${Number(el.y) || 0}%${estilo ? ';' + estilo : ''}">${conteudoEl(el, dados)}</div>`
    })
    .join('')
  return `<div style="position:relative;width:100%;height:${faixa.altura}px;font-size:10px;font-family:sans-serif;padding:0 12mm;box-sizing:border-box">${els}</div>`
}

/**
 * Documento HTML (corpo do PDF) com a tabela do resultado. Quando há colunas de
 * valor, insere subtotal por página (com quebra de página entre elas) e o total
 * geral no fim. `porPagina` = linhas-detalhe por página (0 = sem subtotais, só
 * total geral). O `<thead>` se repete em cada página (comportamento do Chromium).
 */
export function montarCorpoHtml(resultado: ResultadoPdf, titulo: string, porPagina = 0): string {
  const ths = resultado.colunas.map((c) => `<th>${esc(c)}</th>`).join('')
  let trs: string
  if (resultado.linhas.length === 0) {
    trs = `<tr><td colspan="${resultado.colunas.length || 1}" style="text-align:center;color:#888">Sem resultados.</td></tr>`
  } else {
    const { linhas } = montarRender(resultado, porPagina > 0 ? porPagina : resultado.linhas.length + 1)
    const idxSubs = linhas.flatMap((l, i) => (l.tipo === 'subtotal' ? [i] : []))
    const ultimoSub = idxSubs.length ? idxSubs[idxSubs.length - 1] : -1
    trs = linhas
      .map((l, i) => {
        const cls = l.tipo === 'detalhe' ? '' : ` class="${l.tipo}"`
        const quebra = l.tipo === 'subtotal' && i !== ultimoSub ? ';break-after:page' : ''
        const tds = l.celulas.map((c) => `<td>${esc(c)}</td>`).join('')
        return `<tr${cls} style="break-inside:avoid${quebra}">${tds}</tr>`
      })
      .join('')
  }
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><style>
    body{font-family:sans-serif;font-size:11px;color:#111;margin:0}
    h1{font-size:14px;margin:0 0 8px}
    table{width:100%;border-collapse:collapse}
    th,td{border:1px solid #ccc;padding:3px 6px;text-align:left;font-family:monospace}
    th{background:#f2f2f2}
    tr.subtotal td,tr.total td{font-weight:bold;background:#f2f2f2}
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
