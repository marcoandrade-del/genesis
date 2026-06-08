/**
 * Backfill dos atributos PCASP (naturezaInformacao, naturezaSaldo,
 * superavitFinanceiro, funcao) nas contas contábeis JÁ importadas.
 *
 * Lê o CSV enriquecido gerado por scripts/xlsx_tcepr_para_csv.py (8 colunas) e
 * atualiza, por `codigo`, toda conta cujo código bata — os atributos PCASP são
 * intrínsecos ao código, então valem para qualquer plano contábil que os use.
 * Idempotente: reaplica os mesmos valores.
 *
 * Rodar: npx tsx scripts/backfill_pcasp_atributos_2026.ts [caminho.csv]
 * (default: data/pcasp_estendido_2026.csv)
 */

import { readFileSync } from 'node:fs'
import 'dotenv/config'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import {
  parseCSV,
  mapearNaturezaInformacao,
  mapearNaturezaSaldo,
  mapearSuperavitFinanceiro,
} from '../src/services/importador-plano-contas.js'

const pool = new Pool({ connectionString: process.env['DATABASE_URL'] })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

const arquivo = process.argv[2] ?? 'data/pcasp_estendido_2026.csv'
console.log(`[1/3] Lendo ${arquivo} ...`)
const linhas = parseCSV(readFileSync(arquivo, 'utf-8'))

// código → atributos mapeados (descarta linhas sem nenhum atributo).
const porCodigo = new Map(
  linhas.map((l) => [
    l.codigo,
    {
      naturezaInformacao: mapearNaturezaInformacao(l.naturezaInformacao),
      naturezaSaldo: mapearNaturezaSaldo(l.naturezaSaldo),
      superavitFinanceiro: mapearSuperavitFinanceiro(l.superavitFinanceiro),
      funcao: (l.funcao ?? '').trim() || null,
    },
  ]),
)
console.log(`      ${porCodigo.size} códigos com atributos`)

console.log(`[2/3] Casando com as contas do banco ...`)
const contas = await prisma.conta.findMany({ select: { id: true, codigo: true } })
const alvos = contas.filter((c) => porCodigo.has(c.codigo))
console.log(`      ${contas.length} contas no banco; ${alvos.length} com correspondência`)

console.log(`[3/3] Atualizando (lotes de 200) ...`)
const t0 = Date.now()
let feitas = 0
for (let i = 0; i < alvos.length; i += 200) {
  const lote = alvos.slice(i, i + 200)
  await Promise.all(
    lote.map((c) => prisma.conta.update({ where: { id: c.id }, data: porCodigo.get(c.codigo)! })),
  )
  feitas += lote.length
  process.stdout.write(`\r      ${feitas}/${alvos.length}`)
}
console.log(`\n      pronto em ${Date.now() - t0} ms`)

const semInfo = await prisma.conta.count({ where: { naturezaInformacao: null } })
console.log(`      contas sem naturezaInformacao restantes: ${semInfo}`)

await prisma.$disconnect()
await pool.end()
