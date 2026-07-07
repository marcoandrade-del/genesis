/**
 * Identificação de operações INTRA-ORÇAMENTÁRIAS (intra-OFSS) a partir da
 * própria classificação contábil — sem campo dedicado no schema.
 *
 * A consolidação das contas de um ente (Município) soma as entidades e ELIMINA
 * as transações entre elas (ex.: contribuição patronal da Prefeitura ao RPPS,
 * duodécimo à Câmara), senão o total conta a mesma operação duas vezes
 * (LRF art. 50 §1º; MCASP — consolidação). O marcador dessas operações está
 * embutido nos códigos:
 *
 *  • DESPESA — modalidade de aplicação 91 "Aplicação Direta Decorrente de
 *    Operação entre Órgãos, Fundos e Entidades Integrantes dos Orçamentos
 *    Fiscal e da Seguridade Social" (Portaria Interministerial STN/SOF 163).
 *    É o 3º grupo da natureza de despesa: C.G.MM.EE.DD.TT → MM === '91'.
 *
 *  • RECEITA — categorias econômicas intra-orçamentárias 7 (Correntes) e 8
 *    (Capital), espelho das despesas 91 (Lei 4.320/64 + MCASP). É o 1º dígito
 *    do código da natureza de receita.
 */

/** Extrai a modalidade de aplicação (3º grupo) de um código de natureza de
 *  despesa no formato "C.G.MM.EE.DD.TT" (ex.: "3.1.90.11.00.00" → "90"). */
export function modalidadeAplicacao(codigoDespesa: string): string | null {
  const seg = codigoDespesa.split('.')
  return seg.length >= 3 ? seg[2] : null
}

/** Verdadeiro se a natureza de despesa é intra-orçamentária (modalidade 91). */
export function ehDespesaIntra(codigoDespesa: string): boolean {
  return modalidadeAplicacao(codigoDespesa) === '91'
}

/** Verdadeiro se a natureza de receita é intra-orçamentária (categoria
 *  econômica 7 = Correntes Intra, 8 = Capital Intra). */
export function ehReceitaIntra(codigoReceita: string): boolean {
  const d = codigoReceita.trim()[0]
  return d === '7' || d === '8'
}
