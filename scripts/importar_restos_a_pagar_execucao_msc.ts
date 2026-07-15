/**
 * Importa a EXECUÇÃO mensal dos Restos a Pagar (2ª fase) da Prefeitura de Maringá
 * a partir da MSC OFICIAL do Siconfi (period_change classe6, meses 1-5). Depende
 * da inscrição (bb) já contabilizada (importar_restos_a_pagar_msc.ts).
 *
 *   1. Reclassificação classe5 de jan: D 5.3.1.1 (inscrito) / C 5.3.1.7 (a inscrever),
 *      por cc — reconstituída (não há pc de classe5; o controle só move na inscrição).
 *   2. Execução mensal (pc classe6): a liquidar→liquidado→pago→cancelado. Cada mês
 *      é auto-balanceado dentro do classe6 (Σ D = Σ C). Provado: bb + Σpc = eb.
 *
 * Uso: npx tsx scripts/importar_restos_a_pagar_execucao_msc.ts [--apply]
 */
import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import { RestosAPagarContabilService, type LinhaRp, type MovimentoRp } from '../src/services/restos-a-pagar-contabil.js'

const APPLY = process.argv.includes('--apply')
const E = 'b186d24e-5f2a-4378-831f-c0092b626384'
const ANO = 2026
const PODER = '10131'
const DIR = 'data/abertura-2026/msc_siconfi'

const prisma = new PrismaClient({ adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })) })
const r2 = (x: number) => Math.round(x * 100) / 100
const fmt = (x: number) => x.toLocaleString('pt-BR', { minimumFractionDigits: 2 })
const conta12 = (c: string) => `${c[0]}.${c[1]}.${c[2]}.${c[3]}.${c[4]}.${c.slice(5, 7)}.${c.slice(7, 9)}.00.00.00.00.00`
const natDesp = (nd: string | null) => (nd ? `${nd[0]}.${nd[1]}.${nd.slice(2, 4)}.${nd.slice(4, 6)}.${nd.slice(6, 8)}` : null)

type Item = { conta_contabil: string; poder_orgao: string; natureza_conta: 'D' | 'C'; valor: number; fonte_recursos: string | null; natureza_despesa: string | null; funcao: string | null; subfuncao: string | null }
const ccDe = (i: Item) => ({ fonte: i.fonte_recursos || null, funcao: i.funcao || null, subfuncao: i.subfuncao || null, naturezaDespesa: natDesp(i.natureza_despesa) })
const chaveCc = (c: ReturnType<typeof ccDe>) => `${c.fonte}|${c.funcao}|${c.subfuncao}|${c.naturezaDespesa}`
const ultimoDia = (mes: number) => new Date(Date.UTC(ANO, mes, 0)).getUTCDate()

/** Agrega itens de um arquivo por (conta, cc), valor com sinal (D +, C −) → linhas RP. */
function agregar(items: Item[], filtro: (c: string) => boolean, remapConta?: (c: string) => string): LinhaRp[] {
  const chave = new Map<string, { conta: string; cc: ReturnType<typeof ccDe>; valor: number }>()
  for (const i of items) {
    if (i.poder_orgao !== PODER || !filtro(i.conta_contabil)) continue
    const conta = conta12(remapConta ? remapConta(i.conta_contabil) : i.conta_contabil)
    const cc = ccDe(i)
    const k = `${conta}|${chaveCc(cc)}`
    const cur = chave.get(k) ?? { conta, cc, valor: 0 }
    cur.valor = r2(cur.valor + i.valor * (i.natureza_conta === 'D' ? 1 : -1))
    chave.set(k, cur)
  }
  const linhas: LinhaRp[] = []
  for (const { conta, cc, valor } of chave.values()) {
    if (Math.abs(valor) < 0.01) continue
    linhas.push({ contaCodigo: conta, tipo: valor > 0 ? 'DEBITO' : 'CREDITO', valor: Math.abs(valor).toFixed(2), ...cc })
  }
  return linhas
}

async function main() {
  const movimentos: MovimentoRp[] = []

  // 1) Reclassificação classe5 jan: a inscrever (5.3.1.7) → inscrito (5.3.1.1).
  //    Reusa a cc do bb do 5.3.1.7; D no 5.3.1.1, C no 5.3.1.7.
  const bb5 = JSON.parse(readFileSync(`${DIR}/mscc_2026-01_bb_classe5.json`, 'utf-8')) as { items: Item[] }
  const aInscrever = bb5.items.filter((i) => i.poder_orgao === PODER && i.conta_contabil === '531700000')
  const reclass: LinhaRp[] = []
  const agReclass = new Map<string, { cc: ReturnType<typeof ccDe>; valor: number }>()
  for (const i of aInscrever) {
    const cc = ccDe(i)
    const k = chaveCc(cc)
    const cur = agReclass.get(k) ?? { cc, valor: 0 }
    cur.valor = r2(cur.valor + i.valor)
    agReclass.set(k, cur)
  }
  for (const { cc, valor } of agReclass.values()) {
    if (valor < 0.01) continue
    reclass.push({ contaCodigo: conta12('531100000'), tipo: 'DEBITO', valor: valor.toFixed(2), ...cc })
    reclass.push({ contaCodigo: conta12('531700000'), tipo: 'CREDITO', valor: valor.toFixed(2), ...cc })
  }
  movimentos.push({ data: `${ANO}-01-31`, historico: 'RP — inscrição (a inscrever → inscrito)', origemId: 'rp-reclass-2026-01', eventoCodigo: '005', linhas: reclass })

  // 2) Execução mensal (pc classe6, 6.3.1.x).
  for (let mes = 1; mes <= 5; mes++) {
    const pc = JSON.parse(readFileSync(`${DIR}/mscc_2026-0${mes}_pc_classe6.json`, 'utf-8')) as { items: Item[] }
    const linhas = agregar(pc.items, (c) => c.startsWith('631'))
    const dia = String(ultimoDia(mes)).padStart(2, '0')
    movimentos.push({ data: `${ANO}-0${mes}-${dia}`, historico: `RP — execução ${String(mes).padStart(2, '0')}/${ANO}`, origemId: `rp-exec-2026-0${mes}`, eventoCodigo: '005', linhas })
  }

  // resumo + checagem de fechamento por movimento
  for (const m of movimentos) {
    const d = r2(m.linhas.filter((l) => l.tipo === 'DEBITO').reduce((s, l) => s + Number(l.valor), 0))
    const c = r2(m.linhas.filter((l) => l.tipo === 'CREDITO').reduce((s, l) => s + Number(l.valor), 0))
    console.log(`  ${m.origemId}: ${m.linhas.length} linhas · D=${fmt(d)} C=${fmt(c)} ${Math.abs(d - c) < 0.01 ? 'OK' : '✗ NÃO FECHA'}`)
  }

  if (!APPLY) {
    console.log('\nDRY-RUN — nada gravado. --apply p/ contabilizar a execução do RP.')
    await prisma.$disconnect()
    return
  }
  const resumo = await new RestosAPagarContabilService(prisma).contabilizar(E, ANO, movimentos, 'BACKFILL_RP')
  console.log(`\nAPLICADO: ${resumo.lancamentos} lançamento(s), ${resumo.itens} itens, D=${resumo.totalDebito} C=${resumo.totalCredito}.`)
  await prisma.$disconnect()
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
