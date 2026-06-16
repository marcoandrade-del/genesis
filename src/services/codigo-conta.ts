/**
 * Próximo código de um desdobramento dentro da MÁSCARA FIXA do plano (PCASP).
 *
 * Os códigos têm largura fixa de segmentos, com os níveis ainda não usados
 * preenchidos com zero (ex.: `1.1.1.1.1.01.00.00.00.00.00.00`). Desdobrar NÃO
 * anexa um segmento novo — preenche o PRIMEIRO segmento zerado, mantendo a
 * largura (zero-pad) e os demais segmentos zerados.
 *
 * Ex.: pai `1.1.1.1.1.01.00.00.00.00.00.00` (CAIXA), sem filhos
 *   → `1.1.1.1.1.01.01.00.00.00.00.00`  (preenche o 7º segmento, não o último).
 *
 * O sequencial vem do maior valor já usado pelos filhos NAQUELE segmento + 1,
 * o que evita colisão após exclusões. Se a máscara já está cheia (nenhum
 * segmento zerado), faz fallback anexando `.NN`.
 */
export function proximoCodigoDesdobramento(codigoPai: string, codigosFilhos: string[]): string {
  const segs = codigoPai.split('.')
  const i = segs.findIndex((s) => /^0+$/.test(s))

  if (i === -1) {
    const seq = String(codigosFilhos.length + 1).padStart(2, '0')
    return `${codigoPai}.${seq}`
  }

  let max = 0
  for (const filho of codigosFilhos) {
    const valor = Number.parseInt(filho.split('.')[i] ?? '', 10)
    if (Number.isFinite(valor) && valor > max) max = valor
  }

  const novo = [...segs]
  novo[i] = String(max + 1).padStart(segs[i]!.length, '0')
  return novo.join('.')
}
