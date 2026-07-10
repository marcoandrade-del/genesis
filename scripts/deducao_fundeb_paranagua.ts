/**
 * Dedução do FUNDEB (Prefeitura de Paranaguá): torna a receita consistente.
 *
 * A previsão está BRUTA e a arrecadada saiu LÍQUIDA (o balanço subtraiu o FUNDEB
 * dentro das transferências 1.7.1/1.7.2). Aqui: (a) re-bruta a ARRECADADA das
 * transferências (soma de volta o FUNDEB) e (b) cria a conta redutora
 * "(-) Dedução FUNDEB" com prevista −68,8mi (LOA) e arrecadada = o deduzido YTD.
 * Assim Σ prevista e Σ arrecadada ficam LÍQUIDAS e a dedução fica explícita.
 *
 * (As demais deduções do balanço — restituições de IPTU/ISS/ICMS — seguem
 * netadas nas suas receitas, que é o correto.)
 *   npx tsx scripts/deducao_fundeb_paranagua.ts [--apply]
 */
import 'dotenv/config'
import ExcelJS from 'exceljs'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'

const ANO = 2026
const APPLY = process.argv.includes('--apply')
const XLSX = '/home/marco/Downloads/Relatorio (3).xlsx'
const COD_REDUTORA = '9.7.1.0.00.0.0.00.00.00.00.00'
const PREV_FUNDEB = -6881480000 // −68.814.800,00 em centavos (LOA: 9171 −31,73mi + 9172 −37,0848mi)

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })
const reais = (c: number) => (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 })
const cs = (c: any) => c == null ? '' : String(typeof c === 'object' && c !== null && 'result' in c ? c.result : (typeof c === 'object' && 'text' in c ? c.text : c)).trim()
const cn = (c: any) => { const n = parseFloat(cs(c)); return isNaN(n) ? 0 : Math.round(n * 100) }

async function fundebArrecadado() {
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(XLSX)
  const rows: any[][] = []; wb.worksheets[0]!.eachRow({ includeEmpty: false }, (r) => rows.push((r.values as any[]).slice(1)))
  const hi = rows.findIndex((r) => r.some((c) => cs(c) === 'Conta')); const hdr = rows[hi]!.map(cs)
  const iC = hdr.findIndex((h) => h === 'Conta'), iA = hdr.findIndex((h) => /Arrecadado/.test(h))
  let d171 = 0, d172 = 0
  for (const r of rows.slice(hi + 1)) { const cod = cs(r[iC]); if (/^9171/.test(cod)) d171 += cn(r[iA]); else if (/^9172/.test(cod)) d172 += cn(r[iA]) }
  return { d171, d172 } // negativos
}

async function main() {
  console.log(`\n═══ Dedução FUNDEB — Prefeitura de Paranaguá ${APPLY ? '[APPLY]' : '[DRY-RUN]'} ═══`)
  const { d171, d172 } = await fundebArrecadado()
  console.log(`FUNDEB arrecadado (deduzido) YTD: 1.7.1 ${reais(d171)} · 1.7.2 ${reais(d172)} · total ${reais(d171 + d172)}`)

  const pref = await prisma.entidade.findFirstOrThrow({ where: { tipo: 'PREFEITURA', municipio: { is: { nome: 'Paranaguá' } } }, select: { id: true } })
  const orc = await prisma.orcamento.findUniqueOrThrow({ where: { entidadeId_ano: { entidadeId: pref.id, ano: ANO } }, select: { id: true } })
  const fonte = (await prisma.fonteRecursoEntidade.findFirstOrThrow({ where: { entidadeId: pref.id, ano: ANO, codigo: '0000' }, select: { id: true } })).id

  // previsões de transferências a re-brutar
  const acha = async (cod: string) => prisma.previsaoReceita.findFirst({ where: { orcamentoId: orc.id, contaReceita: { is: { codigo: cod } } }, select: { id: true, valorArrecadado: true, valorPrevisto: true } })
  const p171 = await acha('1.7.1.0.00.0.0.00.00.00.00.00'); const p172 = await acha('1.7.2.0.00.0.0.00.00.00.00.00')
  if (!p171 || !p172) throw new Error('previsão 1.7.1/1.7.2 não encontrada')
  const g171 = Math.round(Number(p171.valorArrecadado) * 100) - d171 // net − (neg) = gross
  const g172 = Math.round(Number(p172.valorArrecadado) * 100) - d172
  console.log(`re-bruta 1.7.1: ${reais(Math.round(Number(p171.valorArrecadado) * 100))} → ${reais(g171)}`)
  console.log(`re-bruta 1.7.2: ${reais(Math.round(Number(p172.valorArrecadado) * 100))} → ${reais(g172)}`)
  console.log(`redutora "(-) Dedução FUNDEB": prevista ${reais(PREV_FUNDEB)} · arrecadada ${reais(d171 + d172)}`)

  if (!APPLY) { console.log('\nDRY-RUN: nada gravado.'); return }
  await prisma.$transaction(async (tx) => {
    await tx.previsaoReceita.update({ where: { id: p171.id }, data: { valorArrecadado: (g171 / 100).toFixed(2) } })
    await tx.previsaoReceita.update({ where: { id: p172.id }, data: { valorArrecadado: (g172 / 100).toFixed(2) } })
    let conta = await tx.contaReceitaEntidade.findFirst({ where: { entidadeId: pref.id, ano: ANO, codigo: COD_REDUTORA }, select: { id: true } })
    if (!conta) conta = await tx.contaReceitaEntidade.create({ data: { entidadeId: pref.id, ano: ANO, codigo: COD_REDUTORA, descricao: '(-) Deduções da Receita para Formação do FUNDEB', nivel: 3, admiteMovimento: false, origem: 'DESDOBRAMENTO' }, select: { id: true } })
    await tx.previsaoReceita.upsert({
      where: { previsao_unica: { orcamentoId: orc.id, contaReceitaEntidadeId: conta.id, fonteRecursoEntidadeId: fonte } },
      create: { orcamentoId: orc.id, contaReceitaEntidadeId: conta.id, fonteRecursoEntidadeId: fonte, valorPrevisto: (PREV_FUNDEB / 100).toFixed(2), valorArrecadado: ((d171 + d172) / 100).toFixed(2) },
      update: { valorPrevisto: (PREV_FUNDEB / 100).toFixed(2), valorArrecadado: ((d171 + d172) / 100).toFixed(2) },
    })
    console.log('  [apply] transferências re-brutadas + redutora FUNDEB gravada')
  }, { timeout: 60_000 })

  const agg = await prisma.previsaoReceita.aggregate({ where: { orcamentoId: orc.id }, _sum: { valorPrevisto: true, valorArrecadado: true } })
  console.log(`\nPrefeitura Σ prevista ${reais(Math.round(Number(agg._sum.valorPrevisto) * 100))} (líquida esperada 1.282.085.954,72) · Σ arrecadada ${reais(Math.round(Number(agg._sum.valorArrecadado) * 100))}`)
}
main().catch((e) => { console.error('FALHOU:', e instanceof Error ? e.stack || e.message : e); process.exitCode = 1 }).finally(async () => { await prisma.$disconnect(); await pool.end() })
