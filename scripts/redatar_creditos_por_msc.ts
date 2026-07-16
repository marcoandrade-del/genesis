/**
 * Re-data os créditos adicionais (decretos) de Maringá 2026 pelo TIMING oficial,
 * ancorado na MSC do Siconfi — resolve a limitação de que o Portal não publica a
 * data do decreto (todos entraram carimbados no dia do import → o espelho os
 * amontoava em julho, ver credito-contabil / backfill_credito_contabil).
 *
 * MÉTODO (caminho limpo, sem raspar o Diário Oficial):
 *   1. A MSC OFICIAL (eb classe 5, poder 10131) dá o saldo mensal das contas de
 *      ABERTURA de crédito (5.2.2.1.2.0x + 5.2.2.1.3.0x). Meses 1-5 homologados.
 *      Disso sai a CURVA de timing: fração acumulada de abertura por mês.
 *   2. Os números de decreto são SEQUENCIAIS/cronológicos. Ordenando os nossos
 *      decretos por número e caminhando a fração acumulada do reforço, cada
 *      decreto cai no mês cuja fronteira da curva oficial ele cruza.
 *   3. Re-data CreditoAdicional.data para o dia 15 do mês atribuído, estorna os
 *      lançamentos CREDITO_ADICIONAL e re-contabiliza (datas novas). A fixação
 *      '002' (Jan/01) fica intacta; os totais anuais não mudam (só o timing).
 *
 * LIMITE HONESTO: normaliza a curva em MAIO=100% (jun não homologado) ⇒ os poucos
 * decretos de jun/jul dobram em maio. E o Δ por-conta vs oficial permanece (o
 * espelho lumpa todo reforço em 5.2.2.1.2.01; o oficial separa por FONTE do
 * crédito — limitação já diferida, independente da data). O ganho aqui é o
 * TIMING: os créditos passam a aparecer jan-mai no ritmo oficial, não em julho.
 *
 * Uso: npx tsx scripts/redatar_creditos_por_msc.ts [--apply]
 */
import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient, Prisma } from '@prisma/client'
import { CreditoContabilService, CONTAS_CREDITO } from '../src/services/credito-contabil.js'

const APPLY = process.argv.includes('--apply')
const E = 'b186d24e-5f2a-4378-831f-c0092b626384' // Prefeitura do Município (Maringá)
const ANO = 2026
const USUARIO = 'BACKFILL_CREDITO'
const PODER = '10131'
const DIR = 'data/abertura-2026/msc_siconfi'
const MESES = [1, 2, 3, 4, 5] as const // meses homologados da MSC oficial
const DIA = 15 // dia representativo do mês (irrelevante p/ o balancete mensal)
// contas de ABERTURA de crédito na MSC oficial (prefixos 9 díg): 5.2.2.1.2.0x (aberturas) + 5.2.2.1.3.0x (por fonte)
const PREF_ABERTURA = ['5221201', '5221202', '5221301', '5221302', '5221303']

const prisma = new PrismaClient({ adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })) })
const brl = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 2 })
const dec = (v: Prisma.Decimal.Value = 0) => new Prisma.Decimal(v)

/** Σ das contas de abertura de crédito (poder 10131), por mês, da MSC oficial. */
function aberturaOficial(mes: number): number {
  const d = JSON.parse(readFileSync(`${DIR}/mscc_2026-${String(mes).padStart(2, '0')}_eb_classe5.json`, 'utf-8')) as {
    items: { conta_contabil: string; poder_orgao: string; natureza_conta: 'D' | 'C'; valor: number }[]
  }
  let s = 0
  for (const i of d.items) {
    if (i.poder_orgao !== PODER) continue
    if (!PREF_ABERTURA.some((p) => String(i.conta_contabil).startsWith(p))) continue
    s += i.valor * (i.natureza_conta === 'D' ? 1 : -1)
  }
  return Math.round(s * 100) / 100
}

async function main() {
  // ── 1. Curva oficial de timing (fração acumulada da abertura por mês) ──────
  const oAbs = MESES.map(aberturaOficial)
  const oFinal = oAbs[oAbs.length - 1]!
  const fO = oAbs.map((v) => v / oFinal) // fO[i] = fração acumulada até o mês MESES[i]
  console.log('Curva oficial de abertura de crédito (poder 10131, eb classe 5):')
  MESES.forEach((m, i) => console.log(`  mês ${m}: ${brl(oAbs[i]!).padStart(20)}  (${(fO[i]! * 100).toFixed(1)}%)`))

  // ── 2. Decretos com Σreforço/Σanulação, ordenados por número (cronológico) ─
  const orc = await prisma.orcamento.findUniqueOrThrow({
    where: { entidadeId_ano: { entidadeId: E, ano: ANO } },
    include: { creditos: { include: { itens: { select: { operacao: true, valor: true } } } } },
  })
  type Dec = { id: string; numero: string; dataAtual: string; ref: number; anu: number; ord: number }
  const decretos: Dec[] = orc.creditos.map((c) => {
    let ref = 0
    let anu = 0
    for (const it of c.itens) (it.operacao === 'REFORCO' ? (ref += Number(it.valor)) : (anu += Number(it.valor)))
    const m = c.numero.match(/^(\d+)/)
    return { id: c.id, numero: c.numero, dataAtual: c.data.toISOString().slice(0, 10), ref, anu, ord: m ? parseInt(m[1]!) : Number.MAX_SAFE_INTEGER }
  })
  // números primeiro (asc); S/N por último (resíduos de conciliação = estado final)
  decretos.sort((a, b) => a.ord - b.ord || (a.numero < b.numero ? -1 : 1))

  const totalRef = decretos.reduce((s, d) => s + d.ref, 0)
  const totalAnu = decretos.reduce((s, d) => s + d.anu, 0)
  const sn = decretos.filter((d) => d.ord === Number.MAX_SAFE_INTEGER)
  console.log(`\ndecretos: ${decretos.length} (numerados ${decretos.length - sn.length} · S/N ${sn.length})`)
  console.log(`Σreforço: ${brl(totalRef)} · Σanulação: ${brl(totalAnu)}`)
  console.log(`datas atuais distintas: ${[...new Set(decretos.map((d) => d.dataAtual))].sort().join(', ')}`)
  if (sn.length) for (const s of sn) console.log(`  S/N "${s.numero}": ref ${brl(s.ref)} · anu ${brl(s.anu)} → mês 5`)

  // ── 3. Atribui mês pela fração acumulada do reforço vs curva oficial ───────
  const mesPorId = new Map<string, number>()
  const porMes = new Map<number, { n: number; ref: number; anu: number }>()
  let cum = 0
  for (const d of decretos) {
    cum += d.ref
    const frac = totalRef > 0 ? cum / totalRef : 1
    let mes = MESES[MESES.length - 1]!
    for (let i = 0; i < MESES.length; i++)
      if (frac <= fO[i]! + 1e-9) {
        mes = MESES[i]!
        break
      }
    mesPorId.set(d.id, mes)
    const acc = porMes.get(mes) ?? { n: 0, ref: 0, anu: 0 }
    acc.n++
    acc.ref += d.ref
    acc.anu += d.anu
    porMes.set(mes, acc)
  }

  console.log('\nAtribuição proposta (nosso reforço por mês) × oficial:')
  let cref = 0
  for (const m of MESES) {
    const a = porMes.get(m) ?? { n: 0, ref: 0, anu: 0 }
    cref += a.ref
    const i = MESES.indexOf(m)
    console.log(
      `  mês ${m}: ${String(a.n).padStart(3)} decretos · reforço ${brl(a.ref).padStart(18)} · anul ${brl(a.anu).padStart(16)} | ` +
        `nosso acum ${brl(cref).padStart(18)} (${((cref / totalRef) * 100).toFixed(1)}%) vs oficial ${brl(oAbs[i]!).padStart(18)} · Δ ${brl(cref - oAbs[i]!)}`,
    )
  }
  console.log(`  (Δ = resíduo por-FONTE, já diferido — o timing/forma casa; o absoluto não fecha por conta do split de origem do crédito)`)

  if (!APPLY) {
    console.log('\nDRY-RUN — nada gravado. --apply p/ re-datar + estornar + re-contabilizar.')
    await prisma.$disconnect()
    return
  }

  // ── 4. Aplica: re-data, estorna os lançamentos de crédito, re-contabiliza ──
  await prisma.$transaction(async (tx) => {
    for (const d of decretos) {
      const mes = mesPorId.get(d.id)!
      await tx.creditoAdicional.update({ where: { id: d.id }, data: { data: new Date(Date.UTC(ANO, mes - 1, DIA)) } })
    }
  })
  console.log(`\n✓ ${decretos.length} decretos re-datados (dia ${DIA} do mês atribuído).`)

  const svc = new CreditoContabilService(prisma)
  const estornados = await svc.estornar(E, ANO)
  console.log(`✓ ${estornados} lançamentos de crédito estornados.`)
  const r = await svc.contabilizar(E, ANO, USUARIO)
  console.log(`✓ re-contabilizado: ${r.creditos} créditos · reforços ${r.reforcos} (${r.totalReforco}) · anulações ${r.anulacoes} (${r.totalAnulacao})`)

  // ── 5. Verificação: nosso 5.2.2.1.2.01 acumulado por mês no razão ──────────
  const conta = await prisma.contaContabilEntidade.findFirstOrThrow({
    where: { entidadeId: E, ano: ANO, codigo: CONTAS_CREDITO.suplementar },
    select: { id: true },
  })
  const resumos = await prisma.resumoMensalConta.findMany({
    where: { entidadeId: E, contaId: conta.id, ano: ANO },
    select: { mes: true, totalDebito: true, totalCredito: true },
    orderBy: { mes: 'asc' },
  })
  console.log('\nVerificação — 5.2.2.1.2.01 (suplementar) acumulado no razão × oficial (todas as aberturas):')
  let acc = dec(0)
  for (const m of MESES) {
    const rm = resumos.find((x) => x.mes === m)
    if (rm) acc = acc.plus(rm.totalDebito).minus(rm.totalCredito)
    const i = MESES.indexOf(m)
    console.log(`  mês ${m}: razão ${brl(Number(acc)).padStart(18)} | oficial ${brl(oAbs[i]!).padStart(18)} | Δ ${brl(Number(acc) - oAbs[i]!)}`)
  }
  await prisma.$disconnect()
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
