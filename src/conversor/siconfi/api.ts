/**
 * Cliente da API da MSC do SICONFI (datalake do Tesouro, dados abertos) — a mesma
 * usada na abertura patrimonial ([[msc-siconfi-fonte-oficial]]). Público, sem auth,
 * JSON paginado no ORDS. Compartilhado pela FonteExecucao (despesa, classe 6) e
 * pelo conector-fabricante SICONFI (receita, classes 5-6).
 *
 * ⚠️ TODOS os filtros são obrigatórios (inclusive `id_tv`); faltando um, a API
 * responde 200 com count 0 (sem erro). O param é `id_tv`, NÃO `id_tc`.
 */
const BASE = 'https://apidatalake.tesouro.gov.br/ords/siconfi/tt/msc_orcamentaria'

/** Nível de agregação da natureza da despesa. */
export type NivelDespesa = 'elemento' | 'modalidade'

/**
 * natureza da despesa da MSC (8 díg, até subelemento) → PCASP pontuada.
 * `elemento` = "3.3.90.30.00.00" (subitem zerado, como os fabricantes); `modalidade`
 * = "3.3.90.00.00.00" (elemento zerado — nível em que a LOA fixa a dotação). O
 * modalidade casa o autorizado (fixação, sempre em modalidade na MSC) com o empenho.
 */
export function naturezaDespesaMsc(nd: string | null, nivel: NivelDespesa = 'elemento'): string {
  const d = String(nd ?? '').padStart(8, '0')
  const elem = nivel === 'modalidade' ? '00' : d.slice(4, 6)
  return `${d[0]}.${d[1]}.${d.slice(2, 4)}.${elem}.00.00`
}

/** Linha crua da MSC orçamentária (campos comuns às classes 5 e 6). */
export type LinhaMsc = {
  conta_contabil: string
  poder_orgao: string
  fonte_recursos: string
  funcao: string | null
  subfuncao: string | null
  natureza_despesa: string | null
  natureza_receita: string | null
  valor: number
  natureza_conta: 'D' | 'C'
}

/** GET paginado no ORDS (5.000/página) com retry p/ 500 transitório. */
export async function baixarMsc(opts: { ibge: string; ano: number; mes: number; classe: '5' | '6' }): Promise<LinhaMsc[]> {
  const base = {
    an_referencia: String(opts.ano),
    me_referencia: String(opts.mes),
    co_tipo_matriz: 'MSCC',
    id_ente: opts.ibge,
    classe_conta: opts.classe,
    id_tv: 'ending_balance',
  }
  const out: LinhaMsc[] = []
  const limite = 5000
  for (let offset = 0; ; offset += limite) {
    const qs = new URLSearchParams({ ...base, offset: String(offset), limit: String(limite) })
    let j: { items?: LinhaMsc[]; hasMore?: boolean }
    for (let tent = 0; ; tent++) {
      try {
        const res = await fetch(`${BASE}?${qs}`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        j = (await res.json()) as typeof j
        break
      } catch (e) {
        if (tent >= 5) throw new Error(`SICONFI MSC ${opts.ibge} ${opts.ano}/${opts.mes} classe ${opts.classe} falhou: ${(e as Error).message}`)
        await new Promise((r) => setTimeout(r, 1000 * (tent + 1)))
      }
    }
    out.push(...(j.items ?? []))
    if (!j.hasMore) break
  }
  return out
}

/** Descobre o último mês homologado (12→1) de um ente/ano na MSC. */
export async function ultimoMes(ibge: string, ano: number): Promise<number> {
  for (let m = 12; m >= 1; m--) {
    const qs = new URLSearchParams({
      an_referencia: String(ano), me_referencia: String(m), co_tipo_matriz: 'MSCC',
      id_ente: ibge, classe_conta: '6', id_tv: 'ending_balance', offset: '0', limit: '1',
    })
    const res = await fetch(`${BASE}?${qs}`)
    if (res.ok) {
      const j = (await res.json()) as { items?: unknown[] }
      if ((j.items ?? []).length) return m
    }
  }
  throw new Error(`SICONFI: nenhum mês homologado p/ ${ibge} em ${ano}`)
}
