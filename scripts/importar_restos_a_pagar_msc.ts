/**
 * Importa a INSCRIÇÃO de Restos a Pagar (abertura 2026) da Prefeitura de Maringá
 * a partir da MSC OFICIAL do Siconfi (beginning_balance jan/2026; dev é greenfield
 * em 2025). Reproduz FIELMENTE o bb do RP no razão, com conta-corrente CRUA:
 *
 *   classe 5 (controle, DEVEDORA) → DEBITO   ·  classe 6 (execução, CREDORA) → CREDITO
 *   D 5.3.1.7 (a inscrever) + 5.3.1.2 (proc)  =  C 6.3.1.7.1 + 6.3.1.1   (Σ 336,7mi)
 *
 * cc = fonte + natureza-despesa + função + subfunção. A execução mensal (a
 * liquidar→pago→cancelado) é a fase 2 (pc classe6).
 *
 * Uso: npx tsx scripts/importar_restos_a_pagar_msc.ts [--apply]
 */
import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import { RestosAPagarContabilService, type LinhaRp, type MovimentoRp } from '../src/services/restos-a-pagar-contabil.js'

const APPLY = process.argv.includes('--apply')
const E = 'b186d24e-5f2a-4378-831f-c0092b626384' // Prefeitura do Município (Maringá)
const ANO = 2026
const PODER = '10131'
const DIR = 'data/abertura-2026/msc_siconfi'

const prisma = new PrismaClient({ adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })) })
const r2 = (x: number) => Math.round(x * 100) / 100
const fmt = (x: number) => x.toLocaleString('pt-BR', { minimumFractionDigits: 2 })

// 9 díg PCASP → código de 12 segmentos do plano (5 simples + 2×2 + 5×"00").
const conta12 = (c: string) => `${c[0]}.${c[1]}.${c[2]}.${c[3]}.${c[4]}.${c.slice(5, 7)}.${c.slice(7, 9)}.00.00.00.00.00`
// 8 díg natureza de despesa → pontuada (cat.grupo.mod.elem.desdobr).
const natDesp = (nd: string | null) => (nd ? `${nd[0]}.${nd[1]}.${nd.slice(2, 4)}.${nd.slice(4, 6)}.${nd.slice(6, 8)}` : null)

type Item = { conta_contabil: string; poder_orgao: string; natureza_conta: 'D' | 'C'; valor: number; fonte_recursos: string | null; natureza_despesa: string | null; funcao: string | null; subfuncao: string | null }

async function main() {
  // agrega bb classe5+6 do RP (531*/631*) por (conta, cc), valor com sinal (D +, C −).
  const chave = new Map<string, { linha: Omit<LinhaRp, 'tipo' | 'valor'> & { conta: string }; valor: number }>()
  for (const cl of [5, 6]) {
    const d = JSON.parse(readFileSync(`${DIR}/mscc_2026-01_bb_classe${cl}.json`, 'utf-8')) as { items: Item[] }
    for (const i of d.items) {
      if (i.poder_orgao !== PODER) continue
      const c = i.conta_contabil
      if (!(c.startsWith('531') || c.startsWith('631'))) continue
      const linha = { conta: conta12(c), fonte: i.fonte_recursos || null, funcao: i.funcao || null, subfuncao: i.subfuncao || null, naturezaDespesa: natDesp(i.natureza_despesa) }
      const k = `${linha.conta}|${linha.fonte}|${linha.funcao}|${linha.subfuncao}|${linha.naturezaDespesa}`
      const cur = chave.get(k) ?? { linha, valor: 0 }
      cur.valor = r2(cur.valor + i.valor * (i.natureza_conta === 'D' ? 1 : -1))
      chave.set(k, cur)
    }
  }

  const linhas: LinhaRp[] = []
  let totalD = 0
  let totalC = 0
  for (const { linha, valor } of chave.values()) {
    if (Math.abs(valor) < 0.01) continue
    const tipo = valor > 0 ? 'DEBITO' : 'CREDITO'
    if (tipo === 'DEBITO') totalD = r2(totalD + valor)
    else totalC = r2(totalC - valor)
    linhas.push({ contaCodigo: linha.conta, tipo, valor: Math.abs(valor).toFixed(2), fonte: linha.fonte, funcao: linha.funcao, subfuncao: linha.subfuncao, naturezaDespesa: linha.naturezaDespesa })
  }

  // resumo por conta
  const porConta = new Map<string, number>()
  for (const l of linhas) porConta.set(l.contaCodigo, r2((porConta.get(l.contaCodigo) ?? 0) + Number(l.valor) * (l.tipo === 'DEBITO' ? 1 : -1)))
  console.log(`linhas: ${linhas.length} · D=${fmt(totalD)} · C=${fmt(totalC)} (fecha: ${Math.abs(totalD - totalC) < 0.01})`)
  for (const [c, v] of [...porConta].sort()) console.log(`  ${c}  ${fmt(v)}`)

  if (!APPLY) {
    console.log('\nDRY-RUN — nada gravado. --apply p/ contabilizar a inscrição do RP.')
    await prisma.$disconnect()
    return
  }

  const mov: MovimentoRp = { data: `${ANO}-01-01`, historico: 'Inscrição de Restos a Pagar (abertura 2026)', origemId: 'rp-abertura-2026', eventoCodigo: '004', linhas }
  const resumo = await new RestosAPagarContabilService(prisma).contabilizar(E, ANO, [mov], 'BACKFILL_RP')
  console.log(`\nAPLICADO: ${resumo.lancamentos} lançamento(s), ${resumo.itens} itens, D=${resumo.totalDebito} C=${resumo.totalCredito}.`)
  await prisma.$disconnect()
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
