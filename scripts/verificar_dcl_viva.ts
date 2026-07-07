import 'dotenv/config'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import { DclService } from '../src/services/dcl.js'

async function main() {
  const pool = new Pool({ connectionString: process.env['DATABASE_URL'] })
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })
  const e = await prisma.entidade.findFirst({ where: { nome: { contains: 'Prefeitura' }, municipio: { nome: 'Maringá' } }, select: { id: true } })
  const r = await new DclService(prisma).calcular(e!.id, 2026)
  const f = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 2 })
  console.log(`DC (cadastro):        ${f(r.dividaTotal)}`)
  console.log(`  caixa bruta:        ${f(r.deducoes.caixa)}`)
  console.log(`  (−) RP processados: ${f(r.deducoes.rpProcessados)}`)
  console.log(`Deduções:             ${f(r.deducoes.total)}`)
  console.log(`DCL VIVA:             ${f(r.dcl)}`)
  console.log(`Gabarito RGF 1ºQ/26:  -539.616.064,25 (consolidado, 30/04)`)
  console.log(`Δ:                    ${f(r.dcl - -539616064.25)}`)
  await prisma.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
