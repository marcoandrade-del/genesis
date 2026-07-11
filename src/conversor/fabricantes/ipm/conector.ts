import type { ConectorFabricante, MunicipioConfig, EntidadeConfig, LinhaReceita, LinhaDespesa } from '../../nucleo/tipos.js'
import { significativo } from '../../nucleo/pcasp.js'
import { parseReceitaEscada, parseDespesaQdd, parseArrecadacaoBalanco } from './layouts.js'

/**
 * Conector do FABRICANTE IPM (atende.net). Lê os CSV/XLS exportados do portal
 * (o portal é captcha-walled p/ HTTP puro) e devolve linhas normalizadas em PCASP.
 *
 * Caminhos e chaves de casamento vêm de `ent.params`:
 *   matchArquivo    → substring da coluna Entidade nos arquivos multi-entidade
 *   receitaCsv      → "Orçamento da Receita" (escada)
 *   arrecadacaoXlsx → "Balanço Orçamentário da Receita" (.xls convertido p/ .xlsx)
 *   despesaQdd      → "Orçamento da Despesa" (QDD, com Vínculo)
 */
export const conectorIpm: ConectorFabricante = {
  nome: 'IPM (atende.net)',

  async lerReceita(_cfg: MunicipioConfig, ent: EntidadeConfig): Promise<LinhaReceita[]> {
    const p = ent.params ?? {}
    if (!p.receitaCsv) return []
    const match = p.matchArquivo ?? ent.nome
    const previsoes = parseReceitaEscada(p.receitaCsv, match)

    if (p.arrecadacaoXlsx) {
      const arrec = await parseArrecadacaoBalanco(p.arrecadacaoXlsx, match)
      // agrega o arrecadado (conta analítica) à previsão que o contém (maior prefixo).
      const alvos = previsoes.map((pr) => ({ pr, sig: significativo(pr.naturezaPcasp) })).sort((a, b) => b.sig.length - a.sig.length)
      for (const a of arrec) {
        const s = significativo(a.naturezaPcasp)
        const alvo = alvos.find((x) => s === x.sig || s.startsWith(x.sig + '.'))
        if (alvo) alvo.pr.arrecadado = (alvo.pr.arrecadado ?? 0) + a.arrecadado
      }
    }
    return previsoes
  },

  async lerDespesa(_cfg: MunicipioConfig, ent: EntidadeConfig): Promise<LinhaDespesa[]> {
    const p = ent.params ?? {}
    if (!p.despesaQdd) return []
    return parseDespesaQdd(p.despesaQdd)
  },
}
