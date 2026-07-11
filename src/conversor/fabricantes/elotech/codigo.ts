/**
 * Decodificação dos códigos do portal ELOTECH (OXY) para o padrão PCASP.
 *
 * Diferente do IPM (que vem codificado e precisa de fatiamento), o Elotech já
 * entrega os dígitos na ordem PCASP — basta AGRUPAR (receita) ou parsear a
 * programática pontuada (despesa).
 */

// Receita: 12 grupos de dígitos → "1.1.1.2.50.0.1.00.00.00.00.00".
const GRUPOS = [1, 1, 1, 1, 2, 1, 1, 2, 2, 2, 2, 2]

/** "11125001" (dígitos crus da árvore de receita) → "1.1.1.2.50.0.1". */
export function agruparDigitos(raw: string): string {
  const partes: string[] = []
  let i = 0
  for (const g of GRUPOS) {
    if (i >= raw.length) break
    partes.push(raw.slice(i, i + g))
    i += g
  }
  return partes.join('.')
}

/** Completa um código de receita pontuado até os 12 grupos com zeros. */
export function pad12(codigo: string): string {
  const partes = codigo.replace(/\.+$/, '').split('.')
  for (let i = partes.length; i < 12; i++) partes.push('0'.repeat(GRUPOS[i]!))
  return partes.join('.')
}

/** Natureza da receita do portal (dígitos crus) → PCASP pontuada de 12 grupos. */
export function naturezaReceita(raw: string): string {
  return pad12(agruparDigitos(raw))
}

/**
 * Programática da despesa (nível 11, 10 posições pontuadas), ex.
 * "02.010.04.122.0002.2001.3.1.90.07" → dimensões + natureza no elemento.
 * Devolve null se não tiver 10 posições.
 */
export function parseProgramatica(prog: string): {
  orgao: string
  unidade: string
  funcao: string
  subfuncao: string
  programa: string
  acao: string
  naturezaPcasp: string
} | null {
  const p = prog.split('.')
  if (p.length !== 10) return null
  return {
    orgao: p[0]!,
    unidade: p[1]!,
    funcao: p[2]!,
    subfuncao: p[3]!,
    programa: p[4]!,
    acao: p[5]!,
    // natureza no ELEMENTO (6 dígitos pontuados) → "3.1.90.07.00.00"
    naturezaPcasp: `${p[6]}.${p[7]}.${p[8]}.${p[9]}.00.00`,
  }
}
