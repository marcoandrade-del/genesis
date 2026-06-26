import type { LinhaArrecadacao } from './arrecadacoes.js'

/**
 * Geração do HTML dos demonstrativos imprimíveis do orçamento (LOA). Funções
 * puras (string → string) para serem reusadas tanto pela tela (`<%- corpo %>`)
 * quanto pelo PDF (Playwright `gerarPdf`), e testáveis sem servidor.
 */

export interface CabecalhoDemonstrativo {
  entidadeNome: string
  municipio: string
  estado: string
  ano: number
  brasao?: string | null
}

export interface DadosReceitaPrevista {
  cabecalho: CabecalhoDemonstrativo
  porConta: LinhaArrecadacao[]
  porFonte: LinhaArrecadacao[]
  total: number
}

/** Escapa texto para HTML (nomes de conta/fonte podem, em tese, ter `<`/`&`). */
function esc(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Formata número em reais no padrão pt-BR (1.234.567,89). */
export function formatarReais(n: number): string {
  return Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function pct(valor: number, total: number): string {
  if (!total) return '0,0%'
  return (Math.round((valor / total) * 1000) / 10).toLocaleString('pt-BR', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }) + '%'
}

function linhasHtml(linhas: LinhaArrecadacao[], total: number): string {
  return linhas
    .map((l) => {
      const recuo = Math.max(0, l.nivel - 1) * 16
      return (
        `<tr class="dem-n${l.nivel}">` +
        `<td class="cod">${esc(l.codigo)}</td>` +
        `<td style="padding-left:${recuo}px">${esc(l.rotulo)}</td>` +
        `<td class="num">${formatarReais(l.previsto)}</td>` +
        `<td class="num">${pct(l.previsto, total)}</td>` +
        `</tr>`
      )
    })
    .join('')
}

const ESTILO = `<style>
  .dem { font-family: 'Inter', Arial, sans-serif; color: #0e0f0c; }
  .dem-cab { display: flex; align-items: center; gap: 16px; border-bottom: 2px solid #0e0f0c; padding-bottom: 10px; margin-bottom: 16px; }
  .dem-cab img { height: 56px; width: auto; }
  .dem-ent { font-weight: 800; font-size: 1.05rem; }
  .dem-sub { color: #555; font-size: .8rem; }
  .dem-titulo { font-size: 1rem; margin: 4px 0 0; }
  .dem-tab { width: 100%; border-collapse: collapse; font-size: .8rem; margin-bottom: 18px; }
  .dem-tab th, .dem-tab td { padding: 4px 8px; border-bottom: 1px solid #e3e3e0; text-align: left; }
  .dem-tab thead th { background: #f3f4f1; border-bottom: 1.5px solid #0e0f0c; }
  .dem-tab .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .dem-tab .cod { font-variant-numeric: tabular-nums; color: #555; white-space: nowrap; }
  .dem-tab tfoot th { border-top: 2px solid #0e0f0c; background: #f3f4f1; }
  .dem-n1 td { font-weight: 700; }
  .dem-n2 td { font-weight: 600; }
  .dem-sec { font-size: .9rem; margin: 0 0 6px; }
</style>`

/** Monta o corpo HTML do Demonstrativo da Receita Orçada (LOA). */
export function montarReceitaPrevista(dados: DadosReceitaPrevista): string {
  const { cabecalho: c, porConta, porFonte, total } = dados
  const brasao = c.brasao ? `<img src="${esc(c.brasao)}" alt="brasão">` : ''
  return (
    ESTILO +
    `<div class="dem">` +
    `<header class="dem-cab">${brasao}<div>` +
    `<div class="dem-ent">${esc(c.entidadeNome)}</div>` +
    `<div class="dem-sub">${esc(c.municipio)} · ${esc(c.estado)} — Exercício ${c.ano}</div>` +
    `<h1 class="dem-titulo">Demonstrativo da Receita Orçada — LOA ${c.ano}</h1>` +
    `</div></header>` +
    `<table class="dem-tab">` +
    `<thead><tr><th>Código</th><th>Especificação da receita</th><th class="num">Previsto (R$)</th><th class="num">% do total</th></tr></thead>` +
    `<tbody>${linhasHtml(porConta, total)}</tbody>` +
    `<tfoot><tr><th colspan="2">TOTAL DA RECEITA PREVISTA</th><th class="num">${formatarReais(total)}</th><th class="num">100,0%</th></tr></tfoot>` +
    `</table>` +
    `<h2 class="dem-sec">Receita prevista por fonte de recurso</h2>` +
    `<table class="dem-tab">` +
    `<thead><tr><th>Código</th><th>Fonte de recurso</th><th class="num">Previsto (R$)</th><th class="num">% do total</th></tr></thead>` +
    `<tbody>${linhasHtml(porFonte, total)}</tbody>` +
    `<tfoot><tr><th colspan="2">TOTAL</th><th class="num">${formatarReais(total)}</th><th class="num">100,0%</th></tr></tfoot>` +
    `</table>` +
    `</div>`
  )
}

/** Embrulha um corpo de demonstrativo num documento HTML completo para o PDF. */
export function documentoPdf(titulo: string, corpo: string): string {
  return (
    `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">` +
    `<title>${esc(titulo)}</title></head><body>${corpo}</body></html>`
  )
}
