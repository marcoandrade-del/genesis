/**
 * Importa o TRANSPORTE INICIAL da DDR (Disponibilidade de Recursos, classes 7-8)
 * da Prefeitura de Maringá 2026, a partir do beginning_balance da MSC OFICIAL do
 * Siconfi (dev é greenfield em 2025). Reproduz FIELMENTE o bb da DDR:
 *
 *   classe 7 (controle DEVEDOR)  → DEBITO   ·  classe 8 (destinação CREDORA) → CREDITO
 *   D 7.2.1.1.x  =  C 8.2.1.1.x   (por FONTE; Σ 847.843.071,52)
 *
 * cc = fonte de recursos (STN, como no oficial). É a abertura da DDR — parte das
 * classes 7-8 (a programação financeira 7.2.2 e a DDR de execução são fases à parte).
 *
 * Uso: npx tsx scripts/importar_ddr_transporte_msc.ts [--apply]
 */
import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient, Prisma } from '@prisma/client'
import { LancamentosService, type ItemDado } from '../src/services/lancamentos.js'

const APPLY = process.argv.includes('--apply')
const E = 'b186d24e-5f2a-4378-831f-c0092b626384' // Prefeitura do Município (Maringá)
const ANO = 2026
const PODER = '10131'
const DIR = 'data/abertura-2026/msc_siconfi'
const EVENTO = '006' // DDR transporte (abertura)

const prisma = new PrismaClient({ adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })) })
const r2 = (x: number) => Math.round(x * 100) / 100
const fmt = (x: number) => x.toLocaleString('pt-BR', { minimumFractionDigits: 2 })
// 9 díg PCASP → 12 segmentos (5 simples + 2×2 + 5×"00").
const conta12 = (c: string) => `${c[0]}.${c[1]}.${c[2]}.${c[3]}.${c[4]}.${c.slice(5, 7)}.${c.slice(7, 9)}.00.00.00.00.00`

type Item = { conta_contabil: string; poder_orgao: string; natureza_conta: 'D' | 'C'; valor: number; fonte_recursos: string | null }

async function main() {
  // agrega bb classe7+8 da DDR (7.2.1.1 / 8.2.1.1) por (conta, fonte), valor com sinal (D +, C −)
  const chave = new Map<string, { conta: string; fonte: string | null; valor: number }>()
  for (const cl of [7, 8]) {
    const d = JSON.parse(readFileSync(`${DIR}/mscc_2026-01_bb_classe${cl}.json`, 'utf-8')) as { items: Item[] }
    for (const i of d.items) {
      if (i.poder_orgao !== PODER) continue
      const c = i.conta_contabil
      if (!c.startsWith('7211') && !c.startsWith('8211')) continue
      const conta = conta12(c)
      const fonte = i.fonte_recursos || null
      const k = `${conta}|${fonte}`
      const cur = chave.get(k) ?? { conta, fonte, valor: 0 }
      cur.valor = r2(cur.valor + i.valor * (i.natureza_conta === 'D' ? 1 : -1))
      chave.set(k, cur)
    }
  }

  // resolve as contas (folhas do plano da entidade)
  const codigos = [...new Set([...chave.values()].map((v) => v.conta))]
  const contas = await prisma.contaContabilEntidade.findMany({
    where: { entidadeId: E, ano: ANO, codigo: { in: codigos }, admiteMovimento: true },
    select: { id: true, codigo: true },
  })
  const idPorCodigo = new Map(contas.map((c) => [c.codigo, c.id]))

  const itens: ItemDado[] = []
  let totalD = 0
  let totalC = 0
  const porConta = new Map<string, number>()
  for (const { conta, fonte, valor } of chave.values()) {
    if (Math.abs(valor) < 0.01) continue
    const contaId = idPorCodigo.get(conta)
    if (!contaId) throw new Error(`conta de DDR "${conta}" não é folha no plano da entidade`)
    const tipo = valor > 0 ? 'DEBITO' : 'CREDITO'
    if (tipo === 'DEBITO') totalD = r2(totalD + valor)
    else totalC = r2(totalC - valor)
    itens.push({ contaId, tipo, valor: Math.abs(valor).toFixed(2), fonteCodigo: fonte })
    porConta.set(conta, r2((porConta.get(conta) ?? 0) + valor))
  }

  console.log(`itens: ${itens.length} · D=${fmt(totalD)} · C=${fmt(totalC)} (fecha: ${Math.abs(totalD - totalC) < 0.01})`)
  for (const [c, v] of [...porConta].sort()) console.log(`  ${c}  ${fmt(v)}`)

  if (!APPLY) {
    console.log('\nDRY-RUN — nada gravado. --apply p/ contabilizar o transporte da DDR.')
    await prisma.$disconnect()
    return
  }

  const orcamento = await prisma.orcamento.findUnique({ where: { entidadeId_ano: { entidadeId: E, ano: ANO } }, select: { id: true } })
  if (!orcamento) throw new Error('orçamento não encontrado')
  // idempotência: pula se já contabilizado
  const existe = await prisma.lancamento.findFirst({ where: { entidadeId: E, origemTipo: 'ABERTURA', origemId: orcamento.id, eventoCodigo: EVENTO } })
  if (existe) {
    console.log('DDR transporte já contabilizado — nada a fazer.')
    await prisma.$disconnect()
    return
  }
  await new LancamentosService(prisma).criar({
    entidadeId: E,
    data: `${ANO}-01-01`,
    historico: 'Abertura do exercício — transporte da DDR (disponibilidade de recursos)',
    itens,
    criadoPorId: 'BACKFILL_DDR',
    origemTipo: 'ABERTURA',
    origemId: orcamento.id,
    eventoCodigo: EVENTO,
  })
  console.log(`\nAPLICADO: 1 lançamento, ${itens.length} itens, D=C=${fmt(totalD)}.`)
  await prisma.$disconnect()
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
