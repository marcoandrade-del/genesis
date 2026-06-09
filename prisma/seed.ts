/**
 * Seed do banco. Atualmente popula apenas os 27 UFs do Brasil — idempotente.
 *
 * Uso:
 *   npx tsx prisma/seed.ts
 *
 * Adicionar `prisma.seed` em package.json para `prisma db seed` rodar isso.
 */
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import 'dotenv/config'
import { semearEstados } from '../src/services/estados.js'
import { semearMenusApp } from '../src/services/seed-menu-app.js'

async function main() {
  const url = process.env['DATABASE_URL']
  if (!url) throw new Error('DATABASE_URL não definida.')

  const adapter = new PrismaPg({ connectionString: url })
  const prisma = new PrismaClient({ adapter })

  try {
    const inseridos = await semearEstados(prisma)
    console.log(`[seed] estados: ${inseridos} novo(s) inserido(s); existentes preservados.`)

    const menu = await semearMenusApp(prisma)
    console.log(`[seed] menu /app: sistema=${menu.sistemaId} itens novos=${menu.itens} grants novos=${menu.grants}.`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((e) => {
  console.error('[seed] erro:', e)
  process.exit(1)
})
