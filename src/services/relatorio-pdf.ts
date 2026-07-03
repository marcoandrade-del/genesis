import { chromium, type Browser } from 'playwright'
import { montarRender, type TotaisConfig } from './relatorio-totais.js'

export type DadosFaixa = {
  nomeEntidade: string
  enderecoEntidade: string
  nomeRelatorio: string
  brasao: string | null
  dataGeracao: string
  horaGeracao: string
}
export type Faixa = { altura: number; layout: unknown } | null
type ElLayout = {
  tipo: string
  x: number
  y: number
  fonte?: string
  tamanho?: number
  negrito?: boolean
  italico?: boolean
  sublinhado?: boolean
  alinhamento?: string
  altura?: number
}
export type ResultadoPdf = { colunas: string[]; linhas: unknown[][]; truncado?: boolean }

function esc(s: unknown): string {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
}

// Conteúdo de um elemento de faixa no PDF. NUMERO_PAGINA usa os spans nativos do
// Playwright (pageNumber/totalPages), que ele preenche por página.
function conteudoEl(el: ElLayout, d: DadosFaixa): string {
  switch (el.tipo) {
    case 'BRASAO': {
      const h = Number(el.altura) || 40
      return d.brasao ? `<img src="${esc(d.brasao)}" style="max-height:${h}px">` : ''
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

const FONTE_CSS: Record<string, string> = { serif: 'serif', mono: 'monospace' }

/**
 * Estilo CSS de um elemento da faixa: posição + formatação opcional. O
 * `alinhamento` muda a âncora do x via translateX (centro/dir), permitindo
 * centralizar ou encostar na margem direita com precisão.
 */
export function estiloElemento(el: ElLayout): string {
  const partes = [`position:absolute`, `left:${Number(el.x) || 0}%`, `top:${Number(el.y) || 0}%`]
  if (el.alinhamento === 'centro') partes.push('transform:translateX(-50%)')
  else if (el.alinhamento === 'dir') partes.push('transform:translateX(-100%)')
  if (FONTE_CSS[el.fonte ?? '']) partes.push(`font-family:${FONTE_CSS[el.fonte!]}`)
  if (Number(el.tamanho)) partes.push(`font-size:${Number(el.tamanho)}px`)
  if (el.negrito) partes.push('font-weight:bold')
  if (el.italico) partes.push('font-style:italic')
  if (el.sublinhado) partes.push('text-decoration:underline')
  return partes.join(';')
}

/**
 * Faixa como LINHAS DE TEXTO (p/ exportações não-PDF: TXT/HTML/DOCX/XLSX).
 * Resolve os mesmos elementos do PDF, exceto BRASAO (imagem) e NUMERO_PAGINA
 * (não há páginas fora do PDF). Elementos são agrupados em linhas pela
 * proximidade vertical (mesma banda de y) e ordenados por x.
 */
export function textoDaFaixa(faixa: Faixa, d: DadosFaixa): string[] {
  if (!faixa) return []
  const lista: ElLayout[] = Array.isArray(faixa.layout) ? (faixa.layout as ElLayout[]) : []
  const texto = (el: ElLayout): string => {
    switch (el.tipo) {
      case 'NOME_ENTIDADE': return d.nomeEntidade
      case 'NOME_RELATORIO': return d.nomeRelatorio
      case 'DATA_GERACAO': return d.dataGeracao
      case 'HORA_GERACAO': return d.horaGeracao
      case 'ENDERECO_ENTIDADE': return d.enderecoEntidade
      default: return '' // BRASAO/NUMERO_PAGINA não têm equivalente textual
    }
  }
  const els = lista
    .map((el) => ({ x: Number(el.x) || 0, y: Number(el.y) || 0, txt: texto(el).trim() }))
    .filter((e) => e.txt)
    .sort((a, b) => a.y - b.y || a.x - b.x)
  const linhas: string[] = []
  let yAtual = -999
  for (const e of els) {
    if (Math.abs(e.y - yAtual) > 12) {
      linhas.push(e.txt)
      yAtual = e.y
    } else {
      linhas[linhas.length - 1] += ` · ${e.txt}`
    }
  }
  return linhas
}

/** Template de faixa (header/footer) do Playwright a partir do layout. */
export function montarTemplateFaixa(faixa: Faixa, dados: DadosFaixa): string {
  if (!faixa) return '<span></span>'
  const lista: ElLayout[] = Array.isArray(faixa.layout) ? (faixa.layout as ElLayout[]) : []
  const els = lista
    .map((el) => `<div style="${estiloElemento(el)}">${conteudoEl(el, dados)}</div>`)
    .join('')
  return `<div style="position:relative;width:100%;height:${faixa.altura}px;font-size:10px;font-family:sans-serif;padding:0 12mm;box-sizing:border-box">${els}</div>`
}

/**
 * Documento HTML (corpo do PDF) com a tabela do resultado. Insere subtotal de
 * soma por página (com quebra de página entre elas, quando ligado na config) e
 * o bloco de resumo no fim — uma linha rotulada por agregação configurada.
 * `porPagina` = linhas-detalhe por página (0 = sem subtotais). O `<thead>` se
 * repete em cada página (comportamento do Chromium).
 */
export function montarCorpoHtml(resultado: ResultadoPdf, titulo: string, porPagina = 0, cfg: TotaisConfig | null = null): string {
  const ths = resultado.colunas.map((c) => `<th>${esc(c)}</th>`).join('')
  const render = montarRender(resultado, porPagina > 0 ? porPagina : resultado.linhas.length + 1, cfg)
  let trs: string
  if (resultado.linhas.length === 0) {
    trs = `<tr><td colspan="${resultado.colunas.length || 1}" style="text-align:center;color:#888">Sem resultados.</td></tr>`
  } else {
    const { linhas } = render
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
  const resumo = render.resumo.length
    ? `<div class="resumo" style="break-inside:avoid">${render.resumo
        .map((it) => `<div>${esc(it.rotulo)}: <strong>${esc(it.texto)}</strong></div>`)
        .join('')}${render.parcial ? '<div class="parcial">Valores parciais — o resultado foi truncado.</div>' : ''}</div>`
    : ''
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><style>
    body{font-family:sans-serif;font-size:11px;color:#111;margin:0}
    h1{font-size:14px;margin:0 0 8px}
    table{width:100%;border-collapse:collapse}
    th,td{border:1px solid #ccc;padding:3px 6px;text-align:left;font-family:monospace}
    th{background:#f2f2f2}
    tr.subtotal td{font-weight:bold;background:#f2f2f2}
    .resumo{margin-top:8px;font-family:monospace;font-size:11px}
    .resumo .parcial{color:#888;font-style:italic}
  </style></head><body>
    <h1>${esc(titulo)}</h1>
    <table><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table>
    ${resumo}
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
