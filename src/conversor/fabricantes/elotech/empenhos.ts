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

/** A janela de coleta fechou (fora do horário permitido) — sair limpo e retomar depois. */
export class JanelaFechada extends Error {}
/** O servidor seguiu falhando após todos os cooldowns — abortar limpo (cache preservado). */
export class RitmoEsgotado extends Error {}

/**
 * Perfil de coleta "gentil" p/ portais LEGADOS em produção (eloweb/Delphi): o
 * sistema atende a prefeitura em horário comercial e não tolera carga. Um
 * `Ritmo` é chamado em volta de CADA request e impõe:
 *  - pacing serial com jitter (nunca rajada);
 *  - adaptação: latência acima do limiar → dobra a pausa (decai de volta ao normalizar);
 *  - circuit breaker: erro/timeout → cooldown longo exponencial; esgotou → `RitmoEsgotado`;
 *  - janela horária: fora dela → `JanelaFechada` (o chamador salva estado e sai).
 */
export type Ritmo = {
  antes(): Promise<void>
  depois(latenciaMs: number): void
  falha(rotulo: string, erro: string): Promise<void>
  estado(): { pausaMs: number; cooldowns: number }
}

export function criarRitmo(opts: {
  pausaMs?: number
  pausaMaxMs?: number
  limiarLatenciaMs?: number
  cooldownMs?: number
  cooldownMaxMs?: number
  maxCooldowns?: number
  dentroDaJanela?: () => boolean
  dormir?: (ms: number) => Promise<void>
  aleatorio?: () => number
} = {}): Ritmo {
  const base = opts.pausaMs ?? 1200
  const teto = opts.pausaMaxMs ?? 10_000
  const limiar = opts.limiarLatenciaMs ?? 4_000
  const cooldownBase = opts.cooldownMs ?? 300_000
  const cooldownTeto = opts.cooldownMaxMs ?? 1_800_000
  const maxCooldowns = opts.maxCooldowns ?? 4
  const dormir = opts.dormir ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const aleatorio = opts.aleatorio ?? Math.random
  let pausa = base
  let cooldowns = 0
  const exigirJanela = () => {
    if (opts.dentroDaJanela && !opts.dentroDaJanela()) throw new JanelaFechada('janela de coleta encerrada')
  }
  return {
    async antes() {
      exigirJanela()
      await dormir(Math.round(pausa * (0.7 + 0.6 * aleatorio()))) // jitter ±30%
    },
    depois(latenciaMs) {
      if (latenciaMs > limiar) pausa = Math.min(pausa * 2, teto)
      else pausa = Math.max(base, Math.round(pausa * 0.8)) // decai de volta ao base
    },
    async falha(rotulo, erro) {
      cooldowns++
      if (cooldowns > maxCooldowns) throw new RitmoEsgotado(`${rotulo}: servidor seguiu falhando após ${maxCooldowns} cooldowns (${erro})`)
      const espera = Math.min(cooldownBase * 2 ** (cooldowns - 1), cooldownTeto)
      await dormir(espera)
      exigirJanela() // um cooldown longo pode ter atravessado o fim da janela
    },
    estado: () => ({ pausaMs: pausa, cooldowns }),
  }
}

/** Janela padrão do modo gentil: 22h–06h em qualquer dia OU fim de semana o dia todo (hora local). */
export function dentroDaJanelaGentil(d: Date): boolean {
  const dia = d.getDay()
  if (dia === 0 || dia === 6) return true
  const h = d.getHours()
  return h >= 22 || h < 6
}

async function getJson<T>(url: string, rotulo: string, ritmo?: Ritmo): Promise<T> {
  for (let tent = 0; ; tent++) {
    if (ritmo) await ritmo.antes()
    const t0 = Date.now()
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const buf = await res.arrayBuffer()
      ritmo?.depois(Date.now() - t0)
      return JSON.parse(new TextDecoder('utf-8', { fatal: false }).decode(buf)) as T
    } catch (e) {
      if (e instanceof JanelaFechada || e instanceof RitmoEsgotado) throw e
      // gentil: cooldown longo dirigido pelo ritmo (que aborta quando esgota);
      // padrão: retry curto limitado (portais modernos aguentam)
      if (ritmo) await ritmo.falha(rotulo, (e as Error).message)
      else if (tent >= 5) throw new Error(`${rotulo}: ${(e as Error).message}`)
      else await new Promise((r) => setTimeout(r, 800 * (tent + 1)))
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

/**
 * Lista por FAIXAS de número de empenho (`id.empenho>=A;id.empenho<=B` no RSQL) —
 * fallback p/ o Elotech LEGADO, cuja paginação por offset degrada até morrer
 * (Sarandi: p24 estoura timeout). Cada faixa é uma query com offset 0.
 */
export async function listarEmpenhosPorFaixa(baseUrl: string, idPortal: string, ano: number, faixa = 500, ritmo?: Ritmo): Promise<EmpenhoLista[]> {
  // maior número de empenho: 1 registro ordenado desc
  const searchEnt = encodeURIComponent(`id.entidade=='${idPortal}'`)
  const topo = await getJson<{ content?: EmpenhoLista[] }>(
    `${baseUrl}/empenhos/lista?search=${searchEnt}&entidade=${idPortal}&exercicio=${ano}&page=0&size=1&sort=id.empenho,desc`,
    `empenhos/lista ${idPortal} topo`,
    ritmo,
  )
  const max = topo.content?.[0]?.empenho ?? 0
  const out: EmpenhoLista[] = []
  for (let ini = 1; ini <= max; ini += faixa) {
    const fim = Math.min(ini + faixa - 1, max)
    const search = encodeURIComponent(`id.entidade=='${idPortal}';id.empenho>='${ini}';id.empenho<='${fim}'`)
    const d = await getJson<{ content?: EmpenhoLista[]; last?: boolean; totalElements?: number }>(
      `${baseUrl}/empenhos/lista?search=${search}&entidade=${idPortal}&exercicio=${ano}&page=0&size=${faixa}`,
      `empenhos/lista ${idPortal} faixa ${ini}-${fim}`,
      ritmo,
    )
    if ((d.totalElements ?? 0) > faixa) throw new Error(`faixa ${ini}-${fim} com mais de ${faixa} empenhos — reduza a faixa`)
    out.push(...(d.content ?? []))
  }
  return out
}

/** Detalhe (programática estruturada) de um empenho. */
export function detalheEmpenho(baseUrl: string, idPortal: string, ano: number, empenho: number, ritmo?: Ritmo): Promise<EmpenhoDetalhe> {
  const search = encodeURIComponent(`id.entidade=='${idPortal}'`)
  return getJson<EmpenhoDetalhe>(
    `${baseUrl}/empenhos/detalhe?search=${search}&entidade=${idPortal}&exercicio=${ano}&empenho=${empenho}`,
    `empenhos/detalhe ${idPortal}/${empenho}`,
    ritmo,
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
