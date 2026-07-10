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
