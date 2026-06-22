/**
 * Backfill dos Órgãos a partir das Unidades Orçamentárias existentes (Fase 3a da
 * realização da despesa). A classificação institucional é Órgão → Unidade; o
 * modelo só tinha a Unidade. Aqui derivamos o Órgão do PREFIXO do código da
 * unidade (1º segmento, ex.: unidade "02.001" → órgão "02"; "01.19.00" → "01"),
 * criamos um Órgão por prefixo (por entidade) e vinculamos as unidades.
 *
 * Nome do órgão = "Órgão <código>" (placeholder — renomear no cadastro depois).
 * Idempotente: upsert por (entidade, código); só preenche orgaoId ainda nulo.
 *
 * Rodar:
 *   npx tsx scripts/backfill_orgaos.ts            # dry-run
 *   npx tsx scripts/backfill_orgaos.ts --apply    # grava
 */

import 'dotenv/config'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'

const APPLY = process.argv.includes('--apply')
const pool = new Pool({ connectionString: process.env['DATABASE_URL'] })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

console.log(`Backfill órgãos — modo: ${APPLY ? 'APPLY (vai gravar)' : 'DRY-RUN (não grava)'}\n`)

const unidades = await prisma.unidadeOrcamentaria.findMany({ select: { id: true, entidadeId: true, codigo: true, orgaoId: true } })
const semOrgao = unidades.filter((u) => !u.orgaoId)
console.log(`Unidades: ${unidades.length} (sem órgão: ${semOrgao.length})`)

// Agrupa por (entidade, prefixo do código)
const prefixo = (codigo: string) => codigo.split('.')[0]!.trim() || codigo.trim()
const grupos = new Map<string, { entidadeId: string; codigo: string; unidadeIds: string[] }>()
for (const u of semOrgao) {
  const cod = prefixo(u.codigo)
  const chave = `${u.entidadeId}|${cod}`
  const g = grupos.get(chave) ?? { entidadeId: u.entidadeId, codigo: cod, unidadeIds: [] }
  g.unidadeIds.push(u.id)
  grupos.set(chave, g)
}
console.log(`Órgãos a garantir: ${grupos.size}`)
for (const g of grupos.values()) console.log(`  ${g.codigo} ← ${g.unidadeIds.length} unidade(s)`)

if (!APPLY) {
  console.log('\nDRY-RUN — nada gravado. Rode com --apply.')
  await pool.end()
  process.exit(0)
}

let orgaosCriados = 0
let unidadesVinculadas = 0
for (const g of grupos.values()) {
  const orgao = await prisma.orgao.upsert({
    where: { entidadeId_codigo: { entidadeId: g.entidadeId, codigo: g.codigo } },
    update: {},
    create: { entidadeId: g.entidadeId, codigo: g.codigo, nome: `Órgão ${g.codigo}` },
  })
  if (orgao.criadoEm.getTime() === orgao.atualizadoEm.getTime()) orgaosCriados++
  const r = await prisma.unidadeOrcamentaria.updateMany({ where: { id: { in: g.unidadeIds } }, data: { orgaoId: orgao.id } })
  unidadesVinculadas += r.count
}
console.log(`\nAPPLY — órgãos criados: ${orgaosCriados}, unidades vinculadas: ${unidadesVinculadas}.`)
await pool.end()
