import type { ConectorFabricante, MunicipioConfig, EntidadeConfig, LinhaReceita, LinhaDespesa } from '../../nucleo/tipos.js'
import { naturezaReceita } from '../../nucleo/pcasp.js'
import { baixarMsc, ultimoMes, naturezaDespesaMsc, type LinhaMsc } from '../../siconfi/api.js'

/**
 * Conector-fabricante SICONFI: lê o ORÇAMENTÁRIO da RECEITA direto da MSC do
 * Tesouro (datalake), por código IBGE — sem raspar ERP. Baseline universal que
 * complementa os conectores por fabricante ([[msc-siconfi-fonte-oficial]]).
 *
 * Receita, na MSC orçamentária (ending_balance, saldo acumulado no mês):
 *   5.2.1.1.1 = previsão INICIAL da receita (por natureza×fonte; natureza C=D somável)
 *   6.2.1.2   = receita REALIZADA (arrecadada) no período (por natureza×fonte)
 * O `valor` vem positivo nas duas subárvores (previsão D, realizada C) → soma direta.
 *
 * LIMITE (por design): é a previsão INICIAL e a realizada agregadas por
 * natureza×fonte. Deduções (5.2.1.1.2) e reestimativas ficam como refinamento; a
 * despesa (dotação) e a execução seguem por `lerDespesa`/FonteExecucao.
 */
const cent = (v: number | string): number => Math.round(Number(v || 0) * 100)

const chave = (natureza: string, fonte: string): string => `${natureza}|${fonte}`

/**
 * Agrega as linhas de previsão (5.2.1.1.1) e realizada (6.2.1.2) da MSC numa
 * `LinhaReceita` por natureza(receita)×fonte. Puro (sem rede) p/ ser testável.
 * `poder` filtra por poder_orgao (ausente = ente consolidado).
 */
export function agregarReceita(prev: LinhaMsc[], real: LinhaMsc[], poder?: string): LinhaReceita[] {
  const agg = new Map<string, LinhaReceita>()
  const acumular = (linhas: LinhaMsc[], campo: 'previsto' | 'arrecadado', prefixo: string) => {
    for (const l of linhas) {
      if (!String(l.conta_contabil).startsWith(prefixo)) continue
      if (poder && l.poder_orgao !== poder) continue
      const natureza = naturezaReceita(String(l.natureza_receita ?? ''))
      const fonteCod = l.fonte_recursos
      const k = chave(natureza, fonteCod)
      const linha =
        agg.get(k) ??
        (agg.set(k, { naturezaPcasp: natureza, fonte: { codigo: fonteCod, descricao: `Fonte ${fonteCod}` } }), agg.get(k)!)
      linha[campo] = (linha[campo] ?? 0) + cent(l.valor)
    }
  }
  acumular(prev, 'previsto', '52111') // 5.2.1.1.1 — previsão inicial
  acumular(real, 'arrecadado', '6212') // 6.2.1.2 — receita realizada
  return [...agg.values()]
}

const chaveDespesa = (l: LinhaDespesa): string =>
  `${l.orgao.codigo}|${l.funcao}|${l.subfuncao}|${l.naturezaPcasp}|${l.fonte.codigo}`

/**
 * Agrega a FIXAÇÃO da despesa (classe 5) numa `LinhaDespesa` com o AUTORIZADO
 * (dotação atualizada) por função×subfunção×natureza(modalidade)×fonte×poder.
 *   autorizado = 5.2.2.1.1 (inicial) + 5.2.2.1.2 (créditos) − 5.2.2.1.9 (cancel.)
 * Provado igual a disponível+pré-empenho+empenhado (6.2.2.1.1+.2+.3) ao centavo.
 * A fixação vem em MODALIDADE na MSC — mesmo nível do empenho no standalone, então
 * reconciliam. UO/programa/ação são placeholders (a MSC não os expõe). Puro/testável.
 */
export function agregarDespesa(fixacao: LinhaMsc[], poder?: string): LinhaDespesa[] {
  const agg = new Map<string, LinhaDespesa>()
  for (const l of fixacao) {
    const cc = String(l.conta_contabil)
    const sinal = cc.startsWith('52211') || cc.startsWith('52212') ? 1 : cc.startsWith('52219') ? -1 : 0
    if (!sinal) continue // ignora 5.2.2.1.3 (remanejamento interno, soma-zero no autorizado)
    if (poder && l.poder_orgao !== poder) continue
    const linha: LinhaDespesa = {
      orgao: { codigo: l.poder_orgao, nome: `Poder/Órgão ${l.poder_orgao}` },
      unidade: { codigo: '0', nome: 'Consolidado SICONFI' },
      funcao: l.funcao ?? '',
      subfuncao: l.subfuncao ?? '',
      programa: { codigo: '0000' },
      acao: { codigo: '0000' },
      naturezaPcasp: naturezaDespesaMsc(l.natureza_despesa, 'modalidade'),
      fonte: { codigo: l.fonte_recursos, descricao: `Fonte ${l.fonte_recursos}` },
      autorizado: 0,
    }
    const k = chaveDespesa(linha)
    const g = agg.get(k) ?? (agg.set(k, linha), linha)
    g.autorizado = (g.autorizado ?? 0) + sinal * cent(l.valor)
  }
  return [...agg.values()]
}

export const siconfiConector: ConectorFabricante = {
  nome: 'SICONFI/MSC',
  async lerReceita(cfg: MunicipioConfig, ent: EntidadeConfig): Promise<LinhaReceita[]> {
    const mes = ent.params?.mesSiconfi ? Number(ent.params.mesSiconfi) : await ultimoMes(cfg.ibge, cfg.ano)
    const [c5, c6] = await Promise.all([
      baixarMsc({ ibge: cfg.ibge, ano: cfg.ano, mes, classe: '5' }),
      baixarMsc({ ibge: cfg.ibge, ano: cfg.ano, mes, classe: '6' }),
    ])
    return agregarReceita(c5, c6, ent.matchSiconfi)
  },
  async lerDespesa(cfg: MunicipioConfig, ent: EntidadeConfig): Promise<LinhaDespesa[]> {
    const mes = ent.params?.mesSiconfi ? Number(ent.params.mesSiconfi) : await ultimoMes(cfg.ibge, cfg.ano)
    const c5 = await baixarMsc({ ibge: cfg.ibge, ano: cfg.ano, mes, classe: '5' })
    return agregarDespesa(c5, ent.matchSiconfi)
  },
}
