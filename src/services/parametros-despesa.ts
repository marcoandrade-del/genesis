/**
 * Núcleo PURO do de/para da DESPESA (cut 1 = custeio). Dada a lista de
 * `ParametroDespesa` de um modelo, resolve qual aplica a uma natureza pelo
 * PREFIXO mais longo: configura-se num nível (ex.: "3.1.90") e as folhas abaixo
 * herdam; casa em fronteira de segmento ("3.1.9" NÃO casa "3.1.90"). Espelha o
 * `parametroPara` do MotorEventosReceita. Sem banco — 100% testável.
 */

import type { CategoriaDespesa } from '@prisma/client'

export type ParametroDespesaLido = {
  naturezaCodigo: string
  contaVpdCodigo: string
  contaPassivoCodigo: string
  categoria?: CategoriaDespesa | null
}

/** Classe do PCASP (1º dígito) que a conta a DEBITAR deve ter, por categoria. */
const CLASSE_DEBITO_POR_CATEGORIA: Record<CategoriaDespesa, string> = {
  CUSTEIO: '3', // VPD
  PESSOAL: '3', // VPD
  JUROS: '3', // VPD financeira (3.4)
  CAPITAL: '1', // Ativo (imobilizado)
  AMORTIZACAO: '2', // Dívida (passivo permanente)
}

/**
 * Valida a coerência de um de/para: a classe da conta a DEBITAR na liquidação
 * tem de bater com a categoria (custeio/pessoal/juros→VPD 3, capital→ativo 1,
 * amortização→dívida 2). Retorna a mensagem do erro, ou `null` se ok (ou sem
 * categoria). Pega mapeamento trocado no seed antes de gravar.
 */
export function validarCategoriaDebito(categoria: CategoriaDespesa | null | undefined, contaDebitoCodigo: string): string | null {
  if (!categoria) return null
  const esperada = CLASSE_DEBITO_POR_CATEGORIA[categoria]
  const classe = contaDebitoCodigo.trim().charAt(0)
  if (classe !== esperada) {
    return `Categoria ${categoria} espera conta débito da classe ${esperada}, mas "${contaDebitoCodigo}" é da classe ${classe || '(vazia)'}.`
  }
  return null
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
