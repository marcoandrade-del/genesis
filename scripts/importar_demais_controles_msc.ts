/**
 * Importa os DEMAIS CONTROLES (7.9.9 / 8.9.9) da Prefeitura de Maringá 2026 a
 * partir da MSC OFICIAL do Siconfi. É um par de controle PURO e CONSTANTE
 * (bb = eb todos os meses, SEM fonte cc):
 *
 *   D 7.9.9.0 (demais controles)  =  C 8.9.9.0  =  1.053.123.342,36
 *
 * Como é constante o ano todo, entra como ABERTURA (1 lançamento, Jan/01),
 * evento '008'. Idempotente. Sem fonte → o de/para PR↔STN não se aplica.
 *
 * Uso: npx tsx scripts/importar_demais_controles_msc.ts [--apply]
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
const EVENTO = '008' // demais controles
const conta12 = (c: string) => `${c[0]}.${c[1]}.${c[2]}.${c[3]}.${c[4]}.${c.slice(5, 7)}.${c.slice(7, 9)}.00.00.00.00.00`
const FOLHAS = [
  { c9: '799000000', cl: 7 },
  { c9: '899000000', cl: 8 },
]

const prisma = new PrismaClient({ adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })) })
const r2 = (x: number) => Math.round(x * 100) / 100
const fmt = (x: number) => x.toLocaleString('pt-BR', { minimumFractionDigits: 2 })

/** saldo com sinal (D+ C−) da folha `c9` no bb (poder 10131). */
function saldoBb(cl: number, c9: string): number {
  const d = JSON.parse(readFileSync(`${DIR}/mscc_2026-01_bb_classe${cl}.json`, 'utf-8')) as {
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
  const codigos = FOLHAS.map((f) => conta12(f.c9))
  const contas = await prisma.contaContabilEntidade.findMany({
    where: { entidadeId: E, ano: ANO, codigo: { in: codigos }, admiteMovimento: true },
    select: { id: true, codigo: true },
  })
  const idPorCodigo = new Map(contas.map((c) => [c.codigo, c.id]))

  const itens: ItemDado[] = []
  let totalD = 0
  let totalC = 0
  for (const f of FOLHAS) {
    const contaId = idPorCodigo.get(conta12(f.c9))
    if (!contaId) throw new Error(`folha ${conta12(f.c9)} ausente no plano`)
    const saldo = saldoBb(f.cl, f.c9)
    if (Math.abs(saldo) < 0.01) continue
    if (saldo > 0) {
      itens.push({ contaId, tipo: 'DEBITO', valor: saldo.toFixed(2) })
      totalD = r2(totalD + saldo)
    } else {
      itens.push({ contaId, tipo: 'CREDITO', valor: (-saldo).toFixed(2) })
      totalC = r2(totalC - saldo)
    }
  }

  console.log(`demais controles (7.9.9/8.9.9): ${itens.length} itens · D=${fmt(totalD)} · C=${fmt(totalC)} (fecha: ${Math.abs(totalD - totalC) < 0.01})`)
  if (Math.abs(totalD - totalC) >= 0.01) throw new Error('não fecha')

  if (!APPLY) {
    console.log('\nDRY-RUN — nada gravado. --apply p/ contabilizar.')
    await prisma.$disconnect()
    return
  }

  const existe = await prisma.lancamento.findFirst({ where: { entidadeId: E, origemTipo: 'ABERTURA', eventoCodigo: EVENTO } })
  if (existe) {
    console.log('demais controles já contabilizados — nada a fazer.')
    await prisma.$disconnect()
    return
  }
  await new LancamentosService(prisma).criar({
    entidadeId: E,
    data: `${ANO}-01-01`,
    historico: 'Abertura do exercício — demais controles (7.9.9/8.9.9)',
    itens,
    criadoPorId: 'BACKFILL_CONTROLE',
    origemTipo: 'ABERTURA',
    origemId: `demais-controles-${ANO}`,
    eventoCodigo: EVENTO,
  })
  console.log(`\nAPLICADO: 1 lançamento, ${itens.length} itens, D=C=${fmt(totalD)}.`)
  await prisma.$disconnect()
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
