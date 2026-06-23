/**
 * Núcleo PURO do de/para da DESPESA (cut 1 = custeio). Dada a lista de
 * `ParametroDespesa` de um modelo, resolve qual aplica a uma natureza pelo
 * PREFIXO mais longo: configura-se num nível (ex.: "3.1.90") e as folhas abaixo
 * herdam; casa em fronteira de segmento ("3.1.9" NÃO casa "3.1.90"). Espelha o
 * `parametroPara` do MotorEventosReceita. Sem banco — 100% testável.
 */

export type ParametroDespesaLido = {
  naturezaCodigo: string
  contaVpdCodigo: string
  contaPassivoCodigo: string
}

/** Casa a natureza por igualdade ou prefixo em fronteira de segmento. */
function casaPrefixo(naturezaCodigo: string, prefixo: string): boolean {
  return naturezaCodigo === prefixo || naturezaCodigo.startsWith(prefixo + '.')
}

/**
 * Resolve o parâmetro da despesa para uma natureza (prefixo mais longo vence).
 * Retorna `null` se nenhum casar (o motor trata como "sem patrimonial").
 */
export function resolverParametroDespesa<T extends ParametroDespesaLido>(params: readonly T[], naturezaCodigo: string): T | null {
  let melhor: T | null = null
  for (const p of params) {
    if (casaPrefixo(naturezaCodigo, p.naturezaCodigo) && (!melhor || p.naturezaCodigo.length > melhor.naturezaCodigo.length)) {
      melhor = p
    }
  }
  return melhor
}
