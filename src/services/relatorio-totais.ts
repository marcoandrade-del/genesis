// Totais dos relatórios. Default (sem configuração salva): toda coluna cujo
// conteúdo das linhas-detalhe é numérico ganha soma — "Total de <coluna>" no fim
// e "Total da página" onde há páginas (PDF e prévia). O usuário pode configurar
// por coluna quais agregações quer (soma/contagem/média/menor/maior), com rótulo
// editável, e desligar o subtotal por página; a configuração fica em
// `RelatorioPersonalizado.configuracao.totais`. Tudo computado em tempo de
// render, então o default vale para relatórios já existentes, sem migração.

import { ErroNegocio } from '../errors.js'

export type ResultadoBase = { colunas: string[]; linhas: unknown[][]; truncado?: boolean }

export type AggTipo = 'SOMA' | 'CONTAGEM' | 'MEDIA' | 'MINIMO' | 'MAXIMO'
export type TotalConfigItem = { coluna: string; agg: AggTipo; rotulo?: string }
export type TotaisConfig = { subtotalPagina: boolean; itens: TotalConfigItem[] }

export const AGG_TIPOS: { id: AggTipo; label: string }[] = [
  { id: 'SOMA', label: 'Soma' },
  { id: 'CONTAGEM', label: 'Contagem' },
  { id: 'MEDIA', label: 'Média' },
  { id: 'MINIMO', label: 'Menor' },
  { id: 'MAXIMO', label: 'Maior' },
]
const AGG_VALIDOS = new Set<string>(AGG_TIPOS.map((a) => a.id))

/** Rótulo default de uma agregação: prefixo + título da coluna (editável pelo usuário). */
export function rotuloPadrao(agg: AggTipo, coluna: string): string {
  switch (agg) {
    case 'SOMA': return `Total de ${coluna}`
    case 'CONTAGEM': return `Contagem de ${coluna}`
    case 'MEDIA': return `Média de ${coluna}`
    case 'MINIMO': return `Menor ${coluna}`
    case 'MAXIMO': return `Maior ${coluna}`
  }
}

const pad2 = (n: number) => String(n).padStart(2, '0')
const dataBR = (d: Date) => `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`

/** Formata uma célula-detalhe como texto (datas em pt-BR; resto como veio). */
export function celula(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (v instanceof Date) return dataBR(v)
  return String(v)
}

// Converte em número apenas number e strings 100% numéricas (ponto decimal, como
// o pg devolve `numeric`). Datas/booleanos/texto → null (coluna não é de valor).
// Strings com zero à esquerda (001, 007) são tratadas como CÓDIGO, não valor —
// senão códigos de conta entrariam nos totais. Limitação aceita: um inteiro "puro"
// que seja identificador/ano (ex.: 2026) ainda é somável; basta o usuário
// desmarcar a soma da coluna no painel "Totais" da prévia.
function parseNum(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string') {
    const s = v.trim()
    if (s === '' || /^-?0\d/.test(s)) return null
    const n = Number(s)
    return Number.isFinite(n) ? n : null
  }
  return null
}

// Só é chamada após parseNum aceitar o valor (string numérica ou number).
function casasDecimais(v: unknown): number {
  const s = typeof v === 'string' ? v : String(v)
  const i = s.indexOf('.')
  return i < 0 ? 0 : s.length - i - 1
}

export type Totais = {
  /** Por coluna: true se toda célula não-vazia é numérica e há ≥1 valor. */
  numericas: boolean[]
  /** Soma da coluna (sobre todas as linhas); 0 nas colunas não-numéricas. */
  soma: number[]
  /** Máximo de casas decimais vistas por coluna (p/ arredondar/formatar). */
  decimais: number[]
  /** Células não-vazias por coluna (qualquer tipo — alimenta a Contagem). */
  contagem: number[]
  /** Menor/maior valor numérico por coluna; null nas não-numéricas/vazias. */
  minimo: (number | null)[]
  maximo: (number | null)[]
  algumaNumerica: boolean
}

/** Analisa as colunas: quais são de valor, soma/contagem/mín/máx e casas decimais. */
export function analisarColunas(r: ResultadoBase): Totais {
  const n = r.colunas.length
  const viu = new Array<boolean>(n).fill(false)
  const invalida = new Array<boolean>(n).fill(false)
  const soma = new Array<number>(n).fill(0)
  const decimais = new Array<number>(n).fill(0)
  const contagem = new Array<number>(n).fill(0)
  const minimo = new Array<number | null>(n).fill(null)
  const maximo = new Array<number | null>(n).fill(null)
  for (const row of r.linhas) {
    for (let i = 0; i < n; i++) {
      const v = row[i]
      if (v === null || v === undefined || v === '') continue
      contagem[i]!++
      const num = parseNum(v)
      if (num === null) {
        invalida[i] = true
        continue
      }
      viu[i] = true
      soma[i]! += num
      if (minimo[i] === null || num < minimo[i]!) minimo[i] = num
      if (maximo[i] === null || num > maximo[i]!) maximo[i] = num
      const c = casasDecimais(v)
      if (c > decimais[i]!) decimais[i] = c
    }
  }
  const numericas = viu.map((v, i) => v && !invalida[i])
  // Arredonda às casas da coluna — mata o ruído de ponto flutuante (0.1+0.2…).
  for (let i = 0; i < n; i++) if (numericas[i]) soma[i] = Number(soma[i]!.toFixed(decimais[i]))
  return { numericas, soma, decimais, contagem, minimo, maximo, algumaNumerica: numericas.some(Boolean) }
}

// ── Configuração de totais ──────────────────────────────────────

/** Config default: soma em toda coluna numérica detectada + subtotal por página. */
export function configPadrao(r: ResultadoBase, t: Totais = analisarColunas(r)): TotaisConfig {
  return {
    subtotalPagina: true,
    itens: r.colunas.flatMap((coluna, i) => (t.numericas[i] ? [{ coluna, agg: 'SOMA' as AggTipo }] : [])),
  }
}

/** Config a usar: a salva no relatório, ou a default por detecção automática. */
export function configEfetiva(r: ResultadoBase, salva: TotaisConfig | null, t: Totais = analisarColunas(r)): TotaisConfig {
  return salva ?? configPadrao(r, t)
}

const ROTULO_MAX = 120

/**
 * Valida/sanitiza a configuração vinda do form da prévia. null/'' → null
 * (volta ao automático). Lança ErroNegocio em estrutura malformada.
 */
export function validarTotaisConfig(raw: unknown): TotaisConfig | null {
  if (raw === null || raw === undefined || raw === '') return null
  const obj = raw as { subtotalPagina?: unknown; itens?: unknown }
  if (typeof raw !== 'object' || !Array.isArray(obj.itens)) {
    throw new ErroNegocio('REQUISICAO_INVALIDA', 'Configuração de totais inválida.')
  }
  const itens: TotalConfigItem[] = obj.itens.map((it) => {
    const { coluna, agg, rotulo } = (it ?? {}) as { coluna?: unknown; agg?: unknown; rotulo?: unknown }
    if (typeof coluna !== 'string' || !coluna.trim() || typeof agg !== 'string' || !AGG_VALIDOS.has(agg)) {
      throw new ErroNegocio('REQUISICAO_INVALIDA', 'Configuração de totais inválida.')
    }
    const r = typeof rotulo === 'string' ? rotulo.trim().slice(0, ROTULO_MAX) : ''
    return { coluna: coluna.trim(), agg: agg as AggTipo, ...(r ? { rotulo: r } : {}) }
  })
  return { subtotalPagina: obj.subtotalPagina !== false && obj.subtotalPagina !== 'false', itens }
}

/** Lê a config de totais persistida em `configuracao.totais` (tolerante a lixo). */
export function lerTotaisConfig(configuracao: unknown): TotaisConfig | null {
  const raw = (configuracao as { totais?: unknown } | null)?.totais
  if (!raw) return null
  try {
    return validarTotaisConfig(raw)
  } catch {
    return null
  }
}

// ── Cálculo das agregações ──────────────────────────────────────

/** Valor formatado de uma agregação na coluna i, ou null se não se aplica
 *  (coluna fora do resultado / não-numérica para soma/média/mín/máx). */
export function valorAgg(t: Totais, i: number, agg: AggTipo): { texto: string; numero: number } | null {
  if (agg === 'CONTAGEM') {
    return { texto: String(t.contagem[i]), numero: t.contagem[i]! }
  }
  if (!t.numericas[i] || t.contagem[i] === 0) return null
  const dec = t.decimais[i]!
  switch (agg) {
    case 'SOMA':
      return { texto: t.soma[i]!.toFixed(dec), numero: t.soma[i]! }
    case 'MEDIA': {
      // média ganha ao menos 2 casas (soma de inteiros raramente divide exato)
      const m = Number((t.soma[i]! / t.contagem[i]!).toFixed(Math.max(dec, 2)))
      return { texto: m.toFixed(Math.max(dec, 2)), numero: m }
    }
    case 'MINIMO':
      return { texto: t.minimo[i]!.toFixed(dec), numero: t.minimo[i]! }
    case 'MAXIMO':
      return { texto: t.maximo[i]!.toFixed(dec), numero: t.maximo[i]! }
  }
}

export type ResumoTotal = { rotulo: string; texto: string; numero: number }

/**
 * Linhas de resumo do fim do relatório — uma por agregação configurada, com o
 * rótulo do usuário ou o default concatenado ("Total de <coluna>"). Itens cuja
 * coluna sumiu do resultado (query mudou) ou não se aplica são ignorados.
 * Sem linhas-detalhe → sem resumo.
 */
export function resumoTotais(r: ResultadoBase, cfg: TotaisConfig, t: Totais = analisarColunas(r)): ResumoTotal[] {
  if (r.linhas.length === 0) return []
  const out: ResumoTotal[] = []
  for (const item of cfg.itens) {
    const i = r.colunas.indexOf(item.coluna)
    if (i < 0) continue
    const v = valorAgg(t, i, item.agg)
    if (!v) continue
    out.push({ rotulo: item.rotulo || rotuloPadrao(item.agg, item.coluna), texto: v.texto, numero: v.numero })
  }
  return out
}

// ── Subtotal por página (só soma) ───────────────────────────────

// Colunas que entram no subtotal por página: as numéricas com SOMA marcada.
function colunasSoma(r: ResultadoBase, cfg: TotaisConfig, t: Totais): boolean[] {
  const marcadas = new Set(cfg.itens.filter((it) => it.agg === 'SOMA').map((it) => it.coluna))
  return r.colunas.map((c, i) => Boolean(t.numericas[i]) && marcadas.has(c))
}

function somarLinhas(t: Totais, somaveis: boolean[], n: number, linhas: unknown[][]): number[] {
  const soma = new Array<number>(n).fill(0)
  for (const row of linhas) {
    for (let i = 0; i < n; i++) {
      if (!somaveis[i]) continue
      const num = parseNum(row[i])
      if (num !== null) soma[i]! += num
    }
  }
  return soma.map((s, i) => (somaveis[i] ? Number(s.toFixed(t.decimais[i])) : 0))
}

/** Coluna que recebe o rótulo do subtotal: a 1ª não-somada; se todas forem
 *  somadas, cai na coluna 0 (o rótulo tem prioridade sobre a soma dela),
 *  garantindo o rótulo sempre visível. */
export const indiceRotulo = (somaveis: boolean[]): number => {
  const i = somaveis.indexOf(false)
  return i >= 0 ? i : 0
}

/** Monta a linha de subtotal (string[]): rótulo na coluna escolhida; demais
 *  colunas somadas com a soma formatada nas casas da coluna. */
export function linhaTotal(t: Totais, somaveis: boolean[], colunas: string[], soma: number[], rotulo: string): string[] {
  const idx = indiceRotulo(somaveis)
  return colunas.map((_, i) => {
    if (i === idx) return rotulo
    if (somaveis[i]) return soma[i]!.toFixed(t.decimais[i])
    return ''
  })
}

export type Pagina = { linhas: unknown[][]; subtotal: string[] }

/** Quebra as linhas em páginas de `porPagina`, cada uma com seu subtotal (soma). */
export function paginar(r: ResultadoBase, t: Totais, somaveis: boolean[], porPagina: number): Pagina[] {
  const k = Math.max(1, Math.floor(porPagina))
  const paginas: Pagina[] = []
  for (let off = 0; off < r.linhas.length; off += k) {
    const linhas = r.linhas.slice(off, off + k)
    paginas.push({
      linhas,
      subtotal: linhaTotal(t, somaveis, r.colunas, somarLinhas(t, somaveis, r.colunas.length, linhas), 'Total da página'),
    })
  }
  return paginas
}

export type LinhaRender = { tipo: 'detalhe' | 'subtotal'; celulas: string[] }

export type Render = {
  /** Linhas da tabela: detalhes + subtotal de soma fechando cada página. */
  linhas: LinhaRender[]
  /** Resumo do fim — uma linha rotulada por agregação configurada. */
  resumo: ResumoTotal[]
  /** true quando o resultado foi truncado e há totais (valores parciais). */
  parcial: boolean
  /** Colunas numéricas detectadas (alimenta o painel de configuração). */
  numericas: boolean[]
}

/**
 * Estrutura de render (prévia/PDF): linhas-detalhe + subtotal de soma por página
 * (só quando há mais de uma página e o subtotal está ligado na config) + resumo
 * final com uma linha por agregação. `cfgSalva` null → default automático.
 */
export function montarRender(r: ResultadoBase, porPagina: number, cfgSalva: TotaisConfig | null = null): Render {
  const t = analisarColunas(r)
  const cfg = configEfetiva(r, cfgSalva, t)
  const detalhes = (linhas: unknown[][]): LinhaRender[] => linhas.map((row) => ({ tipo: 'detalhe', celulas: row.map(celula) }))
  const resumo = resumoTotais(r, cfg, t)
  const somaveis = colunasSoma(r, cfg, t)
  const comSubtotal = cfg.subtotalPagina && somaveis.some(Boolean) && r.linhas.length > 0
  let linhas: LinhaRender[]
  if (!comSubtotal) {
    linhas = detalhes(r.linhas)
  } else {
    const paginas = paginar(r, t, somaveis, porPagina)
    linhas = []
    for (const p of paginas) {
      linhas.push(...detalhes(p.linhas))
      if (paginas.length > 1) linhas.push({ tipo: 'subtotal', celulas: p.subtotal })
    }
  }
  return { linhas, resumo, parcial: Boolean(r.truncado) && resumo.length > 0, numericas: t.numericas }
}

// Geometria A4 retrato p/ estimar linhas por página (conservador, evita estouro).
const A4_ALTURA_MM = 297
const LINHA_MM = 6.3
const RESERVA_MM = 18 // título + cabeçalho da tabela + folga

/** Linhas-detalhe que cabem numa página A4, dadas as margens das faixas (mm). */
export function linhasPorPagina(margemTopoMm: number, margemRodapeMm: number): number {
  const util = A4_ALTURA_MM - margemTopoMm - margemRodapeMm - RESERVA_MM
  return Math.min(80, Math.max(5, Math.floor(util / LINHA_MM) - 1))
}
