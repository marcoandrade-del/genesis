import type { LinhaArrecadacao } from './arrecadacoes.js'
import type { LinhaSaldo } from './saldo-orcamentario.js'
import type { LinhaPrograma } from './programa-trabalho.js'

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
  legenda?: string // base legal (ex.: "Lei nº 1695/2025" ou "Projeto de Lei Orçamentária Anual")
  emissao?: string // carimbo já formatado (ex.: "26/06/2026 às 14:30"); vazio = não imprime
  emissaoLocal?: 'CABECALHO' | 'RODAPE' | 'NENHUM' // onde o carimbo aparece
  marcaDagua?: string // texto da marca d'água (versão não-final); ausente = sem marca
}

/** Carimbo de emissão a partir dos toggles da entidade (função pura, testável). */
export function formatarEmissao(d: Date, emitirData: boolean, emitirHora: boolean): string {
  const p = (n: number) => String(n).padStart(2, '0')
  const data = `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`
  const hora = `${p(d.getHours())}:${p(d.getMinutes())}`
  if (emitirData && emitirHora) return `${data} às ${hora}`
  if (emitirData) return data
  if (emitirHora) return hora
  return ''
}

export interface DadosReceitaPrevista {
  cabecalho: CabecalhoDemonstrativo
  porConta: LinhaArrecadacao[]
  porFonte: LinhaArrecadacao[]
  total: number
  codigoConta?: FormatoCodigo
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

export interface FormatoCodigo {
  modo: 'completo' | 'curto' | 'nivel'
  nivelMax: number
}

export const FORMATO_CODIGO_PADRAO: FormatoCodigo = { modo: 'curto', nivelMax: 4 }

/**
 * Formata o código PCASP (segmentos separados por ponto) das contas de
 * receita/despesa conforme o desejo do usuário:
 *  - `completo`: como está (`1.0.0.0.00...`)
 *  - `curto`: remove os zeros à direita (`1.0.0.0.00...` → `1`)
 *  - `nivel`: corta no nível escolhido (primeiros N segmentos)
 */
export function formatarCodigoConta(codigo: string, fmt: FormatoCodigo): string {
  const cod = String(codigo ?? '')
  const segs = cod.split('.')
  if (fmt.modo === 'completo') return cod
  if (fmt.modo === 'nivel') return segs.slice(0, Math.max(1, fmt.nivelMax)).join('.')
  let fim = segs.length
  while (fim > 1 && /^0+$/.test(segs[fim - 1]!)) fim--
  return segs.slice(0, fim).join('.')
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
  .dem-cab { border-bottom: 2px solid #0e0f0c; padding-bottom: 10px; margin-bottom: 16px; }
  .dem-cab-marca { display: flex; align-items: center; gap: 16px; }
  .dem-cab-marca img { height: 56px; width: auto; }
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
  .dem-emissao { color: #555; font-size: .78rem; margin-top: 2px; }
  .dem-rodape { margin-top: 18px; padding-top: 6px; border-top: 1px solid #e3e3e0; color: #555; font-size: .75rem; text-align: right; }
  .dem-marca { position: fixed; top: 45%; left: 0; right: 0; text-align: center; transform: rotate(-30deg);
    font-size: 84px; font-weight: 800; letter-spacing: 6px; text-transform: uppercase;
    color: rgba(190, 20, 20, .10); pointer-events: none; z-index: 0; }
  @media print {
    thead { display: table-header-group; }   /* repete o cabeçalho da tabela em cada página */
    tfoot { display: table-row-group; }
    tr { break-inside: avoid; }
    .dem-sec { break-after: avoid; }          /* título de seção não fica órfão no rodapé */
    .dem-cab { break-after: avoid; }
    .dem-rodape { display: none; }            /* no PDF o carimbo vai no rodapé por página (Playwright) */
  }
</style>`

/** Monta o corpo HTML do Demonstrativo da Receita Orçada (LOA). */
/** Cabeçalho oficial: brasão + entidade + município/exercício + base legal + título do anexo. */
function cabecalhoHtml(c: CabecalhoDemonstrativo, titulo: string): string {
  const brasao = c.brasao ? `<img src="${esc(c.brasao)}" alt="brasão">` : ''
  const legenda = c.legenda ? `<div class="dem-sub">${esc(c.legenda)}</div>` : ''
  const marca = c.marcaDagua ? `<div class="dem-marca">${esc(c.marcaDagua)}</div>` : ''
  const emissaoCab =
    c.emissaoLocal === 'CABECALHO' && c.emissao ? `<div class="dem-emissao">Emitido em ${esc(c.emissao)}</div>` : ''
  return (
    marca +
    `<header class="dem-cab">` +
    `<div class="dem-cab-marca">${brasao}<div class="dem-ent">${esc(c.entidadeNome)}</div></div>` +
    `<div class="dem-sub">${esc(c.municipio)} · ${esc(c.estado)} — Exercício ${c.ano}</div>` +
    legenda +
    emissaoCab +
    `<h1 class="dem-titulo">${esc(titulo)}</h1>` +
    `</header>`
  )
}

/** Bloco de rodapé com o carimbo de emissão (oculto no PDF — lá vai no rodapé por
 *  página do Playwright; visível na pré-visualização em tela). */
function rodapeHtml(c: CabecalhoDemonstrativo): string {
  return c.emissaoLocal === 'RODAPE' && c.emissao
    ? `<div class="dem-rodape">Relatório gerado em ${esc(c.emissao)}</div>`
    : ''
}

export function montarReceitaPrevista(dados: DadosReceitaPrevista): string {
  const { cabecalho: c, porFonte, total } = dados
  const fmt = dados.codigoConta ?? FORMATO_CODIGO_PADRAO
  const porConta = dados.porConta.map((l) => ({ ...l, codigo: formatarCodigoConta(l.codigo, fmt) }))
  return (
    ESTILO +
    `<div class="dem">` +
    cabecalhoHtml(c, 'Anexo 2, da Lei nº 4.320/64 — Resumo Geral da Receita') +
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
    rodapeHtml(c) +
    `</div>`
  )
}

interface RowDem {
  codigo: string
  rotulo: string
  nivel: number
  valor: number
}

function linhasGen(rows: RowDem[], total: number): string {
  return rows
    .map((l) => {
      const recuo = Math.max(0, l.nivel - 1) * 16
      return (
        `<tr class="dem-n${l.nivel}">` +
        `<td class="cod">${esc(l.codigo)}</td>` +
        `<td style="padding-left:${recuo}px">${esc(l.rotulo)}</td>` +
        `<td class="num">${formatarReais(l.valor)}</td>` +
        `<td class="num">${pct(l.valor, total)}</td>` +
        `</tr>`
      )
    })
    .join('')
}

function tabelaDespesa(col2: string, linhas: LinhaSaldo[], total: number, footLabel: string): string {
  const rows = linhas.map((l) => ({ codigo: l.codigo, rotulo: l.rotulo, nivel: l.nivel, valor: l.autorizado }))
  return (
    `<table class="dem-tab">` +
    `<thead><tr><th>Código</th><th>${esc(col2)}</th><th class="num">Fixado (R$)</th><th class="num">% do total</th></tr></thead>` +
    `<tbody>${linhasGen(rows, total)}</tbody>` +
    `<tfoot><tr><th colspan="2">${esc(footLabel)}</th><th class="num">${formatarReais(total)}</th><th class="num">100,0%</th></tr></tfoot>` +
    `</table>`
  )
}

export interface DadosDespesaFixada {
  cabecalho: CabecalhoDemonstrativo
  porUnidade: LinhaSaldo[]
  porFuncao: LinhaSaldo[]
  porConta: LinhaSaldo[]
  porFonte: LinhaSaldo[]
  total: number
  codigoConta?: FormatoCodigo
}

/** Monta o corpo HTML do Demonstrativo da Despesa Fixada (LOA), em 4 cortes. */
export function montarDespesaFixada(dados: DadosDespesaFixada): string {
  const { cabecalho: c, porUnidade, porFuncao, porFonte, total } = dados
  const fmt = dados.codigoConta ?? FORMATO_CODIGO_PADRAO
  const porConta = dados.porConta.map((l) => ({ ...l, codigo: formatarCodigoConta(l.codigo, fmt) }))
  return (
    ESTILO +
    `<div class="dem">` +
    cabecalhoHtml(c, 'Demonstrativos da Despesa Fixada') +
    `<h2 class="dem-sec">Anexo 2, da Lei nº 4.320/64 — Demonstração da Despesa por Unidades Orçamentárias</h2>` +
    tabelaDespesa('Unidade orçamentária', porUnidade, total, 'TOTAL') +
    `<h2 class="dem-sec">Anexo 9, da Lei nº 4.320/64 — Demonstrativo da Despesa por Funções</h2>` +
    tabelaDespesa('Função', porFuncao, total, 'TOTAL') +
    `<h2 class="dem-sec">Anexo 2, da Lei nº 4.320/64 — Natureza da Despesa Segundo as Categorias Econômicas</h2>` +
    tabelaDespesa('Natureza da despesa', porConta, total, 'TOTAL DA DESPESA FIXADA') +
    `<h2 class="dem-sec">Despesa fixada por fonte de recurso</h2>` +
    tabelaDespesa('Fonte de recurso', porFonte, total, 'TOTAL') +
    rodapeHtml(c) +
    `</div>`
  )
}

export interface DadosProgramaTrabalho {
  cabecalho: CabecalhoDemonstrativo
  linhas: LinhaPrograma[]
  total: number
  titulo?: string // default: Anexo 6
  descricao?: string // legenda da hierarquia
}

/** Monta o corpo HTML de um demonstrativo funcional-programático em árvore única
 *  (Anexo 6, Anexo 7, Despesa por Funções/Programas/Subprogramas — varia só o
 *  título/descrição e a ordem das dimensões já vem pronta em `linhas`). */
export function montarProgramaTrabalho(dados: DadosProgramaTrabalho): string {
  const { cabecalho: c, linhas, total } = dados
  const titulo = dados.titulo ?? 'Anexo 6, da Lei nº 4.320/64 — Programa de Trabalho'
  const descricao = dados.descricao ?? 'Despesa fixada por unidade orçamentária → função → subfunção → programa → ação.'
  return (
    ESTILO +
    `<div class="dem">` +
    cabecalhoHtml(c, titulo) +
    `<p class="dem-sub">${esc(descricao)}</p>` +
    `<table class="dem-tab">` +
    `<thead><tr><th>Código</th><th>Programa de trabalho</th><th class="num">Fixado (R$)</th><th class="num">% do total</th></tr></thead>` +
    `<tbody>${linhasGen(linhas, total)}</tbody>` +
    `<tfoot><tr><th colspan="2">TOTAL DA DESPESA FIXADA</th><th class="num">${formatarReais(total)}</th><th class="num">100,0%</th></tr></tfoot>` +
    `</table>` +
    rodapeHtml(c) +
    `</div>`
  )
}

export interface DadosSumarioGeral {
  cabecalho: CabecalhoDemonstrativo
  receitaPorFonte: LinhaArrecadacao[]
  despesaPorFuncao: LinhaSaldo[]
  totalReceita: number
  totalDespesa: number
}

function tabelaSumario(col2: string, rows: RowDem[], total: number, valorHead: string): string {
  return (
    `<table class="dem-tab">` +
    `<thead><tr><th>Código</th><th>${esc(col2)}</th><th class="num">${esc(valorHead)}</th><th class="num">% do total</th></tr></thead>` +
    `<tbody>${linhasGen(rows, total)}</tbody>` +
    `<tfoot><tr><th colspan="2">TOTAL</th><th class="num">${formatarReais(total)}</th><th class="num">100,0%</th></tr></tfoot>` +
    `</table>`
  )
}

/** Sumário Geral da Receita por Fontes e da Despesa por Funções do Governo. */
export function montarSumarioGeral(dados: DadosSumarioGeral): string {
  const { cabecalho: c, receitaPorFonte, despesaPorFuncao, totalReceita, totalDespesa } = dados
  const rec = receitaPorFonte.map((l) => ({ codigo: l.codigo, rotulo: l.rotulo, nivel: l.nivel, valor: l.previsto }))
  const desp = despesaPorFuncao.map((l) => ({ codigo: l.codigo, rotulo: l.rotulo, nivel: l.nivel, valor: l.autorizado }))
  const saldo = Math.round((totalReceita - totalDespesa) * 100) / 100
  return (
    ESTILO +
    `<div class="dem">` +
    cabecalhoHtml(c, 'Sumário Geral da Receita por Fontes e da Despesa por Funções do Governo') +
    `<h2 class="dem-sec">Receita por Fontes de Recurso</h2>` +
    tabelaSumario('Fonte de recurso', rec, totalReceita, 'Previsto (R$)') +
    `<h2 class="dem-sec">Despesa por Funções do Governo</h2>` +
    tabelaSumario('Função de governo', desp, totalDespesa, 'Fixado (R$)') +
    `<table class="dem-tab"><tfoot>` +
    `<tr><th colspan="2">TOTAL DA RECEITA</th><th class="num">${formatarReais(totalReceita)}</th></tr>` +
    `<tr><th colspan="2">TOTAL DA DESPESA</th><th class="num">${formatarReais(totalDespesa)}</th></tr>` +
    `<tr><th colspan="2">SUPERÁVIT / (DÉFICIT)</th><th class="num">${formatarReais(saldo)}</th></tr>` +
    `</tfoot></table>` +
    rodapeHtml(c) +
    `</div>`
  )
}

export interface DadosRcl {
  cabecalho: CabecalhoDemonstrativo
  correntes: { codigo: string; rotulo: string; valor: number }[]
  correntesTotal: number
  deducoes: { codigo: string; rotulo: string; valor: number }[]
  deducoesTotal: number
  rcl: number
}

/** Demonstrativo da Receita Corrente Líquida (RREO Anexo 3): receitas correntes
 *  − deduções legais = RCL. Quando não há deduções cadastradas, avisa que o
 *  valor é provisório (deduções a informar por Estado). */
export function montarRcl(dados: DadosRcl): string {
  const { cabecalho: c, correntes, correntesTotal, deducoes, deducoesTotal, rcl } = dados
  const linhaCorrente = (l: { codigo: string; rotulo: string; valor: number }) =>
    `<tr><td class="cod">${esc(l.codigo)}</td><td>${esc(l.rotulo)}</td><td class="num">${formatarReais(l.valor)}</td></tr>`
  const avisoDeducoes =
    deducoesTotal === 0
      ? `<div class="dem-sub" style="color:#b26a00;margin:6px 0">⚠ Deduções zeradas — RCL provisória. As naturezas de dedução são definidas por Estado/TCE (config) e dependem de dados que o orçamento ainda não traz.</div>`
      : ''
  return (
    ESTILO +
    `<div class="dem">` +
    cabecalhoHtml(c, 'RREO Anexo 3 — Demonstrativo da Receita Corrente Líquida') +
    `<h2 class="dem-sec">Receitas Correntes (I)</h2>` +
    `<table class="dem-tab">` +
    `<thead><tr><th>Código</th><th>Especificação</th><th class="num">Valor (R$)</th></tr></thead>` +
    `<tbody>${correntes.map(linhaCorrente).join('')}</tbody>` +
    `<tfoot><tr><th colspan="2">TOTAL DAS RECEITAS CORRENTES (I)</th><th class="num">${formatarReais(correntesTotal)}</th></tr></tfoot>` +
    `</table>` +
    `<h2 class="dem-sec">Deduções da RCL (II)</h2>` +
    avisoDeducoes +
    `<table class="dem-tab">` +
    `<thead><tr><th>Especificação</th><th class="num">Valor (R$)</th></tr></thead>` +
    `<tbody>${deducoes.map((l) => `<tr><td>${esc(l.rotulo)}</td><td class="num">${formatarReais(l.valor)}</td></tr>`).join('')}</tbody>` +
    `<tfoot><tr><th>TOTAL DAS DEDUÇÕES (II)</th><th class="num">${formatarReais(deducoesTotal)}</th></tr></tfoot>` +
    `</table>` +
    `<table class="dem-tab"><tfoot>` +
    `<tr><th colspan="2">RECEITA CORRENTE LÍQUIDA (III) = (I − II)</th><th class="num">${formatarReais(rcl)}</th></tr>` +
    `</tfoot></table>` +
    rodapeHtml(c) +
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
