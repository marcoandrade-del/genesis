/**
 * Backfill da EXECUÇÃO DA DESPESA de Maringá 2026 via SincronizacaoPortalService
 * (mesma captura do job automático — empenhos sintéticos CAP-* + movimentos
 * mensais; ver o service para o desenho completo e as ressalvas de rateio).
 *
 * Rodar: npx tsx scripts/importar_despesa_portal_2026.ts --ate 6
 */
import 'dotenv/config'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import { SincronizacaoPortalService } from '../src/services/sincronizacao-portal.js'

const iAte = process.argv.indexOf('--ate')
const ATE = iAte >= 0 ? parseInt(process.argv[iAte + 1] ?? '', 10) : NaN
if (!Number.isInteger(ATE) || ATE < 1 || ATE > 12) {
  console.error('Informe até que mês: --ate 6')
  process.exit(1)
}

const pool = new Pool({ connectionString: process.env['DATABASE_URL'] })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

async function main() {
  const ent = await prisma.entidade.findFirstOrThrow({
    where: { tipo: 'PREFEITURA', municipio: { is: { nome: { contains: 'Maring', mode: 'insensitive' }, estado: { is: { sigla: 'PR' } } } } },
  })
  const svc = new SincronizacaoPortalService(prisma)
  for (let mes = 1; mes <= ATE; mes++) {
    const r = await svc.despesaMes(ent.id, 2026, mes)
    console.log(`mês ${mes}: ${r.status} — portal ${r.valorPortal.toLocaleString('pt-BR')} · gravado ${r.valorGravado.toLocaleString('pt-BR')} — ${r.mensagem}`)
    if (r.status === 'ERRO') process.exit(1)
  }
  const agg = await prisma.dotacaoDespesa.aggregate({
    where: { orcamento: { entidadeId: ent.id, ano: 2026 } },
    _sum: { valorEmpenhado: true },
  })
  console.log(`\nΣ valorEmpenhado no banco: ${Number(agg._sum.valorEmpenhado ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`)
  console.log('(gabarito TCE até jun: 1.746.396.980,01 · dashboard Σ jan–jun: 1.746.199.006,72)')
}
main().finally(async () => {
  await prisma.$disconnect()
  await pool.end()
})
