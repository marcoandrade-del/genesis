/**
 * Importa o CONTROLE DA PROGRAMAÇÃO FINANCEIRA (classes 7-8, cronograma de
 * desembolso do Art. 8º da LRF) da Prefeitura de Maringá 2026, a partir da MSC
 * OFICIAL do Siconfi (dev é greenfield 2025; o motor não gera esses controles).
 *
 * É controle PURO (7 devedor = 8 credor, net 0, SEM fonte de recursos como cc):
 *   7.2.2.1.1.01     Controle de desembolso mensal — despesas orç. (D, const 2.870,9mi)
 *   7.2.2.9          Outros controles - programação financeira    (D, const 3.170,2mi = previsão)
 *   8.2.2.1.1.01.01  Desembolso a receber        (C) ┐ migram entre si mês a mês
 *   8.2.2.1.1.01.02  Desembolso recebida         (C) │ (cotas liberadas): a receber ↓, recebida ↑
 *   8.2.2.1.1.02.01  Transferências a receber    (C) ┘
 *   8.2.2.9          Outros controles - execução (C, const −3.170,2mi)
 *
 * Método (fiel à MSC, como o RP execução): para cada mês, o DELTA do saldo de
 * cada folha vira lançamento balanceado (D p/ quem foi debitado, C p/ creditado);
 * o invariante de controle garante Σ D = Σ C por mês. Mês 1 = setup (do zero);
 * meses 2-5 = liberação de cotas. Datado no dia 15 do mês → eb mensal casa.
 *
 * origemTipo=ABERTURA (reuso, como o DDR transporte; a origem é só proveniência,
 * o emissor a ignora), evento '007', origemId 'progfin-2026-MM' (idempotente).
 *
 * Uso: npx tsx scripts/importar_programacao_financeira_msc.ts [--apply]
 */
import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import { LancamentosService, type ItemDado } from '../src/services/lancamentos.js'

const APPLY = process.argv.includes('--apply')
const E = 'b186d24e-5f2a-4378-831f-c0092b626384' // Prefeitura do Município (Maringá)
const ANO = 2026
const PODER = '10131'
const DIR = 'data/abertura-2026/msc_siconfi'
const EVENTO = '007' // programação financeira
const MESES = [1, 2, 3, 4, 5] as const
// 9 díg PCASP → 12 segmentos.
const conta12 = (c: string) => `${c[0]}.${c[1]}.${c[2]}.${c[3]}.${c[4]}.${c.slice(5, 7)}.${c.slice(7, 9)}.00.00.00.00.00`
// as 6 folhas do bloco (código 9 díg + classe)
const FOLHAS = [
  { c9: '722110100', cl: 7 },
  { c9: '722900000', cl: 7 },
  { c9: '822110101', cl: 8 },
  { c9: '822110102', cl: 8 },
  { c9: '822110201', cl: 8 },
  { c9: '822900000', cl: 8 },
]

const prisma = new PrismaClient({ adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })) })
const r2 = (x: number) => Math.round(x * 100) / 100
const fmt = (x: number) => x.toLocaleString('pt-BR', { minimumFractionDigits: 2 })

/** saldo com sinal (D+ C−) da folha `c9` no eb do mês (poder 10131). */
function saldo(mes: number, cl: number, c9: string): number {
  const d = JSON.parse(readFileSync(`${DIR}/mscc_2026-${String(mes).padStart(2, '0')}_eb_classe${cl}.json`, 'utf-8')) as {
    items: { conta_contabil: string; poder_orgao: string; natureza_conta: 'D' | 'C'; valor: number }[]
  }
  let s = 0
  for (const i of d.items) {
    if (i.poder_orgao !== PODER) continue
    if (String(i.conta_contabil) === c9) s += i.valor * (i.natureza_conta === 'D' ? 1 : -1)
  }
  return r2(s)
}

async function main() {
  // resolve as contas (folhas do plano da entidade)
  const codigos = FOLHAS.map((f) => conta12(f.c9))
  const contas = await prisma.contaContabilEntidade.findMany({
    where: { entidadeId: E, ano: ANO, codigo: { in: codigos }, admiteMovimento: true },
    select: { id: true, codigo: true },
  })
  const idPorCodigo = new Map(contas.map((c) => [c.codigo, c.id]))
  for (const f of FOLHAS) if (!idPorCodigo.get(conta12(f.c9))) throw new Error(`folha ${conta12(f.c9)} ausente no plano`)

  // saldo por folha × mês (b[c9][mesIdx]); b0 = 0
  const b: Record<string, number[]> = {}
  for (const f of FOLHAS) b[f.c9] = MESES.map((m) => saldo(m, f.cl, f.c9))

  // por mês: delta de cada folha vira D/C (invariante de controle → Σ balanceia)
  type Mov = { mes: number; origemId: string; historico: string; itens: ItemDado[]; totalD: number }
  const movimentos: Mov[] = []
  for (let i = 0; i < MESES.length; i++) {
    const mes = MESES[i]!
    const itens: ItemDado[] = []
    let totalD = 0
    let totalC = 0
    for (const f of FOLHAS) {
      const delta = r2(b[f.c9]![i]! - (i === 0 ? 0 : b[f.c9]![i - 1]!))
      if (Math.abs(delta) < 0.01) continue
      const contaId = idPorCodigo.get(conta12(f.c9))!
      if (delta > 0) {
        itens.push({ contaId, tipo: 'DEBITO', valor: delta.toFixed(2) })
        totalD = r2(totalD + delta)
      } else {
        itens.push({ contaId, tipo: 'CREDITO', valor: (-delta).toFixed(2) })
        totalC = r2(totalC - delta)
      }
    }
    if (!itens.length) continue
    if (Math.abs(totalD - totalC) >= 0.01) throw new Error(`mês ${mes} não fecha: D=${totalD} C=${totalC}`)
    movimentos.push({
      mes,
      origemId: `progfin-${ANO}-${String(mes).padStart(2, '0')}`,
      historico:
        mes === 1
          ? 'Programação financeira (cronograma de desembolso — Art. 8º LRF) — abertura'
          : `Programação financeira — liberação de cotas (mês ${String(mes).padStart(2, '0')})`,
      itens,
      totalD,
    })
  }

  console.log('Programação financeira (classes 7-8, controle puro, sem fonte):')
  for (const m of movimentos) console.log(`  mês ${m.mes}: ${m.itens.length} itens · D=C=${fmt(m.totalD)}`)
  console.log(`Σ movimentado = ${fmt(movimentos.reduce((s, m) => s + m.totalD, 0))} (mês1 setup 6.041,1mi + liberações mensais)`)

  if (!APPLY) {
    console.log('\nDRY-RUN — nada gravado. --apply p/ contabilizar.')
    await prisma.$disconnect()
    return
  }

  const jaFeitos = new Set(
    (await prisma.lancamento.findMany({ where: { entidadeId: E, origemTipo: 'ABERTURA', eventoCodigo: EVENTO }, select: { origemId: true } })).map((l) => l.origemId),
  )
  const svc = new LancamentosService(prisma)
  let n = 0
  for (const m of movimentos) {
    if (jaFeitos.has(m.origemId)) continue
    await svc.criar({
      entidadeId: E,
      data: `${ANO}-${String(m.mes).padStart(2, '0')}-15`,
      historico: m.historico,
      itens: m.itens,
      criadoPorId: 'BACKFILL_PROGFIN',
      origemTipo: 'ABERTURA',
      origemId: m.origemId,
      eventoCodigo: EVENTO,
    })
    n++
  }
  console.log(`\nAPLICADO: ${n} lançamentos (${movimentos.length - n} já existiam).`)

  // Verificação: eb por folha × mês no razão × oficial
  console.log('\nVerificação — saldo acumulado no razão × oficial (mi):')
  const resumos = await prisma.resumoMensalConta.findMany({
    where: { entidadeId: E, contaId: { in: [...idPorCodigo.values()] }, ano: ANO },
    select: { contaId: true, mes: true, totalDebito: true, totalCredito: true },
  })
  const idParaC9 = new Map([...idPorCodigo].map(([cod, id]) => [id, FOLHAS.find((f) => conta12(f.c9) === cod)!.c9]))
  let okAll = true
  for (const f of FOLHAS) {
    const contaId = idPorCodigo.get(conta12(f.c9))!
    let acc = 0
    const linha: string[] = []
    for (let i = 0; i < MESES.length; i++) {
      const rm = resumos.filter((x) => x.contaId === contaId && x.mes === MESES[i]!)
      for (const x of rm) acc = r2(acc + Number(x.totalDebito) - Number(x.totalCredito))
      const of = b[f.c9]![i]!
      if (Math.abs(acc - of) >= 0.01) okAll = false
      linha.push(`${(acc / 1e6).toFixed(1)}${Math.abs(acc - of) >= 0.01 ? `≠${(of / 1e6).toFixed(1)}` : '✓'}`)
    }
    console.log(`  ${f.c9} (${idParaC9.get(contaId)}): ${linha.join('  ')}`)
  }
  console.log(okAll ? '\n✅ todas as folhas casam o oficial mês a mês.' : '\n⚠️ há divergência — investigar.')
  await prisma.$disconnect()
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
