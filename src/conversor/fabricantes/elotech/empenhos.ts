/**
 * Empenhos INDIVIDUAIS do portal Elotech — a única visão do portal com FONTE por
 * empenho (o QDD/`despesapornivel` não publica fonte por dotação).
 *
 * Decifrado do bundle do front (2026-07-23): `/empenhos/lista` exige filtro RSQL
 * `search=id.entidade=='<id>'` + `entidade=` + `exercicio=` na QUERY (os headers
 * usados nos demais endpoints são ignorados aqui). Paginação Spring (page/size).
 * A lista traz fonte+valores; a programática completa vem em `/empenhos/detalhe`
 * (campos estruturados: orgao/unidade/funcao/subFuncao/programa/projeto/elemento).
 *
 * Semântica provada contra `/despesapornivel/fonte-recursos` (gabarito ao centavo):
 *  - empenhado líquido = Σ (valorEmpenhado − valorAnulado)
 *  - `valorPago` do empenho INCLUI o retido; o gabarito separa (pago + retido).
 */

export type EmpenhoLista = {
  id: number
  empenho: number
  exercicio: number
  data: string
  valorEmpenhado: number | null
  valorAnulado: number | null
  valorLiquidado: number | null
  valorRetido: number | null
  valorPago: number | null
  fonteRecurso: string | null // "15000000 - Recursos não Vinculados..."
}

export type EmpenhoDetalhe = {
  empenho: number
  orgao: string | null // "02"
  unidade: string | null // "02002" (órgão+unidade)
  funcao: string | null
  subFuncao: string | null
  programa: string | null
  projeto: string | null // código da ação ("2067")
  elemento: string | null // natureza até subelemento ("3.3.90.30.16.00")
  fonteRecurso: string | null // "15000000"
}

async function getJson<T>(url: string, rotulo: string): Promise<T> {
  for (let tent = 0; ; tent++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const buf = await res.arrayBuffer()
      return JSON.parse(new TextDecoder('utf-8', { fatal: false }).decode(buf)) as T
    } catch (e) {
      if (tent >= 5) throw new Error(`${rotulo}: ${(e as Error).message}`)
      await new Promise((r) => setTimeout(r, 800 * (tent + 1)))
    }
  }
}

/**
 * Lista paginada de empenhos do exercício de uma entidade do portal.
 * `size` pequeno por default: o Elotech LEGADO (eloweb.net) degrada com páginas
 * grandes (67s+ na page 0 com 500; segundos com 100).
 */
export async function listarEmpenhos(baseUrl: string, idPortal: string, ano: number, size = 100): Promise<EmpenhoLista[]> {
  const out: EmpenhoLista[] = []
  const search = encodeURIComponent(`id.entidade=='${idPortal}'`)
  for (let page = 0; ; page++) {
    const d = await getJson<{ content?: EmpenhoLista[]; last?: boolean }>(
      `${baseUrl}/empenhos/lista?search=${search}&entidade=${idPortal}&exercicio=${ano}&page=${page}&size=${size}`,
      `empenhos/lista ${idPortal} p${page}`,
    )
    out.push(...(d.content ?? []))
    if (d.last !== false) break
  }
  return out
}

/** Detalhe (programática estruturada) de um empenho. */
export function detalheEmpenho(baseUrl: string, idPortal: string, ano: number, empenho: number): Promise<EmpenhoDetalhe> {
  const search = encodeURIComponent(`id.entidade=='${idPortal}'`)
  return getJson<EmpenhoDetalhe>(
    `${baseUrl}/empenhos/detalhe?search=${search}&entidade=${idPortal}&exercicio=${ano}&empenho=${empenho}`,
    `empenhos/detalhe ${idPortal}/${empenho}`,
  )
}

/** Executa `fn` sobre os itens com no máximo `limite` em voo. */
export async function comConcorrencia<T, R>(itens: T[], limite: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(itens.length)
  let i = 0
  await Promise.all(
    Array.from({ length: Math.min(limite, itens.length) }, async () => {
      for (;;) {
        const meu = i++
        if (meu >= itens.length) return
        out[meu] = await fn(itens[meu]!)
      }
    }),
  )
  return out
}
