/**
 * REAVALIAÇÃO dos repasses de Maringá (2026) — decisões do Marco em 2026-07-22:
 *
 *  (a) DUODÉCIMO/repasses (Câmara + autarquias): re-sincroniza ao YTD ATUAL. Os
 *      lançamentos de #275/#276 foram snapshots jan–jun; o portal avançou (a Câmara
 *      foi de 36,08mi → 42,09mi). Booka o DELTA (portal YTD − já lançado) como um
 *      novo evento 900 na data da reavaliação. Autarquias sem delta são puladas.
 *
 *  (b) APORTE do RPPS (Maringá Previdência): o `/api/repasses?tipo=R` traz 59,1mi,
 *      MAS a contribuição patronal do Executivo→RPPS (1.2.1.5.01 "PREFEITURA
 *      MUNICIPAL", 38,26mi) já está lançada como RECEITA ORÇAMENTÁRIA intra. Para
 *      não duplicar, booka só o RESÍDUO (aporte financeiro além da patronal) =
 *      repasse − patronal arrecadada, como evento 900.
 *
 * Fonte 1001 (convenção de Maringá, Recursos do Tesouro Descentralizados).
 * Idempotente por (entidade, data). Dry-run por padrão; grava com --apply.
 *
 *   npx tsx scripts/reavaliar_repasses_maringa.ts [--apply]
 */
import 'dotenv/config'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient, Prisma } from '@prisma/client'
import { TransferenciasFinanceirasService } from '../src/services/transferencias-financeiras.js'
import { CONTAS_EVENTO } from '../src/services/motor-eventos-receita.js'

const ANO = 2026
const FONTE = '1001'
const DATA = '2026-07-22' // data da reavaliação (delta YTD + aporte RPPS)
const BASE = 'https://transparencia.maringa.pr.gov.br/portaltransparencia-api'
const CAIXA = CONTAS_EVENTO.caixaArrecadacao
const VPA = CONTAS_EVENTO.vpaRepasseRecebido
const APPLY = process.argv.includes('--apply')

// entidades transfer-financiadas de Maringá: match no dev + idPortal Elotech.
const REPASSES = [
  { match: 'Câmara do Município', idPortal: '6', rotulo: 'Câmara' },
  { match: 'Regulação', idPortal: '9', rotulo: 'AMR' },
  { match: 'IPPLAM', idPortal: '15', rotulo: 'IPPLAM' },
  { match: 'Instituto Ambiental', idPortal: '4', rotulo: 'IAM' },
]

const pool = new Pool({ connectionString: process.env['DATABASE_URL'] })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })
const R = (d: Prisma.Decimal) => Number(d).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

async function portalRepasse(idPortal: string): Promise<Prisma.Decimal> {
  const res = await fetch(`${BASE}/api/repasses?tipo=R&mesInicial=01&mesFinal=12`, { headers: { entidade: idPortal, exercicio: String(ANO) } })
  if (!res.ok) throw new Error(`portal HTTP ${res.status}`)
  const d = (await res.json()) as { valorLancado?: number }[]
  const rows = Array.isArray(d) ? d : ((d as { content?: { valorLancado?: number }[] }).content ?? [])
  return new Prisma.Decimal(rows.reduce((s, r) => s + (r.valorLancado ?? 0), 0).toFixed(2))
}

/** Soma dos TFs já lançados de uma entidade (todos, para calcular o delta YTD). */
async function jaLancado(entidadeId: string): Promise<Prisma.Decimal> {
  const tfs = await prisma.transferenciaFinanceira.findMany({ where: { entidadeId }, select: { valor: true } })
  return tfs.reduce((s, t) => s.plus(new Prisma.Decimal(t.valor)), new Prisma.Decimal(0))
}

async function acharEntidade(match: string) {
  return prisma.entidade.findFirst({ where: { nome: { contains: match }, municipio: { is: { nome: 'Maringá', estado: { is: { sigla: 'PR' } } } } }, select: { id: true, nome: true } })
}

async function preValida(entidadeId: string): Promise<boolean> {
  const contas = new Map((await prisma.contaContabilEntidade.findMany({ where: { entidadeId, ano: ANO, codigo: { in: [CAIXA, VPA] } }, select: { codigo: true, admiteMovimento: true } })).map((c) => [c.codigo, c.admiteMovimento]))
  const temFonte = await prisma.fonteRecursoEntidade.findFirst({ where: { entidadeId, ano: ANO, codigo: FONTE }, select: { id: true } })
  return contas.get(CAIXA) === true && contas.get(VPA) === true && !!temFonte
}

async function bookar(service: TransferenciasFinanceirasService, entidadeId: string, valor: Prisma.Decimal, usuarioId: string, historico: string) {
  const jaNaData = await prisma.transferenciaFinanceira.findFirst({ where: { entidadeId, data: new Date(DATA) }, select: { id: true } })
  if (jaNaData) { console.log(`    já lançado em ${DATA} (idempotente) — pulando`); return false }
  if (!APPLY) { console.log(`    [dry-run] gravaria R$ ${R(valor)}`); return false }
  await service.registrar({ entidadeId, data: DATA, valor: valor.toFixed(2), fonteCodigo: FONTE, historico, criadoPorId: usuarioId })
  console.log(`    ✓ gravado R$ ${R(valor)}`)
  return true
}

async function main() {
  console.log(`\n═══ Reavaliação dos repasses de Maringá ${APPLY ? '[APPLY]' : '[DRY-RUN]'} ═══`)
  const usuario = await prisma.usuario.findFirstOrThrow({ orderBy: { criadoEm: 'asc' }, select: { id: true } })
  const service = new TransferenciasFinanceirasService(prisma)
  let totalGravado = new Prisma.Decimal(0)

  // (a) re-sync YTD dos repasses (Câmara + autarquias) — booka o delta
  console.log('\n(a) Duodécimo/repasses — delta YTD:')
  for (const r of REPASSES) {
    const e = await acharEntidade(r.match)
    if (!e) { console.log(`  ${r.rotulo}: entidade não encontrada — pulando`); continue }
    const portal = await portalRepasse(r.idPortal)
    const booked = await jaLancado(e.id)
    const delta = portal.minus(booked)
    console.log(`  ${r.rotulo}: portal ${R(portal)} − já lançado ${R(booked)} = delta ${R(delta)}`)
    if (delta.lte(new Prisma.Decimal('0.01'))) { console.log('    sem delta — nada a fazer'); continue }
    if (!(await preValida(e.id))) { console.log(`    SEM caixa/VPA/fonte ${FONTE} — pulando`); continue }
    if (await bookar(service, e.id, delta, usuario.id, `Ajuste do repasse recebido ao YTD (reavaliação jul/${ANO})`)) totalGravado = totalGravado.plus(delta)
  }

  // (b) aporte do RPPS — resíduo (repasse − patronal orçamentária já lançada)
  console.log('\n(b) Aporte do RPPS (líquido da patronal orçamentária):')
  const prev = await acharEntidade('Maringá Previdência')
  if (!prev) { console.log('  Maringá Previdência não encontrada — pulando') }
  else {
    const portal = await portalRepasse('3')
    const patrRows = await prisma.previsaoReceita.findMany({ where: { orcamento: { entidadeId: prev.id }, contaReceita: { codigo: { startsWith: '1.2.1.5.01' }, descricao: { startsWith: 'PREFEITURA MUNICIPAL' } } }, select: { valorArrecadado: true } })
    const patronal = patrRows.reduce((s, p) => s.plus(new Prisma.Decimal(p.valorArrecadado)), new Prisma.Decimal(0))
    const residuo = portal.minus(patronal)
    console.log(`  repasse portal ${R(portal)} − patronal orçamentária ${R(patronal)} = aporte ${R(residuo)}`)
    if (residuo.lte(new Prisma.Decimal('0.01'))) console.log('    sem resíduo — nada a bookar')
    else if (!(await preValida(prev.id))) console.log(`    SEM caixa/VPA/fonte ${FONTE} — pulando`)
    else if (await bookar(service, prev.id, residuo, usuario.id, `Aporte financeiro ao RPPS (líquido da contribuição patronal orçamentária) — ${ANO}`)) totalGravado = totalGravado.plus(residuo)
  }

  console.log(APPLY ? `\n[apply] Σ gravado na reavaliação: R$ ${R(totalGravado)}` : '\nDRY-RUN: nada gravado. Rode com --apply.')
}
main().catch((e) => { console.error('FALHOU:', e instanceof Error ? e.stack || e.message : e); process.exitCode = 1 }).finally(async () => { await prisma.$disconnect(); await pool.end() })
