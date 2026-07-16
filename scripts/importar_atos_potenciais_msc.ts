/**
 * Importa os ATOS POTENCIAIS e afins (classes 7.1/7.4 devedor × 8.1/8.4 credor)
 * da Prefeitura de Maringá 2026 a partir da MSC OFICIAL do Siconfi. São controles
 * PUROS, self-balanceados por mês (Σ7 = −Σ8, Δ0 em bb e eb1-5), SEM fonte cc:
 *
 *   Direitos conveniados / Termo de Cooperação / Convênios a receber
 *   Contratos de serviços / Obrigações contratuais / Contraprestações futuras
 *   Contratos de PPP (cronograma EC+0..+9) / Passivos contingentes
 *
 * Método idêntico ao da programação financeira (RP-execução style): descobre as
 * folhas 71/74/81/84 na MSC (poder 10131), e para cada mês o DELTA do saldo de
 * cada folha vira um lançamento balanceado. Mês 1 = setup (inclui o bb carregado
 * de 2025, pois o dev é greenfield); meses 2-5 = movimentos. Datado no mês 15.
 * origemTipo=ABERTURA evento '009', idempotente por origemId 'atos-2026-MM'.
 *
 * Uso: npx tsx scripts/importar_atos_potenciais_msc.ts [--apply]
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
const EVENTO = '009' // atos potenciais / convênios / contratos / PPP / contingências
const MESES = [1, 2, 3, 4, 5] as const
const PREFIXOS = ['71', '74', '81', '84'] // 7.1/7.4 devedor, 8.1/8.4 credor
const conta12 = (c: string) => `${c[0]}.${c[1]}.${c[2]}.${c[3]}.${c[4]}.${c.slice(5, 7)}.${c.slice(7, 9)}.00.00.00.00.00`

const prisma = new PrismaClient({ adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })) })
const r2 = (x: number) => Math.round(x * 100) / 100
const fmt = (x: number) => x.toLocaleString('pt-BR', { minimumFractionDigits: 2 })

type Item = { conta_contabil: string; poder_orgao: string; natureza_conta: 'D' | 'C'; valor: number; fonte_recursos?: string | null }
function itensDoMes(mes: number, cl: number): Item[] {
  return (JSON.parse(readFileSync(`${DIR}/mscc_2026-${String(mes).padStart(2, '0')}_eb_classe${cl}.json`, 'utf-8')) as { items: Item[] }).items
}

async function main() {
  // 1) descobre as folhas (código 9 díg + classe) e o saldo por mês (b[c9][mesIdx])
  const classePorC9 = new Map<string, number>()
  const b: Record<string, number[]> = {}
  let temFonte = false
  for (const cl of [7, 8]) {
    for (let i = 0; i < MESES.length; i++) {
      for (const it of itensDoMes(MESES[i]!, cl)) {
        if (it.poder_orgao !== PODER) continue
        const c = String(it.conta_contabil)
        if (!PREFIXOS.includes(c.slice(0, 2)) || Math.floor(cl) !== Number(c[0])) continue
        if (it.fonte_recursos) temFonte = true
        classePorC9.set(c, cl)
        if (!b[c]) b[c] = MESES.map(() => 0)
        b[c]![i] = r2(b[c]![i]! + it.valor * (it.natureza_conta === 'D' ? 1 : -1))
      }
    }
  }
  const folhas = [...classePorC9.keys()].sort()
  console.log(`folhas descobertas (71/74/81/84, poder ${PODER}): ${folhas.length} · usa fonte cc: ${temFonte ? 'SIM ⚠️' : 'NÃO'}`)

  // 2) resolve contas do plano
  const codigos = folhas.map(conta12)
  const contas = await prisma.contaContabilEntidade.findMany({
    where: { entidadeId: E, ano: ANO, codigo: { in: codigos }, admiteMovimento: true },
    select: { id: true, codigo: true },
  })
  const idPorCodigo = new Map(contas.map((c) => [c.codigo, c.id]))
  for (const c9 of folhas) if (!idPorCodigo.get(conta12(c9))) throw new Error(`folha ${conta12(c9)} ausente no plano`)

  // 3) por mês: delta de cada folha → D/C (invariante de controle → Σ balanceia)
  type Mov = { mes: number; origemId: string; itens: ItemDado[]; totalD: number }
  const movimentos: Mov[] = []
  for (let i = 0; i < MESES.length; i++) {
    const mes = MESES[i]!
    const itens: ItemDado[] = []
    let totalD = 0
    let totalC = 0
    for (const c9 of folhas) {
      const delta = r2(b[c9]![i]! - (i === 0 ? 0 : b[c9]![i - 1]!))
      if (Math.abs(delta) < 0.01) continue
      const contaId = idPorCodigo.get(conta12(c9))!
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
    movimentos.push({ mes, origemId: `atos-${ANO}-${String(mes).padStart(2, '0')}`, itens, totalD })
  }

  console.log('Atos potenciais (7.1/7.4 × 8.1/8.4, controle puro, sem fonte):')
  for (const m of movimentos) console.log(`  mês ${m.mes}: ${m.itens.length} itens · D=C=${fmt(m.totalD)}`)

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
      historico:
        m.mes === 1
          ? 'Abertura do exercício — atos potenciais (convênios/contratos/PPP/contingências)'
          : `Atos potenciais — execução (mês ${String(m.mes).padStart(2, '0')})`,
      itens: m.itens,
      criadoPorId: 'BACKFILL_ATOS',
      origemTipo: 'ABERTURA',
      origemId: m.origemId,
      eventoCodigo: EVENTO,
    })
    n++
  }
  console.log(`\nAPLICADO: ${n} lançamentos (${movimentos.length - n} já existiam).`)

  // 4) verificação: eb por folha × mês no razão × oficial
  const resumos = await prisma.resumoMensalConta.findMany({
    where: { entidadeId: E, contaId: { in: [...idPorCodigo.values()] }, ano: ANO },
    select: { contaId: true, mes: true, totalDebito: true, totalCredito: true },
  })
  let okAll = true
  let divergentes = 0
  for (const c9 of folhas) {
    const contaId = idPorCodigo.get(conta12(c9))!
    let acc = 0
    for (let i = 0; i < MESES.length; i++) {
      for (const x of resumos.filter((r) => r.contaId === contaId && r.mes === MESES[i]!)) acc = r2(acc + Number(x.totalDebito) - Number(x.totalCredito))
      if (Math.abs(acc - b[c9]![i]!) >= 0.01) {
        okAll = false
        divergentes++
      }
    }
  }
  console.log(okAll ? '\n✅ todas as folhas casam o oficial mês a mês.' : `\n⚠️ ${divergentes} divergências folha×mês — investigar.`)
  await prisma.$disconnect()
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
