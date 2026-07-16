/** Helpers do padrão PCASP — agnósticos de fabricante. */

/** Remove acentos e pontuação, baixa a caixa. Usado para casar descrições. */
export function normalizarDescricao(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** Código pontuado "significativo": sem os segmentos zerados à direita.
 * Ex. "1.1.1.0.00.0.0.00.00.00.00.00" → "1.1.1". */
export function significativo(codigo: string): string {
  const p = codigo.split('.')
  while (p.length > 1 && /^0+$/.test(p[p.length - 1]!)) p.pop()
  return p.join('.')
}

/** `a` é ancestral (ou igual) de `b` na hierarquia de código pontuado? */
export function ehAncestral(a: string, b: string): boolean {
  const sa = significativo(a)
  const sb = significativo(b)
  return sa === sb || sb.startsWith(sa + '.')
}

/** Nível (1-based) do último segmento não-zero de um código pontuado. */
export function nivelDe(codigo: string): number {
  const segs = codigo.split('.')
  let n = 1
  for (let i = 0; i < segs.length; i++) if (parseInt(segs[i]!, 10) !== 0) n = i + 1
  return n
}

/** Cadeia de códigos ancestrais (nível 1..nível-da-folha), zerando os segmentos
 * abaixo de cada nível. Ex. "7.2.1.0…" → ["7.0.0.0…","7.2.0.0…","7.2.1.0…"]. */
export function ancestrais(codigo: string): string[] {
  const segs = codigo.split('.')
  const nivel = nivelDe(codigo)
  const out: string[] = []
  for (let k = 1; k <= nivel; k++) out.push(segs.map((s, i) => (i < k ? s : '0'.repeat(s.length))).join('.'))
  return out
}

/** Larguras dos 12 grupos da natureza da receita PCASP (padrão nacional; soma 18 dígitos). */
const GRUPOS_RECEITA = [1, 1, 1, 1, 2, 1, 1, 2, 2, 2, 2, 2] as const

/**
 * Natureza da receita (pontuada OU dígitos crus) → PCASP pontuada de 12 grupos.
 * Padrão NACIONAL, agnóstico de fabricante/fonte. Ex.: "13210111" →
 * "1.3.2.1.01.1.1.00.00.00.00.00"; "1.7.1.8" → completado com zeros.
 * (O Betha tem uma cópia própria em `fabricantes/betha/codigo.ts` — dedup futuro.)
 */
export function naturezaReceita(raw: string): string {
  const s = (raw || '').trim()
  const grupos = (p: string[]): string => {
    const q = [...p]
    for (let i = q.length; i < GRUPOS_RECEITA.length; i++) q.push('0'.repeat(GRUPOS_RECEITA[i]!))
    return q.join('.')
  }
  if (s.includes('.')) return grupos(s.replace(/\.+$/, '').split('.'))
  const d = s.replace(/\D/g, '')
  const partes: string[] = []
  let i = 0
  for (const g of GRUPOS_RECEITA) {
    if (i >= d.length) break
    partes.push(d.slice(i, i + g))
    i += g
  }
  return grupos(partes)
}
