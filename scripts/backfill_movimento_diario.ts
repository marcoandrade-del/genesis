import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'

/**
 * Backfill do agregado diário `MovimentoDiarioConta` a partir dos `LancamentoItem`
 * já existentes. Idempotente: reconstrói (ON CONFLICT) a partir da soma por
 * (entidade × conta × dia). Rode uma vez após aplicar a migração no banco.
 */
async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

  const n = await prisma.$executeRawUnsafe(`
    INSERT INTO movimentos_diarios_conta ("entidadeId", "contaId", "data", "totalDebito", "totalCredito")
    SELECT l."entidadeId", li."contaId", l."data",
           COALESCE(SUM(li.valor) FILTER (WHERE li.tipo = 'DEBITO'), 0),
           COALESCE(SUM(li.valor) FILTER (WHERE li.tipo = 'CREDITO'), 0)
    FROM lancamento_itens li
    JOIN lancamentos l ON l.id = li."lancamentoId"
    GROUP BY l."entidadeId", li."contaId", l."data"
    ON CONFLICT ("entidadeId", "contaId", "data")
    DO UPDATE SET "totalDebito" = EXCLUDED."totalDebito", "totalCredito" = EXCLUDED."totalCredito"
  `)
  console.log(`MovimentoDiarioConta backfill: ${n} linha(s) (conta×dia).`)
  await pool.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
