/**
 * Importa/atualiza "Paranaguá (SICONFI)" 100% do SICONFI (baseline nacional):
 * 3 entidades por poder_orgao, receita (previsão+arrecadação, com Arrecadacao) +
 * despesa (dotação+execução por modalidade) da MSC do Tesouro ao ÚLTIMO mês
 * homologado + RAZÃO contábil (abertura + replay — pós-#286 o pipeline faz tudo).
 * Espelha `importar_criciuma_siconfi.ts`. Ver `municipios/paranagua-pr-siconfi.ts`.
 *
 * Convive com o município IPM "Paranaguá" (nomes distintos; não se tocam).
 * Dry-run por padrão. Grava: --apply.
 *   npx tsx scripts/importar_paranagua_siconfi.ts [--apply]
 */
import 'dotenv/config'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import { importarMunicipio } from '../src/conversor/importar.js'
import { paranaguaSiconfi } from '../src/conversor/municipios/paranagua-pr-siconfi.js'

const APPLY = process.argv.includes('--apply')
const pool = new Pool({ connectionString: process.env['DATABASE_URL'] })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

if (!APPLY) {
  console.log('DRY-RUN: passe --apply para escrever no banco (o pipeline atualiza dados + materializa o razão).')
  process.exit(0)
}

await importarMunicipio(prisma, paranaguaSiconfi, (m) => console.log(m))
await prisma.$disconnect()
await pool.end()
console.log('\n✅ import concluído')
