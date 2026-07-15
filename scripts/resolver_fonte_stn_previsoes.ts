/**
 * Resolve a FONTE STN de cada PrevisaoReceita da entidade, casando com a MSC
 * OFICIAL do Siconfi (ver memória msc-siconfi-fonte-oficial):
 *
 *  1. De/para PROVADO por fonte (data/abertura-2026/depara_fontes_local_stn.json —
 *     derivado da Nota 008-2021 TCE-PR + prova ao centavo contra a MSC): quando a
 *     fonte local mapeia 1:1, todas as previsões dela herdam a fonte STN.
 *  2. Fontes DIVIDIDAS (a correspondência oficial é fonte×aplicação → STN):
 *     resolve por previsão, casando (natureza8 × valor líquido) contra as linhas
 *     oficiais (521110000 − 521120101 por natureza×fonte STN).
 *
 * Fail-loud: previsões sem resolução ficam NULL e são reportadas (nunca chuta).
 * Idempotente: recalcula e regrava tudo da entidade.
 *
 * Uso: npx tsx scripts/resolver_fonte_stn_previsoes.ts [--apply]
 */
import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'

const APPLY = process.argv.includes('--apply')
const E = 'b186d24e-5f2a-4378-831f-c0092b626384' // Prefeitura do Município (Maringá)
const PODER = '10131'
const DIR = 'data/abertura-2026/msc_siconfi'
const DEPARA = 'data/abertura-2026/depara_fontes_local_stn.json'

const prisma = new PrismaClient({ adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })) })
const r2 = (x: number) => Math.round(x * 100) / 100
const fmt = (x: number) => x.toLocaleString('pt-BR', { minimumFractionDigits: 2 })
const nat8 = (c: string) => c.split('.').slice(0, 7).join('')

async function main() {
  const depara: Record<string, string> = JSON.parse(readFileSync(DEPARA, 'utf-8')).depara

  const prevs = await prisma.previsaoReceita.findMany({
    where: { orcamento: { entidadeId: E, ano: 2026 } },
    select: { id: true, valorPrevisto: true, contaReceita: { select: { codigo: true } }, fonteRecurso: { select: { codigo: true } } },
  })

  // linhas oficiais líquidas por natureza8 → fonte STN → valor
  const eb = JSON.parse(readFileSync(`${DIR}/mscc_2026-01_eb_classe5.json`, 'utf-8'))
  const ofic = new Map<string, Map<string, number>>()
  for (const i of eb.items) {
    if (i.poder_orgao !== PODER || !i.natureza_receita) continue
    let v = 0
    if (i.conta_contabil === '521110000') v = i.valor * (i.natureza_conta === 'D' ? 1 : -1)
    else if (i.conta_contabil === '521120101') v = -i.valor * (i.natureza_conta === 'C' ? 1 : -1)
    else continue
    const m = ofic.get(i.natureza_receita) ?? new Map()
    m.set(i.fonte_recursos, r2((m.get(i.fonte_recursos) ?? 0) + v))
    ofic.set(i.natureza_receita, m)
  }

  let porFonte = 0, porNatureza = 0
  const semResolucao: Array<{ id: string; nat: string; fonte: string; v: number }> = []
  const updates: Array<{ id: string; stn: string }> = []
  for (const p of prevs) {
    const fLocal = p.fonteRecurso.codigo
    const direto = depara[fLocal]
    if (direto) {
      updates.push({ id: p.id, stn: direto })
      porFonte++
      continue
    }
    // fonte dividida/pendente: casa (natureza8, valor) na MSC oficial
    const n = nat8(p.contaReceita.codigo)
    const v = r2(Number(p.valorPrevisto))
    const alvos = ofic.get(n)
    const ms = alvos ? [...alvos.entries()].filter(([, va]) => Math.abs(va - v) < 0.01) : []
    if (ms.length === 1) {
      updates.push({ id: p.id, stn: ms[0][0] })
      porNatureza++
    } else {
      semResolucao.push({ id: p.id, nat: n, fonte: fLocal, v })
    }
  }

  const valorTotal = prevs.reduce((a, p) => a + Number(p.valorPrevisto), 0)
  const valorSem = semResolucao.reduce((a, s) => a + s.v, 0)
  console.log(`previsões: ${prevs.length} · resolvidas por fonte: ${porFonte} · por natureza×valor: ${porNatureza} · SEM resolução: ${semResolucao.length}`)
  console.log(`cobertura por valor: ${(((valorTotal - valorSem) / valorTotal) * 100).toFixed(2)}% (sem resolução: ${fmt(valorSem)})`)
  for (const s of semResolucao.slice(0, 12)) console.log(`  sem: nat ${s.nat} fonte ${s.fonte} ${fmt(s.v)}`)

  if (!APPLY) { console.log('\nDRY-RUN — nada gravado. --apply p/ gravar fonteStnCodigo.'); await prisma.$disconnect(); return }
  // regrava tudo (idempotente): primeiro limpa, depois aplica os resolvidos
  await prisma.previsaoReceita.updateMany({ where: { orcamento: { entidadeId: E, ano: 2026 } }, data: { fonteStnCodigo: null } })
  for (const u of updates) await prisma.previsaoReceita.update({ where: { id: u.id }, data: { fonteStnCodigo: u.stn } })
  console.log(`APPLY: fonteStnCodigo gravado em ${updates.length} previsões.`)
  await prisma.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
