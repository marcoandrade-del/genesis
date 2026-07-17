/**
 * Métrica objetiva do gabarito por CONTA×FONTE (classes 5-6): quantas células
 * (conta9×fonte STN) da nossa MSC casam a oficial do Siconfi, e o Σ|Δ|. Usada p/
 * validar o de/para de fonte (o emissor converte local→STN) — rodar antes/depois.
 * Uso: npx tsx scripts/metrica_gabarito_fonte.ts
 */
import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import { MatrizSaldosContabeisService } from '../src/services/matriz-saldos-contabeis.js'
const prisma = new PrismaClient({ adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })) })
const E = 'b186d24e-5f2a-4378-831f-c0092b626384'
const c9 = (cod: string) => cod.replace(/\./g, '').slice(0, 9)
async function main() {
  const msc = await new MatrizSaldosContabeisService(prisma).emitir(E, 2026, 5)
  if (!msc) return
  const nosso = new Map<string, number>()
  for (const l of msc.linhas) { if (!/^[56]/.test(l.conta)) continue; const k = `${c9(l.conta)}|${l.contaCorrente.fonte ?? ''}`; nosso.set(k, (nosso.get(k) ?? 0) + l.saldoFinal) }
  const of = new Map<string, number>()
  for (const cl of [5, 6]) for (const i of (JSON.parse(readFileSync(`data/abertura-2026/msc_siconfi/mscc_2026-05_eb_classe${cl}.json`, 'utf-8')) as { items: { conta_contabil: string; poder_orgao: string; natureza_conta: 'D' | 'C'; valor: number; fonte_recursos?: string | null }[] }).items) {
    if (i.poder_orgao !== '10131') continue
    const k = `${String(i.conta_contabil)}|${i.fonte_recursos ?? ''}`
    of.set(k, (of.get(k) ?? 0) + i.valor * (i.natureza_conta === 'D' ? 1 : -1))
  }
  let somaAbs = 0, cells = 0, match = 0
  for (const k of new Set([...nosso.keys(), ...of.keys()])) { const nv = nosso.get(k) ?? 0, ov = of.get(k) ?? 0; if (Math.abs(nv) < 1 && Math.abs(ov) < 1) continue; cells++; const d = Math.abs(nv - ov); somaAbs += d; if (d < 1) match++ }
  console.log(`células conta9×fonte (classes 5-6): ${cells} · casam (Δ<1): ${match} (${(match / cells * 100).toFixed(1)}%) · Σ|Δ|: ${(somaAbs / 1e6).toFixed(1)}mi`)
  await prisma.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
