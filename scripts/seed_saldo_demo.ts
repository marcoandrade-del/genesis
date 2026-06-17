/**
 * Seed de lançamentos DEMO para ver os saldos do plano de contas contábil
 * (/app/contas) com números reais. Idempotente e removível.
 *
 * Uso:
 *   npx tsx scripts/seed_saldo_demo.ts          # cria a demo na Prefeitura de Maringá (2026)
 *   npx tsx scripts/seed_saldo_demo.ts limpar   # remove a demo
 *
 * Cria, numa conta DEVEDORA e numa CREDORA (analíticas):
 *   - saldo inicial de 500 na devedora
 *   - lançamento em 15/03 (D 1000 / C 1000)  → conta no saldo de hoje
 *   - lançamento em 20/09 (D  300 / C  300)  → só conta a partir de set/2026
 * Assim dá pra ver o seletor "Saldo em <data>" mudando os totais.
 */
import 'dotenv/config'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient, Prisma } from '@prisma/client'
import { SaldoContabilService } from '../src/services/saldo-contabil.js'

const ENT = 'b186d24e-5f2a-4378-831f-c0092b626384' // Prefeitura do Município (Maringá), tem a LOA 2026
const ANO = 2026
const USER = '6ead2e8e-fea6-452e-82ca-70fe04e03af8'
const HIST = 'DEMO-SALDO'

async function main() {
  const prisma = new PrismaClient({ adapter: new PrismaPg(new Pool({ connectionString: process.env['DATABASE_URL'] })) })
  const limpar = process.argv.includes('limpar')

  const analiticas = await prisma.contaContabilEntidade.findMany({
    where: { entidadeId: ENT, ano: ANO, admiteMovimento: true, modeloContaId: { not: null } },
    select: { id: true, codigo: true, descricao: true, modeloContaId: true },
  })
  const modelos = await prisma.conta.findMany({
    where: { id: { in: [...new Set(analiticas.map((a) => a.modeloContaId!))] } },
    select: { id: true, naturezaSaldo: true },
  })
  const nat = new Map(modelos.map((m) => [m.id, m.naturezaSaldo]))
  const dev = analiticas.find((a) => nat.get(a.modeloContaId!) === 'DEVEDORA')
  const cre = analiticas.find((a) => nat.get(a.modeloContaId!) === 'CREDORA')
  if (!dev || !cre) {
    console.error('Não achei conta analítica DEVEDORA e CREDORA na entidade. Importou o plano?')
    process.exit(1)
  }

  // Sempre limpa a demo anterior antes (idempotência).
  await prisma.lancamento.deleteMany({ where: { entidadeId: ENT, historico: { startsWith: HIST } } })
  await prisma.saldoInicialAno.deleteMany({ where: { entidadeId: ENT, ano: ANO, contaId: dev.id } })

  if (limpar) {
    console.log('[demo] removida.')
    await prisma.$disconnect()
    return
  }

  await prisma.saldoInicialAno.create({ data: { entidadeId: ENT, contaId: dev.id, ano: ANO, valor: new Prisma.Decimal(500) } })
  for (const [data, valor] of [
    ['2026-03-15', 1000],
    ['2026-09-20', 300],
  ] as const) {
    await prisma.lancamento.create({
      data: {
        entidadeId: ENT,
        data: new Date(data),
        historico: `${HIST} ${data}`,
        valor: new Prisma.Decimal(valor),
        criadoPorId: USER,
        itens: {
          create: [
            { contaId: dev.id, tipo: 'DEBITO', valor: new Prisma.Decimal(valor) },
            { contaId: cre.id, tipo: 'CREDITO', valor: new Prisma.Decimal(valor) },
          ],
        },
      },
    })
  }

  const svc = new SaldoContabilService(prisma)
  const mostra = (m: Awaited<ReturnType<typeof svc.calcular>>, id: string) => {
    const s = m.get(id)!
    return `inicial=${s.saldoInicial} D=${s.totalDebito} C=${s.totalCredito} saldo=${s.saldoAtual} (${s.natureza})`
  }
  const hoje = await svc.calcular(ENT, ANO, new Date())
  const dez = await svc.calcular(ENT, ANO, new Date('2026-12-31'))

  console.log(`[demo] DEVEDORA ${dev.codigo} ${dev.descricao}`)
  console.log(`[demo] CREDORA  ${cre.codigo} ${cre.descricao}`)
  console.log(`\n  hoje      devedora: ${mostra(hoje, dev.id)}`)
  console.log(`  hoje      credora : ${mostra(hoje, cre.id)}`)
  console.log(`  31/12     devedora: ${mostra(dez, dev.id)}`)
  console.log(`  31/12     credora : ${mostra(dez, cre.id)}`)
  console.log('\nAbra /app/contas e use o seletor "Saldo em <data>" (ex.: 31/12/2026) para ver mudar.')
  console.log('Para remover: npx tsx scripts/seed_saldo_demo.ts limpar')

  await prisma.$disconnect()
}

main().catch((e) => {
  console.error('[demo] erro:', e)
  process.exit(1)
})
