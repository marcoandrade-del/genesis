/**
 * Decodificação dos códigos do IPM (atende.net) → padrão PCASP.
 *
 * O código do IPM tem 19 dígitos: o 1º é um MARCADOR (4=receita, 9=redutora da
 * receita, 3=despesa) e os 18 seguintes seguem a estrutura pontuada abaixo.
 * Descoberto na conversão de Paranaguá — ver memória `import-paranagua-ipm`.
 */

/** Larguras dos 12 segmentos do código pontuado (soma 18 dígitos). */
const SEG = [1, 1, 1, 1, 2, 1, 1, 2, 2, 2, 2, 2] as const

/** "4111000000000000000" → "1.1.1.0.00.0.0.00.00.00.00.00" (natureza da receita). */
export function naturezaReceita(cod19: string): string {
  const d = cod19.slice(1)
  const p: string[] = []
  let i = 0
  for (const w of SEG) { p.push(d.slice(i, i + w)); i += w }
  return p.join('.')
}

/** "3319011000000000000" → "3.1.90.11.00.00" (natureza da despesa no ELEMENTO). */
export function naturezaDespesaElemento(cod19: string): string {
  const d = cod19.slice(1)
  return `${d[0]}.${d[1]}.${d.slice(2, 4)}.${d.slice(4, 6)}.00.00`
}

/** Natureza da despesa a partir do código no nível MODALIDADE + nº do elemento
 * (layout "balanço por elemento", em que o elemento vem numa coluna à parte).
 * Ex.: código "3319000…" + elemento "11" → "3.1.90.11.00.00". */
export function naturezaDespesaModElem(codModalidade19: string, elementoNum: string): string {
  const d = codModalidade19.slice(1)
  const ele = String(parseInt(elementoNum, 10) || 0).padStart(2, '0')
  return `${d[0]}.${d[1]}.${d.slice(2, 4)}.${ele}.00.00`
}

/** Funcional "0004.0122.0057" → função(2)/subfunção(3)/programa(4). */
export function decodeFuncional(f: string): { funcao: string; subfuncao: string; programa: string } {
  const [a, b, c] = f.split('.')
  return {
    funcao: String(parseInt(a || '0', 10)).padStart(2, '0'),
    subfuncao: String(parseInt(b || '0', 10)).padStart(3, '0'),
    programa: (c || '').padStart(4, '0'),
  }
}
