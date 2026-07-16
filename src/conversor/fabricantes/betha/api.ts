/**
 * Cliente da API do Portal da Transparência BETHA (transparencia.betha.cloud).
 *
 * MECANISMO REAL (decifrado no cliente Criciúma/SC — ver memória
 * `betha-transparencia-api-decifrada`). NÃO é o "dados-abertos" anônimo (o
 * `formato=json` dá 500); é a MESMA API do grid do SPA, que precisa de:
 *   1. TOKEN anônimo via OAuth implicit (`access_mode=anonymous`, SEM captcha).
 *   2. CONTEXTO do portal no header `app-context: base64({"portal": <hash>})`,
 *      onde <hash> é o identificador do município na URL do portal.
 *   3. DADOS em `POST /api/busca-textual/{consultaId}` (backend ElasticSearch):
 *      resposta `{ totalHits, hits:[{ id, sourceAsMap:{…} }] }`; filtro por
 *      facetas no corpo (`{"ano":["2026"]}`); `offset` máx. 10.000 (janela do
 *      ES) — por isso filtra-se server-side; e **500 transitório** frequente,
 *      que exige retry.
 *
 * Os NOMES DAS COLUNAS (chaves de `sourceAsMap`) variam por consulta/município;
 * o conector resolve por nome (fail-loud). A estrutura (natureza PCASP, etc.) é
 * nacional.
 */

const OAUTH = 'https://plataforma-oauth.betha.cloud/auth/oauth2'
const API = 'https://api.transparencia.betha.cloud/transparencia'
const CLIENT_ID = '91a97459-f1d8-4b29-b5fa-2e51d1692623'
const SCOPE = 'transparencia.public'
const REDIRECT = 'https://transparencia.betha.cloud/auth-callback.html'

/** Uma linha da consulta: o `id` (codifica database:entidade:tipo_ANO_MES_…) + as colunas. */
export type LinhaBetha = { id: string; campos: Record<string, unknown> }

let tokenCache: { token: string; exp: number } | null = null

/** Token ANÔNIMO (implicit flow, sem captcha). Cache por processo (~1 h). */
export async function tokenAnonimo(): Promise<string> {
  const agora = Date.now()
  if (tokenCache && agora < tokenCache.exp) return tokenCache.token
  const url =
    `${OAUTH}/authorize?response_type=token&client_id=${CLIENT_ID}` +
    `&scope=${SCOPE}&redirect_uri=${encodeURIComponent(REDIRECT)}&access_mode=anonymous`
  const res = await fetch(url, { redirect: 'manual' })
  const loc = res.headers.get('location')
  const token = loc ? new URLSearchParams(loc.replace(/^[^#]*#/, '')).get('access_token') : null
  if (!token) throw new Error('Betha OAuth anônimo: access_token ausente no redirect (fluxo mudou?).')
  tokenCache = { token, exp: agora + 50 * 60 * 1000 }
  return token
}

/** Header `app-context` a partir do hash do portal (o que vem na URL do município). */
export function appContext(portalHash: string): string {
  return Buffer.from(JSON.stringify({ portal: portalHash })).toString('base64')
}

/**
 * Lê TODAS as linhas de uma consulta (busca-textual), filtrando por facetas
 * (ex. `{ano:['2026']}`). Pagina por offset (janela ES de 10 k) e faz retry no
 * 500 transitório do ES. Falha alto se a consulta (já filtrada) passar da janela
 * — sinal de que falta filtro (ex. ano).
 */
export async function lerConsulta(opts: {
  consultaId: string
  portalHash: string
  filtros?: Record<string, string[]>
  token?: string
}): Promise<LinhaBetha[]> {
  const token = opts.token ?? (await tokenAnonimo())
  const headers = {
    Authorization: `Bearer ${token}`,
    'app-context': appContext(opts.portalHash),
    'Content-Type': 'application/json',
  }
  const body = JSON.stringify(opts.filtros ?? {})

  async function pagina(offset: number, limit: number): Promise<{ totalHits: number; hits: { id: string; sourceAsMap: Record<string, unknown> }[] }> {
    const url =
      `${API}/api/busca-textual/${encodeURIComponent(opts.consultaId)}` +
      `?sortBy=null&sortDirection=null&offset=${offset}&limit=${limit}&hiperlink=false`
    let ultimo = ''
    for (let tentativa = 1; tentativa <= 6; tentativa++) {
      try {
        const res = await fetch(url, { method: 'POST', headers, body })
        if (res.ok) return (await res.json()) as { totalHits: number; hits: { id: string; sourceAsMap: Record<string, unknown> }[] }
        ultimo = `HTTP ${res.status}`
      } catch (e) {
        ultimo = e instanceof Error ? e.message : String(e)
      }
      await new Promise((r) => setTimeout(r, 1500 * tentativa)) // ES: 500 transitório
    }
    throw new Error(`Betha busca-textual ${opts.consultaId} falhou após 6 tentativas: ${ultimo}.`)
  }

  const LIMITE = 5000
  const JANELA_ES = 10000
  const primeira = await pagina(0, LIMITE)
  const total = primeira.totalHits
  if (total > JANELA_ES)
    throw new Error(
      `Consulta ${opts.consultaId} devolveu ${total} linhas (> janela ES de ${JANELA_ES}). ` +
        `Filtre mais (ex. por ano) — os filtros vão em 'filtros'.`,
    )
  const linhas: LinhaBetha[] = primeira.hits.map((h) => ({ id: h.id, campos: h.sourceAsMap }))
  for (let off = LIMITE; off < total; off += LIMITE) {
    const p = await pagina(off, LIMITE)
    for (const h of p.hits) linhas.push({ id: h.id, campos: h.sourceAsMap })
  }
  return linhas
}

/** Código da entidade embutido no `id` do hit (`database:ENTIDADE:tipo_…`). */
export function entidadeDoId(id: string): string {
  return id.split(':')[1] ?? ''
}

/** Mês (2 dígitos) embutido no `id` da receita (`…:receita_orcamentaria_ANO_MES_…`). */
export function mesDoId(id: string): string {
  return id.match(/_(\d{4})_(\d{2})_/)?.[2] ?? ''
}
