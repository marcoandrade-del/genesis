import type { LinhaDespesa } from './tipos.js'
import { casarFontesPorDescricao } from './de-para-fonte.js'

const chave = (l: LinhaDespesa): string =>
  `${l.orgao.codigo}.${l.unidade.codigo}|${l.funcao}|${l.subfuncao}|${l.programa.codigo}|${l.acao.codigo}|${l.naturezaPcasp}|${l.fonte.codigo}`

function fontesDistintas(linhas: LinhaDespesa[]): { codigo: string; descricao: string }[] {
  const m = new Map<string, string>()
  for (const l of linhas) if (!m.has(l.fonte.codigo)) m.set(l.fonte.codigo, l.fonte.descricao)
  return [...m].map(([codigo, descricao]) => ({ codigo, descricao }))
}

/**
 * Reconcilia a dotação inicial (LOA, do fabricante) com a execução (empenho, do
 * TCE) numa MESMA linha de dotação. O nó: fabricante e TCE usam códigos de fonte
 * DIFERENTES p/ a mesma fonte → o de/para é por DESCRIÇÃO. A execução é re-chaveada
 * p/ a fonte da LOA e agregada; onde não há LOA correspondente, vira dotação de
 * "execução sem LOA" (mantém a fonte do TCE).
 *
 * Pré-condição: a natureza de ambos os lados já está no MESMO nível (elemento).
 */
export function reconciliarDespesa(loa: LinhaDespesa[], exec: LinhaDespesa[]): LinhaDespesa[] {
  const deParaFonte = casarFontesPorDescricao(fontesDistintas(exec), fontesDistintas(loa))
  const fonteLoaPorCod = new Map(fontesDistintas(loa).map((f) => [f.codigo, f.descricao]))

  const merged = new Map<string, LinhaDespesa>()
  for (const l of loa) merged.set(chave(l), { ...l })

  for (const e of exec) {
    const codLoa = deParaFonte.get(e.fonte.codigo)
    const fonte = codLoa ? { codigo: codLoa, descricao: fonteLoaPorCod.get(codLoa) ?? e.fonte.descricao } : e.fonte
    const reKeyed: LinhaDespesa = { ...e, fonte }
    const k = chave(reKeyed)
    const g = merged.get(k)
    if (g) {
      g.empenhado = (g.empenhado ?? 0) + (e.empenhado ?? 0)
      g.liquidado = (g.liquidado ?? 0) + (e.liquidado ?? 0)
      g.pago = (g.pago ?? 0) + (e.pago ?? 0)
    } else {
      merged.set(k, reKeyed)
    }
  }
  return [...merged.values()]
}
