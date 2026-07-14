/**
 * GABARITO: nossa MSC (emitir) × MSC OFICIAL do Siconfi (ending_balance),
 * Prefeitura de Maringá (poder_orgao 10131), agregado por conta(9díg)×fonte.
 * Read-only. Uso: npx tsx scripts/gabarito_msc_siconfi.ts --mes=5
 */
import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import { MatrizSaldosContabeisService } from '../src/services/matriz-saldos-contabeis.js'

const MES = Number(process.argv.find((a) => a.startsWith('--mes='))?.split('=')[1] ?? '5')
const E = 'b186d24e-5f2a-4378-831f-c0092b626384'
const DIR = 'data/abertura-2026/msc_siconfi'
const prisma = new PrismaClient({ adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })) })
const fmt = (x: number) => x.toLocaleString('pt-BR', { minimumFractionDigits: 2 })
const r2 = (x: number) => Math.round(x * 100) / 100

async function main() {
  // OFICIAL: SF em débito-com-sinal por conta9×fonte (só 10131)
  const oficial = new Map<string, number>()
  const oficialPorClasse = new Map<string, number>()
  for (let cl = 1; cl <= 8; cl++) {
    const d = JSON.parse(readFileSync(`${DIR}/mscc_2026-${String(MES).padStart(2, '0')}_eb_classe${cl}.json`, 'utf-8'))
    for (const i of d.items) {
      if (i.poder_orgao !== '10131') continue
      const v = i.valor * (i.natureza_conta === 'D' ? 1 : -1)
      const k = `${i.conta_contabil}|${i.fonte_recursos ?? ''}`
      oficial.set(k, r2((oficial.get(k) ?? 0) + v))
      oficialPorClasse.set(String(cl), r2((oficialPorClasse.get(String(cl)) ?? 0) + v))
    }
  }
  // NOSSA: emitir → conta12→9díg (7 primeiros segmentos), agrega por conta9×fonte
  const m = await new MatrizSaldosContabeisService(prisma).emitir(E, 2026, MES)
  const nossa = new Map<string, number>()
  const nossaPorClasse = new Map<string, number>()
  for (const l of m!.linhas) {
    const seg = l.conta.split('.')
    const c9 = seg.slice(0, 7).join('')
    const k = `${c9}|${l.contaCorrente.fonte ?? ''}`
    nossa.set(k, r2((nossa.get(k) ?? 0) + l.saldoFinal))
    nossaPorClasse.set(l.conta[0], r2((nossaPorClasse.get(l.conta[0]) ?? 0) + l.saldoFinal))
  }

  console.log(`=== GABARITO mês ${MES}/2026 — Prefeitura (10131) · SF em débito-com-sinal ===`)
  console.log('classe | OFICIAL | NOSSA | Δ (nossa−oficial)')
  for (let cl = 1; cl <= 8; cl++) {
    const o = oficialPorClasse.get(String(cl)) ?? 0
    const n = nossaPorClasse.get(String(cl)) ?? 0
    console.log(`  ${cl} | ${fmt(o)} | ${fmt(n)} | ${fmt(r2(n - o))}`)
  }

  // detalhe por conta9 (agregando fontes) — top Δ
  const contas = new Set([...oficial.keys(), ...nossa.keys()].map((k) => k.split('|')[0]))
  const porConta: Array<{ c: string; o: number; n: number; d: number }> = []
  for (const c of contas) {
    let o = 0, n = 0
    for (const [k, v] of oficial) if (k.startsWith(c + '|')) o += v
    for (const [k, v] of nossa) if (k.startsWith(c + '|')) n += v
    if (Math.abs(n - o) > 0.01) porConta.push({ c, o: r2(o), n: r2(n), d: r2(n - o) })
  }
  porConta.sort((a, b) => Math.abs(b.d) - Math.abs(a.d))
  console.log(`\ncontas com Δ: ${porConta.length} de ${contas.size} · top 12:`)
  for (const x of porConta.slice(0, 12)) console.log(`  ${x.c} | oficial ${fmt(x.o)} | nossa ${fmt(x.n)} | Δ ${fmt(x.d)}`)

  // matches exatos (celebrar o que já bate)
  const batem = [...contas].filter((c) => {
    let o = 0, n = 0
    for (const [k, v] of oficial) if (k.startsWith(c + '|')) o += v
    for (const [k, v] of nossa) if (k.startsWith(c + '|')) n += v
    return Math.abs(n - o) <= 0.01 && (Math.abs(o) > 0.01 || Math.abs(n) > 0.01)
  })
  console.log(`\ncontas que BATEM ao centavo (≠0): ${batem.length}`)
  for (const c of batem.slice(0, 10)) console.log(`  ${c}`)
  await prisma.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
