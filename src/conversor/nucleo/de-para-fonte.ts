import { normalizarDescricao } from './pcasp.js'

/**
 * De/para de fonte de recurso entre dois lados (ex.: fabricante × TCE), por
 * DESCRIÇÃO — porque os códigos numéricos DIVERGEM para a mesma fonte
 * (ex. "Atenção Média/Alta" = IPM 01493 × TCE 496). Casa exato pela descrição
 * normalizada; se não achar, cai no melhor overlap de tokens (Jaccard ≥ limiar).
 *
 * Devolve o mapa codigoA → codigoB (só os que casaram).
 */
export function casarFontesPorDescricao(
  ladoA: readonly { codigo: string; descricao: string }[],
  ladoB: readonly { codigo: string; descricao: string }[],
  limiarFuzzy = 0.6,
): Map<string, string> {
  const bIndex = ladoB.map((f) => ({ codigo: f.codigo, norm: normalizarDescricao(f.descricao), toks: new Set(normalizarDescricao(f.descricao).split(' ').filter(Boolean)) }))
  const mapa = new Map<string, string>()
  for (const a of ladoA) {
    if (!a.codigo) continue
    const na = normalizarDescricao(a.descricao)
    let alvo = bIndex.find((b) => b.norm === na)?.codigo
    if (!alvo) {
      const ta = new Set(na.split(' ').filter(Boolean))
      let melhor = 0
      for (const b of bIndex) {
        const inter = [...ta].filter((t) => b.toks.has(t)).length
        const uni = new Set([...ta, ...b.toks]).size
        const s = uni ? inter / uni : 0
        if (s > melhor) { melhor = s; if (s >= limiarFuzzy) alvo = b.codigo }
      }
    }
    if (alvo) mapa.set(a.codigo, alvo)
  }
  return mapa
}
