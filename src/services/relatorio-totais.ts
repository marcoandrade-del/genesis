// Totais automáticos dos relatórios: toda coluna cujo conteúdo das linhas-detalhe
// é numérico ganha "Total geral" (em todo formato) e "Total da página" (onde há
// páginas — PDF e prévia). Tudo computado em tempo de render, então vale também
// para relatórios já existentes, sem migração.

export type ResultadoBase = { colunas: string[]; linhas: unknown[][]; truncado?: boolean }

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
// que seja identificador/ano (ex.: 2026) ainda é somável; basta o usuário formatá-lo
// na query se não quiser totalizá-lo.
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

function casasDecimais(v: unknown): number {
  const s = typeof v === 'string' ? v : typeof v === 'number' ? String(v) : ''
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
  algumaNumerica: boolean
}

/** Analisa as colunas: quais são de valor, soma e casas decimais de cada uma. */
export function analisarColunas(r: ResultadoBase): Totais {
  const n = r.colunas.length
  const viu = new Array<boolean>(n).fill(false)
  const invalida = new Array<boolean>(n).fill(false)
  const soma = new Array<number>(n).fill(0)
  const decimais = new Array<number>(n).fill(0)
  for (const row of r.linhas) {
    for (let i = 0; i < n; i++) {
      const v = row[i]
      if (v === null || v === undefined || v === '') continue
      const num = parseNum(v)
      if (num === null) {
        invalida[i] = true
        continue
      }
      viu[i] = true
      soma[i]! += num
      const c = casasDecimais(v)
      if (c > decimais[i]!) decimais[i] = c
    }
  }
  const numericas = viu.map((v, i) => v && !invalida[i])
  // Arredonda às casas da coluna — mata o ruído de ponto flutuante (0.1+0.2…).
  for (let i = 0; i < n; i++) if (numericas[i]) soma[i] = Number(soma[i]!.toFixed(decimais[i]))
  return { numericas, soma, decimais, algumaNumerica: numericas.some(Boolean) }
}

function somarLinhas(t: Totais, n: number, linhas: unknown[][]): number[] {
  const soma = new Array<number>(n).fill(0)
  for (const row of linhas) {
    for (let i = 0; i < n; i++) {
      if (!t.numericas[i]) continue
      const num = parseNum(row[i])
      if (num !== null) soma[i]! += num
    }
  }
  return soma.map((s, i) => (t.numericas[i] ? Number(s.toFixed(t.decimais[i])) : 0))
}

/** Coluna que recebe o rótulo do total: a 1ª não-numérica; se todas forem de
 *  valor, cai na coluna 0 (o rótulo tem prioridade sobre a soma dela — somar
 *  uma coluna de id/sequência não faz sentido), garantindo o rótulo sempre visível. */
export const indiceRotulo = (numericas: boolean[]): number => {
  const i = numericas.indexOf(false)
  return i >= 0 ? i : 0
}

/** Monta a linha de totais (string[]): rótulo na coluna escolhida; demais
 *  colunas de valor com a soma formatada nas casas da coluna. */
export function linhaTotal(t: Totais, colunas: string[], soma: number[], rotulo: string): string[] {
  const idx = indiceRotulo(t.numericas)
  return colunas.map((_, i) => {
    if (i === idx) return rotulo
    if (t.numericas[i]) return soma[i]!.toFixed(t.decimais[i])
    return ''
  })
}

export const rotuloGeral = (truncado?: boolean) => (truncado ? 'TOTAL GERAL (parcial)' : 'TOTAL GERAL')

/** Linha de total geral pronta (ou null se o relatório não tem colunas de valor). */
export function totalGeralRow(r: ResultadoBase, t: Totais = analisarColunas(r)): string[] | null {
  if (!t.algumaNumerica || r.linhas.length === 0) return null
  return linhaTotal(t, r.colunas, t.soma, rotuloGeral(r.truncado))
}

export type Pagina = { linhas: unknown[][]; subtotal: string[] }

/** Quebra as linhas em páginas de `porPagina`, cada uma com seu subtotal. */
export function paginar(r: ResultadoBase, t: Totais, porPagina: number): Pagina[] {
  const k = Math.max(1, Math.floor(porPagina))
  const paginas: Pagina[] = []
  for (let off = 0; off < r.linhas.length; off += k) {
    const linhas = r.linhas.slice(off, off + k)
    paginas.push({ linhas, subtotal: linhaTotal(t, r.colunas, somarLinhas(t, r.colunas.length, linhas), 'Total da página') })
  }
  return paginas
}

export type LinhaRender =
  | { tipo: 'detalhe'; celulas: string[] }
  | { tipo: 'subtotal'; celulas: string[] }
  | { tipo: 'total'; celulas: string[] }

/**
 * Lista de linhas para render (prévia/PDF): detalhes + subtotal por página
 * (só quando há mais de uma página) + total geral. Cada subtotal "fecha" uma
 * página; quem renderiza decide a quebra visual/de impressão.
 */
export function montarRender(r: ResultadoBase, porPagina: number): { linhas: LinhaRender[]; algumaNumerica: boolean } {
  const t = analisarColunas(r)
  const detalhes = (linhas: unknown[][]): LinhaRender[] => linhas.map((row) => ({ tipo: 'detalhe', celulas: row.map(celula) }))
  if (!t.algumaNumerica || r.linhas.length === 0) {
    return { linhas: detalhes(r.linhas), algumaNumerica: false }
  }
  const paginas = paginar(r, t, porPagina)
  const out: LinhaRender[] = []
  for (const p of paginas) {
    out.push(...detalhes(p.linhas))
    if (paginas.length > 1) out.push({ tipo: 'subtotal', celulas: p.subtotal })
  }
  out.push({ tipo: 'total', celulas: linhaTotal(t, r.colunas, t.soma, rotuloGeral(r.truncado)) })
  return { linhas: out, algumaNumerica: true }
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
