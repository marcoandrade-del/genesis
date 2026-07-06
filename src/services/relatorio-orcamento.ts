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
  nota?: string // metodologia aplicada (ex.: "TCE-PR")
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
    (dados.nota ? `<div class="dem-sub">Metodologia: ${esc(dados.nota)}</div>` : '') +
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

export interface DadosGuardiao {
  cabecalho: CabecalhoDemonstrativo
  metodologia: string
  indicadores: {
    indicador: string
    unidade: string
    valor: number
    base: number
    percentual: number
    limite: number | null
    nivel: string
    memorial: { descricao: string; baseLegal: string }
  }[]
}

const NIVEL_TXT: Record<string, string> = {
  ok: 'Dentro do limite',
  alerta: 'Alerta do TCE',
  prudencial: 'Limite prudencial',
  estouro: 'Acima do limite',
  abaixo_minimo: 'Abaixo do mínimo constitucional',
}

/** Demonstrativo do Guardião LRF: os indicadores fiscais (RCL, Pessoal, aplicação
 *  por função) calculados no Gênesis, com %, limite, situação e memória de cálculo. */
export function montarGuardiao(dados: DadosGuardiao): string {
  const { cabecalho: c, indicadores } = dados
  const pct = (v: number) => v.toFixed(1).replace('.', ',') + '%'
  const linha = (i: DadosGuardiao['indicadores'][number]) =>
    `<tr><td>${esc(i.indicador)}</td><td class="num">${formatarReais(i.valor)}</td><td class="num">${formatarReais(i.base)}</td><td class="num">${pct(i.percentual)}</td><td class="num">${i.limite != null ? pct(i.limite) : '—'}</td><td>${i.limite != null ? (NIVEL_TXT[i.nivel] ?? i.nivel) : 'informativo'}</td></tr>`
  const memoriais = indicadores
    .map((i) => `<div class="dem-sub" style="margin:4px 0"><strong>${esc(i.indicador)}:</strong> ${esc(i.memorial.descricao)} <em>(${esc(i.memorial.baseLegal)})</em></div>`)
    .join('')
  return (
    ESTILO +
    `<div class="dem">` +
    cabecalhoHtml(c, 'Guardião LRF — Indicadores Fiscais') +
    `<div class="dem-sub">Metodologia: ${esc(dados.metodologia)} · cálculo único no Gênesis</div>` +
    `<table class="dem-tab">` +
    `<thead><tr><th>Indicador</th><th class="num">Valor (R$)</th><th class="num">Base (R$)</th><th class="num">%</th><th class="num">Limite</th><th>Situação</th></tr></thead>` +
    `<tbody>${indicadores.map(linha).join('')}</tbody>` +
    `</table>` +
    `<h2 class="dem-sec">Memórias de cálculo</h2>` +
    memoriais +
    rodapeHtml(c) +
    `</div>`
  )
}

export interface DadosDespesaPessoal {
  cabecalho: CabecalhoDemonstrativo
  inclusoes: { rotulo: string; valor: number }[]
  inclusoesTotal: number
  exclusoes: { rotulo: string; valor: number }[]
  exclusoesTotal: number
  despesaLiquida: number
  rcl: number
  percentual: number
  limite: number
  prudencial: number
  alerta: number
  nivel: string
  nota?: string // metodologia aplicada
}

/** Demonstrativo da Despesa com Pessoal (RGF Anexo 1, LRF arts. 18-20):
 *  Despesa Bruta (inclusões) − Despesas Não Computadas (exclusões) = Despesa
 *  Total com Pessoal; comparada à RCL (limite 54%, prudencial 95%, alerta 90%). */
export function montarDespesaPessoal(dados: DadosDespesaPessoal): string {
  const { cabecalho: c, inclusoes, inclusoesTotal, exclusoes, exclusoesTotal, despesaLiquida, rcl, percentual, limite, prudencial, alerta, nivel } = dados
  const pct = (v: number) => v.toFixed(2).replace('.', ',') + '%'
  const linha = (l: { rotulo: string; valor: number }) =>
    `<tr><td>${esc(l.rotulo)}</td><td class="num">${formatarReais(l.valor)}</td></tr>`
  const situacao = NIVEL_TXT[nivel] ?? nivel
  return (
    ESTILO +
    `<div class="dem">` +
    cabecalhoHtml(c, 'RGF Anexo 1 — Demonstrativo da Despesa com Pessoal') +
    (dados.nota ? `<div class="dem-sub">Metodologia: ${esc(dados.nota)} · base: dotação autorizada</div>` : '') +
    `<h2 class="dem-sec">Despesa Bruta com Pessoal (I)</h2>` +
    `<table class="dem-tab">` +
    `<thead><tr><th>Especificação</th><th class="num">Valor (R$)</th></tr></thead>` +
    `<tbody>${inclusoes.map(linha).join('')}</tbody>` +
    `<tfoot><tr><th>TOTAL DA DESPESA BRUTA (I)</th><th class="num">${formatarReais(inclusoesTotal)}</th></tr></tfoot>` +
    `</table>` +
    `<h2 class="dem-sec">Despesas Não Computadas (II)</h2>` +
    `<table class="dem-tab">` +
    `<thead><tr><th>Especificação</th><th class="num">Valor (R$)</th></tr></thead>` +
    `<tbody>${exclusoes.map(linha).join('')}</tbody>` +
    `<tfoot><tr><th>TOTAL NÃO COMPUTADO (II)</th><th class="num">${formatarReais(exclusoesTotal)}</th></tr></tfoot>` +
    `</table>` +
    `<table class="dem-tab"><tfoot>` +
    `<tr><th colspan="2">DESPESA TOTAL COM PESSOAL (III) = (I − II)</th><th class="num">${formatarReais(despesaLiquida)}</th></tr>` +
    `<tr><td colspan="2">Receita Corrente Líquida (RCL)</td><td class="num">${formatarReais(rcl)}</td></tr>` +
    `<tr><th colspan="2">% DA DESPESA COM PESSOAL SOBRE A RCL (III ÷ RCL)</th><th class="num">${pct(percentual)} — ${esc(situacao)}</th></tr>` +
    `</tfoot></table>` +
    `<div class="dem-sub" style="margin-top:6px">Limite legal: ${pct(limite)} (LRF art. 20 — Executivo municipal) · prudencial ${pct(prudencial)} (art. 22) · alerta ${pct(alerta)} (art. 59, TCE).</div>` +
    rodapeHtml(c) +
    `</div>`
  )
}

export interface DadosRclConsolidada {
  cabecalho: CabecalhoDemonstrativo
  entidades: { nome: string; correntes: number; deducoes: number; rcl: number }[]
  correntesTotal: number
  deducoesTotal: number
  intra: number
  rclTotal: number
  metodologia: string
}

/** RCL consolidada do município: contribuição (correntes/deduções/RCL) de cada
 *  entidade + os totais do ente. A linha de duplicidades intragovernamentais
 *  aparece (a apurar). */
export function montarRclConsolidada(dados: DadosRclConsolidada): string {
  const { cabecalho: c, entidades, correntesTotal, deducoesTotal, intra, rclTotal } = dados
  const linha = (e: { nome: string; correntes: number; deducoes: number; rcl: number }) =>
    `<tr><td>${esc(e.nome)}</td><td class="num">${formatarReais(e.correntes)}</td><td class="num">${formatarReais(e.deducoes)}</td><td class="num">${formatarReais(e.rcl)}</td></tr>`
  return (
    ESTILO +
    `<div class="dem">` +
    cabecalhoHtml(c, 'Demonstrativo Consolidado da Receita Corrente Líquida — Município') +
    `<div class="dem-sub">Metodologia: ${esc(dados.metodologia)} · soma das entidades do município (o RPPS entra pela entidade de previdência)</div>` +
    `<h2 class="dem-sec">Por entidade</h2>` +
    `<table class="dem-tab">` +
    `<thead><tr><th>Entidade</th><th class="num">Receitas Correntes</th><th class="num">Deduções</th><th class="num">RCL</th></tr></thead>` +
    `<tbody>${entidades.map(linha).join('')}</tbody>` +
    `<tfoot><tr><th>TOTAL DO MUNICÍPIO</th><th class="num">${formatarReais(correntesTotal)}</th><th class="num">${formatarReais(deducoesTotal)}</th><th class="num">${formatarReais(rclTotal)}</th></tr></tfoot>` +
    `</table>` +
    `<table class="dem-tab"><tfoot>` +
    `<tr><th colspan="2">Receitas Correntes (I)</th><th class="num">${formatarReais(correntesTotal)}</th></tr>` +
    `<tr><th colspan="2">(−) Deduções da RCL (II)</th><th class="num">${formatarReais(deducoesTotal)}</th></tr>` +
    `<tr><th colspan="2">(−) Transferências intragovernamentais — duplicidades (a apurar)</th><th class="num">${formatarReais(intra)}</th></tr>` +
    `<tr><th colspan="2">RECEITA CORRENTE LÍQUIDA CONSOLIDADA</th><th class="num">${formatarReais(rclTotal)}</th></tr>` +
    `</tfoot></table>` +
    rodapeHtml(c) +
    `</div>`
  )
}

export interface DadosIndicesConstitucionais {
  cabecalho: CabecalhoDemonstrativo
  metodologia: string
  base: { rotulo: string; valor: number }[]
  baseTotal: number
  mde: { linhas: { rotulo: string; valor: number }[]; total: number; percentual: number; minimo: number; atende: boolean }
  asps: { linhas: { rotulo: string; valor: number }[]; total: number; percentual: number; minimo: number; atende: boolean }
}

/** Demonstrativo dos índices constitucionais de aplicação mínima: MDE (CF art.
 *  212, ≥25%) e ASPS (LC 141, ≥15%) — despesa por fonte vinculada ÷ base de
 *  impostos e transferências. */
export function montarIndicesConstitucionais(dados: DadosIndicesConstitucionais): string {
  const { cabecalho: c, base, baseTotal, mde, asps } = dados
  const pct = (v: number) => v.toFixed(2).replace('.', ',') + '%'
  const linha = (l: { rotulo: string; valor: number }) =>
    `<tr><td>${esc(l.rotulo)}</td><td class="num">${formatarReais(l.valor)}</td></tr>`
  const bloco = (titulo: string, r: DadosIndicesConstitucionais['mde'], baseLegal: string) =>
    `<h2 class="dem-sec">${esc(titulo)}</h2>` +
    `<table class="dem-tab">` +
    `<thead><tr><th>Aplicação por fonte de recurso</th><th class="num">Valor (R$)</th></tr></thead>` +
    `<tbody>${r.linhas.map(linha).join('') || '<tr><td colspan="2">— sem despesa nas fontes vinculadas —</td></tr>'}</tbody>` +
    `<tfoot>` +
    `<tr><th>APLICAÇÃO TOTAL</th><th class="num">${formatarReais(r.total)}</th></tr>` +
    `<tr><th>% SOBRE A BASE DE IMPOSTOS (mínimo ${pct(r.minimo)})</th><th class="num">${pct(r.percentual)} — ${r.atende ? 'Atende' : 'Abaixo do mínimo constitucional'}</th></tr>` +
    `</tfoot></table>` +
    `<div class="dem-sub">${esc(baseLegal)}</div>`
  return (
    ESTILO +
    `<div class="dem">` +
    cabecalhoHtml(c, 'Índices Constitucionais — MDE e ASPS') +
    `<div class="dem-sub">Metodologia: ${esc(dados.metodologia)} · base: dotação autorizada × fonte de recurso real (QDD)</div>` +
    `<h2 class="dem-sec">Base de cálculo — impostos e transferências (I)</h2>` +
    `<table class="dem-tab">` +
    `<thead><tr><th>Especificação</th><th class="num">Valor (R$)</th></tr></thead>` +
    `<tbody>${base.map(linha).join('')}</tbody>` +
    `<tfoot><tr><th>TOTAL DA BASE (I)</th><th class="num">${formatarReais(baseTotal)}</th></tr></tfoot>` +
    `</table>` +
    bloco('Manutenção e Desenvolvimento do Ensino — MDE (II)', mde, 'CF art. 212: mínimo de 25% da receita de impostos e transferências em manutenção e desenvolvimento do ensino.') +
    bloco('Ações e Serviços Públicos de Saúde — ASPS (III)', asps, 'CF art. 198 / LC 141 art. 7º: mínimo de 15% da receita de impostos e transferências em ações e serviços públicos de saúde (recursos próprios).') +
    rodapeHtml(c) +
    `</div>`
  )
}

export interface DadosDisponibilidadeFonte {
  cabecalho: CabecalhoDemonstrativo
  linhas: { fonte: string; nomenclatura: string; caixa: number; rpProcessados: number; rpNaoProcessados: number; disponibilidade: number }[]
  totais: { caixa: number; rpProcessados: number; rpNaoProcessados: number; disponibilidade: number }
}

/** RGF Anexo 5 — Disponibilidade de Caixa e Restos a Pagar por fonte de
 *  recurso: caixa bruta − RP (processados e não processados) = líquida. */
export function montarDisponibilidadeFonte(dados: DadosDisponibilidadeFonte): string {
  const { cabecalho: c, linhas, totais } = dados
  const neg = (v: number) => (v < 0 ? ' style="color:#b00"' : '')
  const linha = (l: DadosDisponibilidadeFonte['linhas'][number]) =>
    `<tr><td>${esc(l.fonte)}${l.nomenclatura ? ` — ${esc(l.nomenclatura)}` : ''}</td>` +
    `<td class="num">${formatarReais(l.caixa)}</td>` +
    `<td class="num">${formatarReais(l.rpProcessados)}</td>` +
    `<td class="num">${formatarReais(l.rpNaoProcessados)}</td>` +
    `<td class="num"${neg(l.disponibilidade)}>${formatarReais(l.disponibilidade)}</td></tr>`
  return (
    ESTILO +
    `<div class="dem">` +
    cabecalhoHtml(c, 'RGF Anexo 5 — Disponibilidade de Caixa e Restos a Pagar') +
    `<div class="dem-sub">Por fonte de recurso · caixa = saldo bancário acumulado das contas da fonte · RP sobre o razão de empenhos (fonte real da dotação)</div>` +
    `<table class="dem-tab">` +
    `<thead><tr><th>Fonte de recurso</th><th class="num">Disponibilidade de caixa bruta (I)</th><th class="num">RP processados (II)</th><th class="num">RP não processados (III)</th><th class="num">Disponibilidade líquida (I−II−III)</th></tr></thead>` +
    `<tbody>${linhas.map(linha).join('')}</tbody>` +
    `<tfoot><tr><th>TOTAL</th><th class="num">${formatarReais(totais.caixa)}</th><th class="num">${formatarReais(totais.rpProcessados)}</th><th class="num">${formatarReais(totais.rpNaoProcessados)}</th><th class="num"${neg(totais.disponibilidade)}>${formatarReais(totais.disponibilidade)}</th></tr></tfoot>` +
    `</table>` +
    `<div class="dem-sub">LRF art. 55, III. Sem execução da despesa lançada, os restos a pagar são zero e o demonstrativo reflete apenas o caixa por fonte.</div>` +
    rodapeHtml(c) +
    `</div>`
  )
}

export interface DadosDespesaFuncaoRreo {
  cabecalho: CabecalhoDemonstrativo
  linhas: { codigo: string; rotulo: string; autorizado: number; reservado: number; empenhado: number; disponivel: number }[]
  resumo: { autorizado: number; reservado: number; empenhado: number; disponivel: number }
}

/** RREO — Execução da despesa por FUNÇÃO de governo: dotação autorizada,
 *  reservado, empenhado, disponível e participação de cada função no total. */
export function montarDespesaFuncaoRreo(dados: DadosDespesaFuncaoRreo): string {
  const { cabecalho: c, linhas, resumo } = dados
  const pct = (v: number) => (resumo.autorizado > 0 ? ((v / resumo.autorizado) * 100).toFixed(2).replace('.', ',') + '%' : '—')
  const linha = (l: DadosDespesaFuncaoRreo['linhas'][number]) =>
    `<tr><td>${esc(l.codigo)} — ${esc(l.rotulo)}</td>` +
    `<td class="num">${formatarReais(l.autorizado)}</td>` +
    `<td class="num">${formatarReais(l.reservado)}</td>` +
    `<td class="num">${formatarReais(l.empenhado)}</td>` +
    `<td class="num">${formatarReais(l.disponivel)}</td>` +
    `<td class="num">${pct(l.autorizado)}</td></tr>`
  return (
    ESTILO +
    `<div class="dem">` +
    cabecalhoHtml(c, 'RREO — Execução da Despesa por Função de Governo') +
    `<div class="dem-sub">Dotação autorizada, reserva e empenho por função · % = participação da função na despesa autorizada</div>` +
    `<table class="dem-tab">` +
    `<thead><tr><th>Função</th><th class="num">Dotação autorizada</th><th class="num">Reservado</th><th class="num">Empenhado</th><th class="num">Disponível</th><th class="num">%</th></tr></thead>` +
    `<tbody>${linhas.map(linha).join('')}</tbody>` +
    `<tfoot><tr><th>TOTAL</th><th class="num">${formatarReais(resumo.autorizado)}</th><th class="num">${formatarReais(resumo.reservado)}</th><th class="num">${formatarReais(resumo.empenhado)}</th><th class="num">${formatarReais(resumo.disponivel)}</th><th class="num">100,00%</th></tr></tfoot>` +
    `</table>` +
    rodapeHtml(c) +
    `</div>`
  )
}

export interface DadosMetasFiscais {
  cabecalho: CabecalhoDemonstrativo
  linhas: { rotulo: string; valorMeta: number; exercicioReferencia: number; projetado: number | null; diferenca: number | null }[]
}

/** Metas Fiscais da LDO × projetado da LOA (LRF art. 4º §1º): meta, projeção
 *  da base (quando existe) e diferença. */
export function montarMetasFiscais(dados: DadosMetasFiscais): string {
  const { cabecalho: c, linhas } = dados
  const neg = (v: number) => (v < 0 ? ' style="color:#b00"' : '')
  const linha = (l: DadosMetasFiscais['linhas'][number]) =>
    `<tr><td>${esc(l.rotulo)} <span class="dem-sub">(LDO ${l.exercicioReferencia})</span></td>` +
    `<td class="num">${formatarReais(l.valorMeta)}</td>` +
    `<td class="num">${l.projetado != null ? formatarReais(l.projetado) : '—'}</td>` +
    `<td class="num"${l.diferenca != null ? neg(l.diferenca) : ''}>${l.diferenca != null ? formatarReais(l.diferenca) : 'sem projeção na base'}</td></tr>`
  return (
    ESTILO +
    `<div class="dem">` +
    cabecalhoHtml(c, 'Metas Fiscais — LDO × Projetado da LOA') +
    `<div class="dem-sub">Anexo de Metas Fiscais (LRF art. 4º §1º) · projetado = receita orçada / despesa autorizada da LOA; resultado primário/nominal e dívida exigem execução (sem projeção na base)</div>` +
    `<table class="dem-tab">` +
    `<thead><tr><th>Meta</th><th class="num">Meta (LDO)</th><th class="num">Projetado (LOA)</th><th class="num">Diferença</th></tr></thead>` +
    `<tbody>${linhas.map(linha).join('')}</tbody>` +
    `</table>` +
    rodapeHtml(c) +
    `</div>`
  )
}

export const MESES_ABREV = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']

export interface DadosRgfAnexo1 {
  cabecalho: CabecalhoDemonstrativo
  quadrimestre: { rotulo: string; prazoPublicacao: string; parcial: boolean }
  mesCorte: number // 1–12: colunas jan..corte
  inclusoes: { rotulo: string; mensal: number[]; total: number }[]
  inclusoesTotal: number
  exclusoes: { rotulo: string; mensal: number[]; total: number }[]
  exclusoesTotal: number
  dtp: number
  rcl: number
  rclRealizada: number
  percentual: number
  nivel: string
  nota?: string // metodologia
}

/** RGF Anexo 1 OFICIAL (MDF 9ª ed.): DTP EXECUTADA (liquidada) mês a mês até o
 *  corte do quadrimestre, com o bloco de limites em R$ e % (54/51,3/48,6 da
 *  RCL). Difere do demonstrativo por dotação autorizada (projeção), que segue
 *  existindo à parte. RCL do exercício ≈ RCL 12 meses (aproximação declarada). */
export function montarRgfAnexo1(dados: DadosRgfAnexo1): string {
  const { cabecalho: c, quadrimestre: qd, mesCorte, inclusoes, inclusoesTotal, exclusoes, exclusoesTotal, dtp, rcl, rclRealizada, percentual, nivel } = dados
  const meses = MESES_ABREV.slice(0, Math.min(12, Math.max(1, mesCorte)))
  const pctF = (v: number) => v.toFixed(2).replace('.', ',') + '%'
  const cabMeses = meses.map((m) => `<th class="num">${m}</th>`).join('')
  const linha = (l: { rotulo: string; mensal: number[]; total: number }) =>
    `<tr><td>${esc(l.rotulo)}</td>` +
    meses.map((_, i) => `<td class="num">${formatarReais(l.mensal[i] ?? 0)}</td>`).join('') +
    `<td class="num"><strong>${formatarReais(l.total)}</strong></td></tr>`
  const totalRow = (rotulo: string, linhas: { mensal: number[] }[], total: number) =>
    `<tr><th>${esc(rotulo)}</th>` +
    meses.map((_, i) => `<th class="num">${formatarReais(linhas.reduce((a, l) => a + (l.mensal[i] ?? 0), 0))}</th>`).join('') +
    `<th class="num">${formatarReais(total)}</th></tr>`
  const tabela = (titulo: string, linhas: { rotulo: string; mensal: number[]; total: number }[], rotuloTotal: string, total: number) =>
    `<h2 class="dem-sec">${esc(titulo)}</h2>` +
    `<table class="dem-tab dem-tab-meses">` +
    `<thead><tr><th>Especificação</th>${cabMeses}<th class="num">TOTAL</th></tr></thead>` +
    `<tbody>${linhas.map(linha).join('')}</tbody>` +
    `<tfoot>${totalRow(rotuloTotal, linhas, total)}</tfoot>` +
    `</table>`
  const limite = (rotulo: string, pctLim: number) =>
    `<tr><td>${esc(rotulo)}</td><td class="num">${formatarReais(Math.round(rcl * pctLim) / 100)}</td><td class="num">${pctF(pctLim)}</td></tr>`
  const situacao = NIVEL_TXT[nivel] ?? nivel
  return (
    ESTILO +
    `<style>.dem-tab-meses{font-size:.68rem}.dem-tab-meses th,.dem-tab-meses td{padding:3px 5px}</style>` +
    `<div class="dem">` +
    cabecalhoHtml(c, 'RGF Anexo 1 — Demonstrativo da Despesa com Pessoal (MDF 9ª ed.)') +
    `<div class="dem-sub">Período de referência: ${esc(qd.rotulo)}${qd.parcial ? ' — <strong>posição parcial</strong> (quadrimestre em andamento)' : ''} · Publicação até ${esc(qd.prazoPublicacao)} (LRF art. 55 §2º)</div>` +
    (dados.nota ? `<div class="dem-sub">Metodologia: ${esc(dados.nota)} · base: despesa LIQUIDADA no exercício (execução capturada)</div>` : '') +
    tabela('Despesa Bruta com Pessoal (I)', inclusoes, 'TOTAL DA DESPESA BRUTA (I)', inclusoesTotal) +
    tabela('Despesas Não Computadas (II) — LRF art. 19 §1º', exclusoes, 'TOTAL NÃO COMPUTADO (II)', exclusoesTotal) +
    `<table class="dem-tab"><tfoot>` +
    `<tr><th>DESPESA TOTAL COM PESSOAL — DTP (III) = (I − II)</th><th class="num">${formatarReais(dtp)}</th><th class="num">—</th></tr>` +
    `<tr><td>RECEITA CORRENTE LÍQUIDA — RCL (IV)</td><td class="num">${formatarReais(rcl)}</td><td class="num">—</td></tr>` +
    `<tr><td>RCL AJUSTADA (V) = (IV)</td><td class="num">${formatarReais(rcl)}</td><td class="num">—</td></tr>` +
    `<tr><th>% DA DTP SOBRE A RCL AJUSTADA (VI) = (III ÷ V)</th><th class="num">—</th><th class="num">${pctF(percentual)}</th></tr>` +
    limite('LIMITE MÁXIMO (VII) — LRF art. 20, III, "b"', 54) +
    limite('LIMITE PRUDENCIAL (VIII) = 0,95 × (VII) — LRF art. 22', 51.3) +
    limite('LIMITE DE ALERTA (IX) = 0,90 × (VII) — LRF art. 59 §1º, II', 48.6) +
    `</tfoot></table>` +
    `<div class="dem-sub">Situação: <strong>${esc(situacao)}</strong> · RCL realizada acumulada no exercício: ${formatarReais(rclRealizada)} (informativo)</div>` +
    `<div class="dem-sub">Nota metodológica: RCL apurada pela previsão anual do exercício — aproximação da RCL dos últimos 12 meses (LRF art. 2º §3º); a execução disponível cobre o exercício corrente.</div>` +
    rodapeHtml(c) +
    `</div>`
  )
}

export interface DadosRgfAnexo2 {
  cabecalho: CabecalhoDemonstrativo
  quadrimestre: { rotulo: string; prazoPublicacao: string; parcial: boolean }
  dividaPorCategoria: { rotulo: string; total: number }[]
  dividaTotal: number
  deducoes: { caixa: number; rpProcessados: number; total: number }
  dcl: number
  rcl: number
  pctDc: number // DC ÷ RCL
  pctDcl: number // DCL ÷ RCL
  nivel: string
  metaLdo: number | null
  temDivida: boolean
}

const neg = (v: number) => (v < 0 ? ' style="color:#b00"' : '')

/** RGF Anexo 2 (MDF 9ª ed.): Dívida Consolidada (I) − deduções de caixa/RP
 *  (II) = DCL (III), com %DC/%DCL sobre a RCL e limite de 120% (Res. Senado
 *  40/2001; alerta 108%, LRF art. 59 §1º). A DCL informada na LDO aparece como
 *  comparativo — Δ é informação, não erro. */
export function montarRgfAnexo2(dados: DadosRgfAnexo2): string {
  const { cabecalho: c, quadrimestre: qd, dividaPorCategoria, dividaTotal, deducoes, dcl, rcl, pctDc, pctDcl, nivel, metaLdo } = dados
  const pctF = (v: number) => v.toFixed(2).replace('.', ',') + '%'
  const linhaCat = (l: { rotulo: string; total: number }) =>
    `<tr><td>${esc(l.rotulo)}</td><td class="num">${formatarReais(l.total)}</td></tr>`
  const situacao = NIVEL_TXT[nivel] ?? nivel
  return (
    ESTILO +
    `<div class="dem">` +
    cabecalhoHtml(c, 'RGF Anexo 2 — Demonstrativo da Dívida Consolidada Líquida (MDF 9ª ed.)') +
    `<div class="dem-sub">Período de referência: ${esc(qd.rotulo)}${qd.parcial ? ' — <strong>posição parcial</strong>' : ''} · Publicação até ${esc(qd.prazoPublicacao)} (LRF art. 55 §2º)</div>` +
    (!dados.temDivida ? `<div class="dem-sub"><strong>Sem itens no cadastro da dívida</strong> — o estoque aparece zerado até o cadastro (Cadastros do RGF).</div>` : '') +
    `<h2 class="dem-sec">Dívida Consolidada — DC (I)</h2>` +
    `<table class="dem-tab">` +
    `<thead><tr><th>Especificação</th><th class="num">Saldo (R$)</th></tr></thead>` +
    `<tbody>${dividaPorCategoria.map(linhaCat).join('')}</tbody>` +
    `<tfoot><tr><th>DÍVIDA CONSOLIDADA (I)</th><th class="num">${formatarReais(dividaTotal)}</th></tr></tfoot>` +
    `</table>` +
    `<h2 class="dem-sec">Deduções (II)</h2>` +
    `<table class="dem-tab">` +
    `<thead><tr><th>Especificação</th><th class="num">Valor (R$)</th></tr></thead>` +
    `<tbody>` +
    `<tr><td>Disponibilidade de caixa bruta</td><td class="num">${formatarReais(deducoes.caixa)}</td></tr>` +
    `<tr><td>(−) Restos a pagar processados</td><td class="num">${formatarReais(deducoes.rpProcessados)}</td></tr>` +
    `</tbody>` +
    `<tfoot><tr><th>TOTAL DAS DEDUÇÕES (II)</th><th class="num">${formatarReais(deducoes.total)}</th></tr></tfoot>` +
    `</table>` +
    `<table class="dem-tab"><tfoot>` +
    `<tr><th>DÍVIDA CONSOLIDADA LÍQUIDA — DCL (III) = (I − II)</th><th class="num"${neg(dcl)}>${formatarReais(dcl)}</th></tr>` +
    `<tr><td>RECEITA CORRENTE LÍQUIDA — RCL</td><td class="num">${formatarReais(rcl)}</td></tr>` +
    `<tr><td>% DA DC SOBRE A RCL (I ÷ RCL)</td><td class="num">${pctF(pctDc)}</td></tr>` +
    `<tr><th>% DA DCL SOBRE A RCL (III ÷ RCL)</th><th class="num">${pctF(pctDcl)}</th></tr>` +
    `<tr><td>LIMITE — 120% da RCL (Res. Senado 40/2001)</td><td class="num">${formatarReais(Math.round(rcl * 120) / 100)}</td></tr>` +
    `<tr><td>LIMITE DE ALERTA — 108% da RCL (LRF art. 59 §1º, III)</td><td class="num">${formatarReais(Math.round(rcl * 108) / 100)}</td></tr>` +
    `</tfoot></table>` +
    `<div class="dem-sub">Situação: <strong>${esc(situacao)}</strong>` +
    (metaLdo != null ? ` · DCL informada na LDO: <span${neg(metaLdo)}>${formatarReais(metaLdo)}</span> (comparativo — a diferença reflete o que a base ainda não captura, ex.: saldos bancários reais)` : '') +
    `</div>` +
    rodapeHtml(c) +
    `</div>`
  )
}

export interface DadosRgfAnexo3 {
  cabecalho: CabecalhoDemonstrativo
  quadrimestre: { rotulo: string; prazoPublicacao: string; parcial: boolean }
  garantiasPorTipo: { rotulo: string; total: number; contragarantias: number }[]
  total: number
  contragarantias: number
  rcl: number
  percentual: number
  nivel: string
}

/** RGF Anexo 3 (MDF 9ª ed.): garantias e contragarantias de valores — total
 *  concedido × limite de 22% da RCL (Res. Senado 43/2001 art. 9º; alerta 19,8%). */
export function montarRgfAnexo3(dados: DadosRgfAnexo3): string {
  const { cabecalho: c, quadrimestre: qd, garantiasPorTipo, total, contragarantias, rcl, percentual, nivel } = dados
  const pctF = (v: number) => v.toFixed(2).replace('.', ',') + '%'
  const situacao = NIVEL_TXT[nivel] ?? nivel
  return (
    ESTILO +
    `<div class="dem">` +
    cabecalhoHtml(c, 'RGF Anexo 3 — Demonstrativo das Garantias e Contragarantias de Valores (MDF 9ª ed.)') +
    `<div class="dem-sub">Período de referência: ${esc(qd.rotulo)}${qd.parcial ? ' — <strong>posição parcial</strong>' : ''} · Publicação até ${esc(qd.prazoPublicacao)} (LRF art. 55 §2º)</div>` +
    `<h2 class="dem-sec">Garantias concedidas (I)</h2>` +
    `<table class="dem-tab">` +
    `<thead><tr><th>Tipo</th><th class="num">Garantias (R$)</th><th class="num">Contragarantias (R$)</th></tr></thead>` +
    `<tbody>${garantiasPorTipo.map((g) => `<tr><td>${esc(g.rotulo)}</td><td class="num">${formatarReais(g.total)}</td><td class="num">${formatarReais(g.contragarantias)}</td></tr>`).join('')}</tbody>` +
    `<tfoot><tr><th>TOTAL (I)</th><th class="num">${formatarReais(total)}</th><th class="num">${formatarReais(contragarantias)}</th></tr></tfoot>` +
    `</table>` +
    `<table class="dem-tab"><tfoot>` +
    `<tr><td>RECEITA CORRENTE LÍQUIDA — RCL</td><td class="num">${formatarReais(rcl)}</td></tr>` +
    `<tr><th>% DAS GARANTIAS SOBRE A RCL (I ÷ RCL)</th><th class="num">${pctF(percentual)}</th></tr>` +
    `<tr><td>LIMITE — 22% da RCL (Res. Senado 43/2001, art. 9º)</td><td class="num">${formatarReais(Math.round(rcl * 22) / 100)}</td></tr>` +
    `<tr><td>LIMITE DE ALERTA — 19,80% da RCL (LRF art. 59 §1º)</td><td class="num">${formatarReais(Math.round(rcl * 19.8) / 100)}</td></tr>` +
    `</tfoot></table>` +
    `<div class="dem-sub">Situação: <strong>${esc(situacao)}</strong>${total === 0 ? ' · sem garantias concedidas no exercício (situação comum em municípios)' : ''}</div>` +
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
