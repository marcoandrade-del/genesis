import type { ConectorFabricante, MunicipioConfig, EntidadeConfig, LinhaReceita, LinhaDespesa } from '../../nucleo/tipos.js'
import { naturezaReceita } from '../../nucleo/pcasp.js'
import { baixarMsc, ultimoMes, type LinhaMsc } from '../../siconfi/api.js'

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
  // A dotação/fixação da despesa (5.2.2.x) entra na fiação do caminho standalone;
  // hoje a despesa vem da FonteExecucao SICONFI (empenho) na reconciliação.
  async lerDespesa(): Promise<LinhaDespesa[]> {
    return []
  },
}
