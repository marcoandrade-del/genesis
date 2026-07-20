/**
 * TRANSFERÊNCIAS FINANCEIRAS RECEBIDAS (duodécimo/repasse) da Câmara de Paranaguá 2026.
 *
 * Fonte: PDF "Repasse recebido 2026.pdf" do portal próprio da Câmara
 * (camaraparanagua.atende.net → item previsao-e-realizacao-2026 → /ged/r/{id}),
 * salvo em ~/Downloads/camara_paranagua_repasse_recebido_2026.pdf.
 *
 * NÃO é receita orçamentária — é Transferência Financeira Recebida. Dispara o evento
 * contábil 900 no razão (D Caixa 1.1.1.1.1.30 / C VPA REPASSE RECEBIDO 4.5.1.1.2.02),
 * via TransferenciasFinanceirasService. Idempotente por (entidade, data).
 *
 *   npx tsx scripts/importar_transferencias_camara_paranagua.ts [--apply]
 */
import 'dotenv/config'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient, Prisma } from '@prisma/client'
import { TransferenciasFinanceirasService } from '../src/services/transferencias-financeiras.js'
import { CONTAS_EVENTO } from '../src/services/motor-eventos-receita.js'

const ANO = 2026
const FONTE = '001' // Recursos do Tesouro (Descentralizados) — repasse do Executivo
const APPLY = process.argv.includes('--apply')
const CAIXA = CONTAS_EVENTO.caixaArrecadacao // 1.1.1.1.1.30
const VPA = CONTAS_EVENTO.vpaRepasseRecebido // 4.5.1.1.2.02

// Repasses mensais recebidos (datas e valores REAIS do PDF).
const REPASSES: { data: string; valor: string; mes: string }[] = [
  { data: '2026-01-15', valor: '4918368.00', mes: 'janeiro' },
  { data: '2026-02-19', valor: '4064964.00', mes: 'fevereiro' },
  { data: '2026-03-16', valor: '4491666.00', mes: 'março' },
  { data: '2026-04-16', valor: '4491666.00', mes: 'abril' },
  { data: '2026-05-18', valor: '4491666.00', mes: 'maio' },
]

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })
const reais = (d: Prisma.Decimal) => Number(d).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

async function main() {
  console.log(`\n═══ Transferências financeiras (duodécimo) — Câmara de Paranaguá ${APPLY ? '[APPLY]' : '[DRY-RUN]'} ═══`)
  const cam = await prisma.entidade.findFirstOrThrow({
    where: { tipo: 'CAMARA', municipio: { is: { nome: 'Paranaguá', estado: { is: { sigla: 'PR' } } } } },
    select: { id: true, nome: true },
  })
  const usuario = await prisma.usuario.findFirstOrThrow({ orderBy: { criadoEm: 'asc' }, select: { id: true } })

  // Pré-validação (evita rollback tardio): caixa + VPA [MOV] + fonte existem.
  const contas = new Map(
    (await prisma.contaContabilEntidade.findMany({ where: { entidadeId: cam.id, ano: ANO, codigo: { in: [CAIXA, VPA] } }, select: { codigo: true, admiteMovimento: true } })).map((c) => [c.codigo, c.admiteMovimento]),
  )
  const faltam: string[] = []
  if (contas.get(CAIXA) !== true) faltam.push(`Caixa ${CAIXA} [MOV]`)
  if (contas.get(VPA) !== true) faltam.push(`VPA ${VPA} [MOV]`)
  const fonte = await prisma.fonteRecursoEntidade.findFirst({ where: { entidadeId: cam.id, ano: ANO, codigo: FONTE }, select: { id: true } })
  if (!fonte) faltam.push(`fonte ${FONTE}`)
  if (faltam.length) throw new Error(`Câmara sem: ${faltam.join(' · ')} — provisione antes de importar.`)

  const total = REPASSES.reduce((s, r) => s.plus(new Prisma.Decimal(r.valor)), new Prisma.Decimal(0))
  console.log(`Câmara: ${cam.nome}`)
  console.log(`repasses: ${REPASSES.length} · Σ R$ ${reais(total)} (esperado 22.458.330,00)`)
  console.log(`evento 900: D ${CAIXA} / C ${VPA} · fonte ${FONTE}\n`)

  const service = new TransferenciasFinanceirasService(prisma)
  let gravados = 0
  const acc = new Prisma.Decimal(0)
  let somaGravada = acc
  for (const r of REPASSES) {
    const jaExiste = await prisma.transferenciaFinanceira.findFirst({ where: { entidadeId: cam.id, data: new Date(r.data) }, select: { id: true } })
    if (jaExiste) { console.log(`  • ${r.data} R$ ${reais(new Prisma.Decimal(r.valor))} — já existe, pulando`); continue }
    if (!APPLY) { console.log(`  · [dry-run] ${r.data} R$ ${reais(new Prisma.Decimal(r.valor))} (${r.mes})`); continue }
    await service.registrar({
      entidadeId: cam.id,
      data: r.data,
      valor: r.valor,
      fonteCodigo: FONTE,
      historico: `Transferência financeira recebida do Executivo (duodécimo ${r.mes}/${ANO})`,
      criadoPorId: usuario.id,
    })
    somaGravada = somaGravada.plus(new Prisma.Decimal(r.valor))
    gravados++
    console.log(`  ✓ ${r.data} R$ ${reais(new Prisma.Decimal(r.valor))} (${r.mes})`)
  }

  if (APPLY) {
    console.log(`\n[apply] transferências gravadas: ${gravados} · Σ R$ ${reais(somaGravada)}`)
    // Verificação: saldos do razão (Câmara/2026)
    const saldo = async (codigo: string) => {
      const conta = await prisma.contaContabilEntidade.findFirst({ where: { entidadeId: cam.id, ano: ANO, codigo }, select: { id: true } })
      if (!conta) return new Prisma.Decimal(0)
      const g = await prisma.lancamentoItem.groupBy({ by: ['tipo'], where: { contaId: conta.id }, _sum: { valor: true } })
      const d = g.find((x) => x.tipo === 'DEBITO')?._sum.valor ?? new Prisma.Decimal(0)
      const c = g.find((x) => x.tipo === 'CREDITO')?._sum.valor ?? new Prisma.Decimal(0)
      return new Prisma.Decimal(d).minus(new Prisma.Decimal(c))
    }
    console.log(`  razão Caixa ${CAIXA} (devedor): R$ ${reais(await saldo(CAIXA))}`)
    console.log(`  razão VPA ${VPA} (credor): R$ ${reais((await saldo(VPA)).negated())}`)
    // Receita orçamentária tocada? (não deve)
    const orc = await prisma.lancamentoItem.count({ where: { conta: { entidadeId: cam.id, codigo: { startsWith: '6.2.1' } }, lancamento: { origemTipo: 'TRANSFERENCIA_FINANCEIRA' } } })
    console.log(`  lançamentos de transf. que tocam 6.2.1.x (deve ser 0): ${orc}`)
  } else {
    console.log('\nDRY-RUN: nada gravado. Rode com --apply.')
  }
}

main().catch((e) => { console.error('FALHOU:', e instanceof Error ? e.stack || e.message : e); process.exitCode = 1 }).finally(async () => { await prisma.$disconnect(); await pool.end() })
