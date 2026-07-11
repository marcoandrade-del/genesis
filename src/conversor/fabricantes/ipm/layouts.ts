import { readFileSync } from 'node:fs'
import ExcelJS from 'exceljs'
import type { LinhaReceita, LinhaDespesa } from '../../nucleo/tipos.js'
import { significativo } from '../../nucleo/pcasp.js'
import { naturezaReceita, naturezaDespesaElemento, decodeFuncional } from './codigo.js'

const cent = (s: string | undefined): number => Math.round(parseFloat((s || '0').trim() || '0') * 100)
const FONTE_RECEITA_PLACEHOLDER = { codigo: '0000', descricao: 'Sem detalhamento de fonte (LOA receita IPM)' }

/** Parser CSV real (aspas, ';', quebras de linha DENTRO de aspas, "" escapado). */
export function lerCsv(caminho: string): string[][] {
  const txt = readFileSync(caminho, 'latin1')
  const rows: string[][] = []
  let f = '', row: string[] = [], q = false
  for (let i = 0; i < txt.length; i++) {
    const c = txt[i]!
    if (q) { if (c === '"') { if (txt[i + 1] === '"') { f += '"'; i++ } else q = false } else f += c }
    else if (c === '"') q = true
    else if (c === ';') { row.push(f); f = '' }
    else if (c === '\n') { row.push(f); rows.push(row); row = []; f = '' }
    else if (c !== '\r') f += c
  }
  if (f.length || row.length) { row.push(f); rows.push(row) }
  return rows
}

/**
 * Layout "Orçamento da Receita" (escada): colunas Entidade;Conta;Descrição;
 * Desdobramento;Fonte;Categoria Econômica — o valor cai numa das 3 últimas
 * conforme o nível. Importa só as FOLHAS. Sem fonte (placeholder). Devolve a
 * receita BRUTA — as deduções ("9…") são puladas (o líquido do FUNDEB, com
 * conta redutora, é um passo à parte para não colidir com a receita positiva).
 */
export function parseReceitaEscada(caminho: string, matchEntidade: string): LinhaReceita[] {
  const rows = lerCsv(caminho).filter((r) => r.length >= 6 && (r[0] || '').toUpperCase().includes(matchEntidade.toUpperCase()) && /^\d/.test(r[1] || ''))
  const sigs = rows.map((r) => significativo(naturezaReceita((r[1] || '').trim())))
  const ehFolha = (i: number) => { const s = sigs[i]!; return !sigs.some((o, j) => j !== i && o.startsWith(s + '.')) }
  const out: LinhaReceita[] = []
  rows.forEach((r, i) => {
    const cod = (r[1] || '').trim()
    if (cod.startsWith('9') || !ehFolha(i)) return // deduções e subtotais fora
    const valor = [cent(r[3]), cent(r[4]), cent(r[5])].find((v) => v !== 0) ?? 0
    out.push({ naturezaPcasp: naturezaReceita(cod), fonte: FONTE_RECEITA_PLACEHOLDER, previsto: valor })
  })
  return out
}

/**
 * Layout "Orçamento da Despesa" (QDD): Órgão/Unidade/Ação/Elemento/Vínculo/
 * Funcional/Total. Uma linha = uma dotação com fonte. Total = valorAutorizado.
 */
export function parseDespesaQdd(caminho: string): LinhaDespesa[] {
  const rows = lerCsv(caminho)
  const agg = new Map<string, LinhaDespesa>()
  for (const f of rows.slice(1)) {
    if (f.length < 16) continue
    const { funcao, subfuncao, programa } = decodeFuncional((f[12] || '').trim())
    const linha: LinhaDespesa = {
      orgao: { codigo: (f[1] || '').trim(), nome: '' },
      unidade: { codigo: (f[3] || '').trim(), nome: (f[4] || '').trim() },
      funcao, subfuncao,
      programa: { codigo: programa },
      acao: { codigo: (f[5] || '').trim(), nome: (f[6] || '').trim() },
      naturezaPcasp: naturezaDespesaElemento((f[8] || '').trim()),
      fonte: { codigo: (f[10] || '').trim(), descricao: (f[11] || '').trim() },
      autorizado: 0,
    }
    const k = `${linha.orgao.codigo}.${linha.unidade.codigo}|${linha.funcao}|${linha.subfuncao}|${linha.programa.codigo}|${linha.acao.codigo}|${linha.naturezaPcasp}|${linha.fonte.codigo}`
    const g = agg.get(k)
    const alvo = g ?? (agg.set(k, linha), linha)
    alvo.autorizado = (alvo.autorizado ?? 0) + cent(f[15])
  }
  return [...agg.values()]
}

const cellStr = (c: unknown): string => c == null ? '' : String(typeof c === 'object' && c !== null && 'result' in c ? (c as { result: unknown }).result : (typeof c === 'object' && c !== null && 'text' in c ? (c as { text: unknown }).text : c)).trim()
const cellNum = (c: unknown): number => { const n = parseFloat(cellStr(c)); return isNaN(n) ? 0 : Math.round(n * 100) }

/**
 * Layout "Balanço Orçamentário da Receita" (.xls → .xlsx): por conta ANALÍTICA,
 * colunas Orçado/Arrecadado. As linhas já são DISJUNTAS (Σ = receita líquida),
 * então NÃO filtrar folhas — somar todas. Devolve arrecadado por natureza PCASP.
 */
export async function parseArrecadacaoBalanco(caminhoXlsx: string, matchEntidade: string): Promise<{ naturezaPcasp: string; arrecadado: number }[]> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(caminhoXlsx)
  const rows: unknown[][] = []
  wb.worksheets[0]!.eachRow({ includeEmpty: false }, (r) => rows.push((r.values as unknown[]).slice(1)))
  const hi = rows.findIndex((r) => r.some((c) => cellStr(c) === 'Conta'))
  const hdr = rows[hi]!.map(cellStr)
  const iEnt = hdr.findIndex((h) => h === 'Entidade')
  const iCon = hdr.findIndex((h) => h === 'Conta')
  const iArr = hdr.findIndex((h) => /Arrecadado/.test(h))
  const out: { naturezaPcasp: string; arrecadado: number }[] = []
  for (const r of rows.slice(hi + 1)) {
    const cod = cellStr(r[iCon])
    if (!/^\d{15,}$/.test(cod) || cod.startsWith('9')) continue // "9…" = deduções (receita bruta)
    if (matchEntidade && !cellStr(r[iEnt]).toUpperCase().includes(matchEntidade.toUpperCase())) continue
    out.push({ naturezaPcasp: naturezaReceita(cod), arrecadado: cellNum(r[iArr]) })
  }
  return out
}
