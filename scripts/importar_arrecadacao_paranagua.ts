/**
 * ARRECADAÇÃO (receita realizada) da Prefeitura de Paranaguá 2026 — do "Balanço
 * Orçamentário da Receita" (IPM, .xls → .xlsx). Seta valorArrecadado nas
 * PrevisaoReceita (que hoje estão em 0, só com o orçado/previsto).
 *
 * O balanço é por conta ANALÍTICA (ex. IPTU 4111250010…), mais fundo que as
 * previsões (nível espécie). Agregamos o arrecadado até a previsão que o contém
 * (maior prefixo pontuado). Código: dropa 1º díg + fatia [1,1,1,1,2,1,1,2,2,2,2,2].
 *
 * Converter antes:  libreoffice --headless --convert-to xlsx --outdir <dir> Relatorio.xls
 *   npx tsx scripts/importar_arrecadacao_paranagua.ts --xlsx <arq.xlsx> [--apply]
 */
import 'dotenv/config'
import ExcelJS from 'exceljs'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'

const ANO = 2026
const XLSX = (() => { const i = process.argv.indexOf('--xlsx'); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : '/tmp/claude-1000/-home-marco/da9ed666-7da5-40c7-906d-5e887fa3f9a0/scratchpad/Relatorio.xlsx' })()
const APPLY = process.argv.includes('--apply')
const arg = (n: string, d: string) => { const i = process.argv.indexOf(n); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : d }
const BAL_ENT = arg('--balanco-ent', 'MUNICIPIO') // filtro na coluna Entidade do balanço
const ENT_NOME = arg('--ent-nome', 'Prefeitura Municipal de Paranaguá') // entidade no banco

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })
const reais = (c: number): string => (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const SEG = [1, 1, 1, 1, 2, 1, 1, 2, 2, 2, 2, 2]
function dotted(cod19: string): string { const d = cod19.slice(1); const p: string[] = []; let i = 0; for (const w of SEG) { p.push(d.slice(i, i + w)); i += w } return p.join('.') }
function signif(cod: string): string { const p = cod.split('.'); while (p.length > 1 && /^0+$/.test(p[p.length - 1]!)) p.pop(); return p.join('.') }
const cellStr = (c: any): string => c == null ? '' : String(typeof c === 'object' && c !== null && 'result' in c ? c.result : (typeof c === 'object' && 'text' in c ? c.text : c)).trim()
const cellNum = (c: any): number => { const n = parseFloat(cellStr(c)); return isNaN(n) ? 0 : Math.round(n * 100) } // exceljs já dá número com ponto decimal

async function lerXlsx() {
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(XLSX)
  const rows: any[][] = []; wb.worksheets[0]!.eachRow({ includeEmpty: false }, (r) => rows.push((r.values as any[]).slice(1)))
  const hi = rows.findIndex((r) => r.some((c) => cellStr(c) === 'Conta'))
  const hdr = rows[hi]!.map(cellStr)
  const idx = (nome: string) => hdr.findIndex((h) => h === nome || (nome === 'Arrecadado' && /Arrecadado/.test(h)))
  const iEnt = idx('Entidade'), iCon = idx('Conta'), iOrc = idx('Orçado'), iArr = idx('Arrecadado')
  const linhas: { ent: string; cod: string; orc: number; arr: number }[] = []
  for (const r of rows.slice(hi + 1)) {
    const cod = cellStr(r[iCon]); if (!/^\d{15,}$/.test(cod)) continue
    linhas.push({ ent: cellStr(r[iEnt]), cod, orc: cellNum(r[iOrc]), arr: cellNum(r[iArr]) })
  }
  return linhas
}

async function main() {
  console.log(`\n═══ Arrecadação (receita realizada) — Prefeitura de Paranaguá ${APPLY ? '[APPLY]' : '[DRY-RUN]'} ═══`)
  // as linhas do balanço já são DISJUNTAS (Σ = receita líquida ao centavo); NÃO
  // filtrar folhas (o valor pode estar no nível sintético, com filhas vazias).
  const linhas = (await lerXlsx()).filter((l) => l.ent.includes(BAL_ENT))
  const totArr = linhas.reduce((a, l) => a + l.arr, 0), totOrc = linhas.reduce((a, l) => a + l.orc, 0)
  console.log(`balanço: ${linhas.length} linhas · Σ orçado ${reais(totOrc)} · Σ arrecadado ${reais(totArr)}`)

  const pref = await prisma.entidade.findFirstOrThrow({ where: { nome: ENT_NOME, municipio: { is: { nome: 'Paranaguá' } } }, select: { id: true } })
  const orc = await prisma.orcamento.findUniqueOrThrow({ where: { entidadeId_ano: { entidadeId: pref.id, ano: ANO } }, select: { id: true } })
  const prevs = await prisma.previsaoReceita.findMany({ where: { orcamentoId: orc.id }, select: { id: true, contaReceita: { select: { codigo: true } } } })
  // mapa: significativo da previsão → {id, acumulador}, ordenado por prefixo mais longo
  const prevMap = new Map<string, number>() // sig → valorPrevisto (centavos) do banco
  for (const p of prevs) prevMap.set(signif(p.contaReceita.codigo), 0)
  const alvos = prevs.map((p) => ({ id: p.id, sig: signif(p.contaReceita.codigo), cod: p.contaReceita.codigo, arr: 0, orcBal: 0 })).sort((a, b) => b.sig.length - a.sig.length)

  let casado = 0, semPrev = 0
  for (const l of linhas) {
    const s = signif(dotted(l.cod))
    const alvo = alvos.find((a) => s === a.sig || s.startsWith(a.sig + '.'))
    if (alvo) { alvo.arr += l.arr; alvo.orcBal += l.orc; casado += l.arr } else semPrev += l.arr
  }
  console.log(`casado em previsões: ${reais(casado)} · sem previsão correspondente: ${reais(semPrev)}`)
  const comArr = alvos.filter((a) => a.arr > 0).length
  console.log(`previsões que recebem arrecadado: ${comArr}/${alvos.length}`)
  // compara orçado do balanço × orçado da previsão (banco) por conta
  const prevOrc = new Map((await prisma.previsaoReceita.findMany({ where: { orcamentoId: orc.id }, select: { valorPrevisto: true, contaReceita: { select: { codigo: true } } } })).map((p) => [signif(p.contaReceita.codigo), Math.round(Number(p.valorPrevisto) * 100)]))
  console.log('\n  conta          | orçado previsão (banco) | orçado balanço | arrecadado balanço')
  for (const a of [...alvos].sort((x, y) => x.sig.localeCompare(y.sig))) {
    const po = prevOrc.get(a.sig) ?? 0
    const flag = Math.abs(po - a.orcBal) > 100 ? ' ⚠' : ''
    console.log(`  ${a.sig.padEnd(14)} | ${reais(po).padStart(22)} | ${reais(a.orcBal).padStart(14)} | ${reais(a.arr).padStart(16)}${flag}`)
  }

  if (!APPLY) { console.log('\nDRY-RUN: nada gravado.'); return }
  await prisma.$transaction(async (tx) => {
    let n = 0
    for (const a of alvos) { await tx.previsaoReceita.update({ where: { id: a.id }, data: { valorArrecadado: (a.arr / 100).toFixed(2) } }); n++ }
    console.log(`  [apply] valorArrecadado gravado em ${n} previsões (Σ ${reais(alvos.reduce((s, a) => s + a.arr, 0))})`)
  }, { timeout: 120_000 })
}
main().catch((e) => { console.error('FALHOU:', e instanceof Error ? e.stack || e.message : e); process.exitCode = 1 }).finally(async () => { await prisma.$disconnect(); await pool.end() })
