/**
 * Popula FonteRecursoEntidade.fonteStnCodigo (de/para local→STN) a partir do
 * artefato `data/abertura-2026/depara_fontes_local_stn.json` — para o emissor da
 * MSC converter a fonte local do razão para o padrão STN/Siconfi na saída.
 *
 * COBERTURA: o de/para atual é de RECEITA (72 fontes da LOA). As fontes de
 * DESPESA/desdobramentos fora dele ficam sem STN (o emissor as mantém locais =
 * passa direto). A extensão do de/para p/ a despesa é frente separada (value-
 * matching contra a MSC oficial, como a cauda da receita).
 *
 * Uso: npx tsx scripts/popular_fonte_stn_entidade.ts [--apply]
 */
import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'

const APPLY = process.argv.includes('--apply')
const E = 'b186d24e-5f2a-4378-831f-c0092b626384' // Prefeitura do Município (Maringá)
const ANO = 2026
const DEPARA = 'data/abertura-2026/depara_fontes_local_stn.json'

const prisma = new PrismaClient({ adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })) })

async function main() {
  const depara = (JSON.parse(readFileSync(DEPARA, 'utf-8')).depara ?? {}) as Record<string, string>
  const fontes = await prisma.fonteRecursoEntidade.findMany({
    where: { entidadeId: E, ano: ANO },
    select: { id: true, codigo: true, fonteStnCodigo: true },
  })
  const aplicar = fontes
    .map((f) => ({ ...f, stn: depara[f.codigo] ?? null }))
    .filter((f) => f.stn && f.stn !== f.fonteStnCodigo)

  const semDepara = fontes.filter((f) => !depara[f.codigo]).length
  console.log(`fontes da entidade: ${fontes.length} · no de/para: ${fontes.length - semDepara} · sem de/para (ficam locais): ${semDepara}`)
  console.log(`a gravar/atualizar fonteStnCodigo: ${aplicar.length}`)
  for (const f of aplicar.slice(0, 8)) console.log(`  ${f.codigo} → ${f.stn}`)
  if (aplicar.length > 8) console.log(`  … +${aplicar.length - 8}`)

  if (!APPLY) {
    console.log('\nDRY-RUN — nada gravado. --apply p/ popular.')
    await prisma.$disconnect()
    return
  }
  for (const f of aplicar) await prisma.fonteRecursoEntidade.update({ where: { id: f.id }, data: { fonteStnCodigo: f.stn } })
  console.log(`\nAPLICADO: ${aplicar.length} fontes com fonteStnCodigo.`)
  await prisma.$disconnect()
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
