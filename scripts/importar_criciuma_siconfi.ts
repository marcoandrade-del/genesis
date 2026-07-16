/**
 * Importa Criciúma/SC 100% do SICONFI (baseline nacional): onboarda o município +
 * as 3 entidades (por poder_orgao), grava previsão+arrecadação da receita e a
 * dotação+execução (empenho/liq/pago) da despesa — tudo da MSC do Tesouro, sem
 * raspar ERP. Ver [[msc-siconfi-fonte-oficial]] e `municipios/criciuma-sc.ts`.
 *
 * Pré-requisito: o estado SC deve ter `modeloContabilId` (o mesmo do MS/Naviraí).
 * Dry-run por padrão (não escreve). Grava: --apply.
 * Rodar: npx tsx scripts/importar_criciuma_siconfi.ts [--apply]
 */
import 'dotenv/config'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import { importarMunicipio } from '../src/conversor/importar.js'
import { criciumaSc } from '../src/conversor/municipios/criciuma-sc.js'

const APPLY = process.argv.includes('--apply')
const pool = new Pool({ connectionString: process.env['DATABASE_URL'] })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

if (!APPLY) {
  console.log('DRY-RUN: passe --apply para escrever no banco. (a prova a seco já rodou via os leitores)')
  process.exit(0)
}

await importarMunicipio(prisma, criciumaSc, (m) => console.log(m))
await pool.end()
console.log('\n✅ import concluído')
