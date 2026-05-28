/**
 * Smoke test: importa o PCASP Estendido completo no banco real e
 * verifica contagens. Cria um ModeloContabil + PlanoDeContas
 * efêmeros e os deleta no final (mesmo em caso de falha).
 *
 * Rodar com: npx tsx scripts/smoke_importar_pcasp.ts [caminho.csv]
 * (default: data/pcasp_estendido_2024.csv)
 */

import { readFileSync } from 'node:fs'
import 'dotenv/config'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import { ImportadorPlanoContasService } from '../src/services/importador-plano-contas.js'

const pool = new Pool({ connectionString: process.env['DATABASE_URL'] })
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter })
const SUFFIX = `smoke-${Date.now()}`
const importador = new ImportadorPlanoContasService(prisma)

async function main() {
  const arquivo = process.argv[2] ?? 'data/pcasp_estendido_2024.csv'
  console.log(`[1/5] Lendo ${arquivo} ...`)
  const csv = readFileSync(arquivo, 'utf-8')
  console.log(`      ${csv.length.toLocaleString()} bytes`)

  console.log(`[2/5] Criando ModeloContabil + PlanoDeContas (${SUFFIX}) ...`)
  const modelo = await prisma.modeloContabil.create({
    data: { descricao: `PCASP ${SUFFIX}` },
  })
  const plano = await prisma.planoDeContas.create({
    data: { descricao: `Plano ${SUFFIX}`, ano: 2024, modeloContabilId: modelo.id },
  })
  console.log(`      modelo=${modelo.id} plano=${plano.id}`)

  console.log(`[3/5] Importando ...`)
  const t0 = Date.now()
  const { criadas } = await importador.importar(plano.id, csv)
  const ms = Date.now() - t0
  console.log(`      ${criadas.toLocaleString()} contas em ${ms} ms (${Math.round(criadas / (ms / 1000)).toLocaleString()}/s)`)

  console.log(`[4/5] Conferindo no banco ...`)
  const total = await prisma.conta.count({ where: { planoId: plano.id } })
  const folhas = await prisma.conta.count({ where: { planoId: plano.id, admiteMovimento: true } })
  const porNivel = await prisma.conta.groupBy({
    by: ['nivel'],
    where: { planoId: plano.id },
    _count: { _all: true },
    orderBy: { nivel: 'asc' },
  })
  console.log(`      total: ${total}`)
  console.log(`      folhas (admiteMovimento=true): ${folhas}`)
  for (const g of porNivel) console.log(`      nível ${g.nivel}: ${g._count._all}`)

  // Sanity: pega 3 amostras e mostra
  const amostras = await prisma.conta.findMany({
    where: { planoId: plano.id, codigo: { in: ['1.0.0.0.0.00.00', '1.1.1.1.1.01.00', '8.9.9.0.0.00.00'] } },
    select: { codigo: true, descricao: true, nivel: true, admiteMovimento: true },
    orderBy: { codigo: 'asc' },
  })
  console.log(`      amostras:`)
  for (const c of amostras) {
    console.log(`        ${c.codigo}  nivel=${c.nivel}  mov=${c.admiteMovimento}  ${c.descricao}`)
  }
}

async function cleanup() {
  console.log(`[5/5] Limpando ...`)
  const modelos = await prisma.modeloContabil.findMany({
    where: { descricao: `PCASP ${SUFFIX}` },
    select: { id: true, planos: { select: { id: true } } },
  })
  for (const m of modelos) {
    for (const p of m.planos) {
      await prisma.conta.deleteMany({ where: { planoId: p.id } })
      await prisma.planoDeContas.delete({ where: { id: p.id } })
    }
    await prisma.modeloContabil.delete({ where: { id: m.id } })
  }
  console.log(`      ok`)
}

let ok = true
try {
  await main()
} catch (e) {
  ok = false
  console.error('FALHOU:', e)
} finally {
  try {
    await cleanup()
  } catch (e) {
    console.error('Cleanup falhou:', e)
  }
  await prisma.$disconnect()
  await pool.end()
}
process.exit(ok ? 0 : 1)
