import type { FonteExecucao, MunicipioConfig, EntidadeConfig, LinhaDespesa } from '../nucleo/tipos.js'

/**
 * Fonte de EXECUÇÃO NACIONAL: MSC do SICONFI (datalake do Tesouro, dados abertos).
 * Diferente do PIT (por TCE estadual), o SICONFI cobre QUALQUER município do Brasil
 * pelo código IBGE — a mesma API que já usamos para a abertura patrimonial
 * ([[msc-siconfi-fonte-oficial]]). Serve de baseline confiável e de gabarito p/ os
 * conectores de fabricante.
 *
 * A MSC orçamentária (classe 6) traz o controle do crédito empenhado
 * (6.2.2.1.3.0X) por função×subfunção×natureza×fonte×poder_orgao — mas NÃO tem
 * unidade orçamentária, programa nem ação (o SICONFI não recebe essas dimensões).
 * Por isso a `LinhaDespesa` sai com UO/programa/ação sintéticos (placeholder) — é
 * execução agregada, não o QDD dimensional (esse segue vindo do fabricante).
 *
 * Decomposição do empenho (ending_balance, saldo acumulado no mês de referência):
 *   6.2.2.1.3     = empenhado (a liquidar .01 + em liquidação .02 + liq. a pagar .03 + pago .04)
 *   6.2.2.1.3.03+.04 = liquidado (liquidado a pagar + pago)
 *   6.2.2.1.3.04     = pago
 * O `valor` do saldo vem positivo na subárvore do empenho (natureza C), então soma direta.
 */
const BASE = 'https://apidatalake.tesouro.gov.br/ords/siconfi/tt/msc_orcamentaria'
const cent = (v: number | string): number => Math.round(Number(v || 0) * 100)

/** natureza da despesa MSC (8 díg, até subelemento) → PCASP no nível ELEMENTO. */
const naturezaElemento = (nd: string): string => {
  const d = String(nd || '').padStart(8, '0')
  return `${d[0]}.${d[1]}.${d.slice(2, 4)}.${d.slice(4, 6)}.00.00`
}

export type LinhaMsc = {
  conta_contabil: string
  poder_orgao: string
  fonte_recursos: string
  funcao: string
  subfuncao: string
  natureza_despesa: string
  valor: number
}

const chave = (l: LinhaDespesa): string =>
  `${l.orgao.codigo}|${l.funcao}|${l.subfuncao}|${l.naturezaPcasp}|${l.fonte.codigo}`

/**
 * Agrega as linhas cruas da MSC classe 6 em `LinhaDespesa` por
 * poder_orgao×função×subfunção×natureza(elemento)×fonte, decompondo a subárvore
 * do crédito empenhado (6.2.2.1.3.0X) em empenhado/liquidado/pago. Puro (sem
 * rede) p/ ser testável. `poder` filtra por poder_orgao (ausente = consolidado).
 */
export function agregarExecucao(linhas: LinhaMsc[], poder?: string): LinhaDespesa[] {
  const agg = new Map<string, LinhaDespesa>()
  for (const l of linhas) {
    const cc = String(l.conta_contabil)
    if (!cc.startsWith('62213')) continue // só a subárvore do crédito empenhado
    if (poder && l.poder_orgao !== poder) continue
    const linha: LinhaDespesa = {
      orgao: { codigo: l.poder_orgao, nome: `Poder/Órgão ${l.poder_orgao}` },
      unidade: { codigo: '0', nome: 'Consolidado SICONFI' }, // MSC não expõe UO
      funcao: l.funcao,
      subfuncao: l.subfuncao,
      programa: { codigo: '0000' }, // MSC não expõe programa
      acao: { codigo: '0000' }, //     nem ação
      naturezaPcasp: naturezaElemento(l.natureza_despesa),
      fonte: { codigo: l.fonte_recursos, descricao: `Fonte ${l.fonte_recursos}` },
      empenhado: 0,
      liquidado: 0,
      pago: 0,
    }
    const k = chave(linha)
    const g = agg.get(k) ?? (agg.set(k, linha), linha)
    const v = cent(l.valor)
    g.empenhado = (g.empenhado ?? 0) + v
    if (cc.startsWith('6221303') || cc.startsWith('6221304')) g.liquidado = (g.liquidado ?? 0) + v
    if (cc.startsWith('6221304')) g.pago = (g.pago ?? 0) + v
  }
  return [...agg.values()]
}

/** GET paginado no ORDS (5.000/página) com retry p/ 500 transitório. */
async function baixarClasse6(ibge: string, ano: number, mes: number): Promise<LinhaMsc[]> {
  const base = {
    an_referencia: String(ano),
    me_referencia: String(mes),
    co_tipo_matriz: 'MSCC',
    id_ente: ibge,
    classe_conta: '6',
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
        if (tent >= 5) throw new Error(`SICONFI MSC ${ibge} ${ano}/${mes} falhou: ${(e as Error).message}`)
        await new Promise((r) => setTimeout(r, 1000 * (tent + 1)))
      }
    }
    out.push(...(j.items ?? []))
    if (!j.hasMore) break
  }
  return out
}

/** Descobre o último mês homologado (12→1) quando não há mês configurado. */
async function ultimoMes(ibge: string, ano: number): Promise<number> {
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

export const siconfiExecucao: FonteExecucao = {
  nome: 'SICONFI/MSC',
  async lerExecucao(cfg: MunicipioConfig, ent: EntidadeConfig): Promise<LinhaDespesa[]> {
    const mes = ent.params?.mesSiconfi ? Number(ent.params.mesSiconfi) : await ultimoMes(cfg.ibge, cfg.ano)
    const linhas = await baixarClasse6(cfg.ibge, cfg.ano, mes)
    return agregarExecucao(linhas, ent.matchSiconfi)
  },
}
