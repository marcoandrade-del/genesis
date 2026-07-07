import 'dotenv/config'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import { ConsistenciaService } from '../src/services/consistencia.js'

async function main() {
  const pool = new Pool({ connectionString: process.env['DATABASE_URL'] })
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })
  const e = await prisma.entidade.findFirst({ where: { nome: { contains: 'Prefeitura' }, municipio: { nome: 'Maringá' } }, select: { id: true } })
  const r = await new ConsistenciaService(prisma).verificar(e!.id, 2026)
  const f = (n: number | null) => (n == null ? '—' : n.toLocaleString('pt-BR', { minimumFractionDigits: 2 }))
  for (const v of r.verificacoes) console.log(`${v.status.padEnd(13)} ${v.codigo.padEnd(24)} esperado ${f(v.esperado)} · obtido ${f(v.obtido)} · Δ ${f(v.delta)}`)
  console.log(`\nSELO: ${r.selo.aprovadas}/${r.selo.avaliadas} consistentes (${r.selo.total} verificações)`)
  await prisma.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
