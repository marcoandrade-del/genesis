/**
 * Normalização dos códigos do BETHA (Transparência Cloud / dados abertos) → PCASP.
 *
 * O dados-abertos do Betha (INDA) publica a natureza da receita/despesa no padrão
 * nacional PCASP. Ao contrário do IPM (código cru de 19 dígitos com marcador) e do
 * Elotech (dígitos crus na ordem PCASP), o Betha costuma entregar a natureza JÁ
 * PONTUADA — mas o dado-aberto de cada município pode vir pontuado OU só com os
 * dígitos. Estes helpers toleram os dois: se vier pontuado, completam os grupos
 * com zeros; se vier cru, fatiam pelas larguras do padrão. Como a natureza é o
 * padrão NACIONAL, esta normalização é correta independentemente do formato exato
 * que o município publica — o que muda por município é o NOME DA COLUNA (resolvido
 * em conector.ts), não a estrutura do código.
 */

/** Larguras dos 12 grupos da natureza da receita PCASP (soma 18 dígitos). */
const GRUPOS_RECEITA = [1, 1, 1, 1, 2, 1, 1, 2, 2, 2, 2, 2] as const

const soDigitos = (s: string): string => (s || '').replace(/\D/g, '')

/** Completa uma natureza de receita pontuada até os 12 grupos com zeros. */
function pad12(pontuada: string): string {
  const p = pontuada.replace(/\.+$/, '').split('.')
  for (let i = p.length; i < GRUPOS_RECEITA.length; i++) p.push('0'.repeat(GRUPOS_RECEITA[i]!))
  return p.join('.')
}

/**
 * Natureza da receita (pontuada OU dígitos crus) → PCASP pontuada de 12 grupos.
 * Ex.: "17180111" → "1.7.1.8.01.1.1.00.00.00.00.00"; "1.7.1.8" → idem completado.
 */
export function naturezaReceita(raw: string): string {
  const s = (raw || '').trim()
  if (s.includes('.')) return pad12(s)
  const d = soDigitos(s)
  const partes: string[] = []
  let i = 0
  for (const g of GRUPOS_RECEITA) {
    if (i >= d.length) break
    partes.push(d.slice(i, i + g))
    i += g
  }
  return pad12(partes.join('.'))
}

/**
 * Natureza da despesa no nível ELEMENTO (pontuada OU crua) → "3.1.90.11.00.00".
 * Trunca no elemento (subitem zerado) como os demais fabricantes fazem, para
 * casar o parâmetro da despesa por prefixo. Ex.: "3.3.90.30.01" → "3.3.90.30.00.00".
 */
export function naturezaDespesaElemento(raw: string): string {
  const d = soDigitos(raw)
  const cat = d[0] ?? '0'
  const grupo = d[1] ?? '0'
  const modalidade = (d.slice(2, 4) || '').padEnd(2, '0')
  const elemento = (d.slice(4, 6) || '').padEnd(2, '0')
  return `${cat}.${grupo}.${modalidade}.${elemento}.00.00`
}

/** Função da despesa (2 dígitos), ex. "4" → "04". */
export const funcao2 = (f: string): string => String(parseInt(soDigitos(f) || '0', 10)).padStart(2, '0')
/** Subfunção da despesa (3 dígitos), ex. "122" → "122". */
export const subfuncao3 = (s: string): string => String(parseInt(soDigitos(s) || '0', 10)).padStart(3, '0')
/** Programa da despesa (4 dígitos), ex. "2" → "0002". */
export const programa4 = (p: string): string => (soDigitos(p) || '').padStart(4, '0')
