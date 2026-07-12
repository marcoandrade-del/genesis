/**
 * Cliente do dados-abertos do BETHA (Transparência Cloud).
 *
 * MECANISMO CONFIRMADO no bundle de produção da SPA (transparencia.betha.cloud):
 *   GET {base}/api/consulta/{consultaId}?formato=json
 * Este é o motor de dados abertos (INDA) — SEM token/recaptcha (ao contrário da
 * API principal `api.transparencia.betha.cloud`, que exige `Authorization`). Cada
 * "consulta" é um dataset publicado (receita orçamentária, despesa orçamentária,
 * …); o `consultaId` é CONFIGURADO POR MUNICÍPIO (não há endpoint fixo como no
 * Elotech) — por isso viaja em `params` (ver campos.ts / config do município).
 *
 * `base` = valor de `window.transparenciaConfig.urlDadosAbertos` do portal do
 * município (host dados.transparencia.betha.cloud/<...>). Filtros (ex. exercício)
 * vão como query params — os NOMES exatos dos filtros se confirmam na validação.
 */

async function getJson<T>(url: string): Promise<T> {
  for (let tentativa = 1; ; tentativa++) {
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json' } })
      if (!res.ok) throw new Error(`HTTP ${res.status} em ${url}`)
      return (await res.json()) as T
    } catch (e) {
      if (tentativa >= 3) throw e
      await new Promise((r) => setTimeout(r, 1000 * tentativa))
    }
  }
}

/** Registro cru de uma consulta (colunas variam por dataset/município). */
export type LinhaConsulta = Record<string, unknown>

/**
 * Lê um dataset do dados-abertos e devolve as linhas cruas. O motor pode
 * devolver um array direto ou um envelope paginado (`{ conteudo|content|itens|
 * registros: [...] }`) — tratamos ambos e falhamos alto se não achar as linhas.
 */
export async function lerConsulta(
  base: string,
  consultaId: string,
  filtros: Record<string, string> = {},
): Promise<LinhaConsulta[]> {
  const raiz = base.replace(/\/+$/, '')
  const qs = new URLSearchParams({ formato: 'json', ...filtros }).toString()
  const url = `${raiz}/api/consulta/${encodeURIComponent(consultaId)}?${qs}`
  const corpo = await getJson<unknown>(url)

  if (Array.isArray(corpo)) return corpo as LinhaConsulta[]
  if (corpo && typeof corpo === 'object') {
    const env = corpo as Record<string, unknown>
    for (const chave of ['conteudo', 'content', 'itens', 'registros', 'dados', 'data']) {
      if (Array.isArray(env[chave])) return env[chave] as LinhaConsulta[]
    }
  }
  throw new Error(
    `Consulta ${consultaId} do dados-abertos Betha não retornou linhas reconhecíveis ` +
      `(esperado array ou envelope {conteudo|content|itens|...}). Verifique o consultaId e a base.`,
  )
}
