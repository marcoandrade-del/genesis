/**
 * TRANSFERÊNCIA FINANCEIRA RECEBIDA (repasse) das autarquias de Maringá 2026
 * (AMR/IAM/IPPLAM) — AUTOMATIZADO do portal Elotech (turn-key, sem export manual).
 *
 * Fonte: `GET /api/repasses?tipo=R&mesInicial=01&mesFinal=12` (header entidade=idPortal),
 * campo `valorLancado` = repasse recebido YTD. As autarquias têm receita ORÇAMENTÁRIA
 * própria (taxas/remuneração, já no dev) + o REPASSE do Tesouro (transf. financeira).
 * O repasse dispara o evento 900 (D Caixa 1.1.1.1.1.30 / C VPA 4.5.1.1.2.02), fonte 1001.
 * Idempotente por (entidade, data). Espelha importar_transferencias_camara_maringa.ts.
 *
 *   npx tsx scripts/importar_transferencias_indiretas_maringa.ts [--apply]
 */
import 'dotenv/config'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient, Prisma } from '@prisma/client'
import { TransferenciasFinanceirasService } from '../src/services/transferencias-financeiras.js'
import { CONTAS_EVENTO } from '../src/services/motor-eventos-receita.js'

const ANO = 2026
const FONTE = '1001'
const DATA = '2026-06-30'
const APPLY = process.argv.includes('--apply')
const BASE = 'https://transparencia.maringa.pr.gov.br/portaltransparencia-api'
const CAIXA = CONTAS_EVENTO.caixaArrecadacao
const VPA = CONTAS_EVENTO.vpaRepasseRecebido

// autarquias transfer-financiadas: match no dev + idPortal Elotech
const AUTARQUIAS = [
  { match: 'Regulação', idPortal: '9', rotulo: 'AMR' },
  { match: 'Ambiental', idPortal: '4', rotulo: 'IAM' },
  { match: 'IPPLAM', idPortal: '15', rotulo: 'IPPLAM' },
]

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })
const reais = (d: Prisma.Decimal) => Number(d).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

async function repasseLancado(idPortal: string): Promise<Prisma.Decimal> {
  const res = await fetch(`${BASE}/api/repasses?tipo=R&mesInicial=01&mesFinal=12`, { headers: { entidade: idPortal, exercicio: String(ANO) } })
  if (!res.ok) throw new Error(`portal HTTP ${res.status}`)
  const d = (await res.json()) as { content?: { valorLancado?: number }[] } | { valorLancado?: number }[]
  const rows = Array.isArray(d) ? d : (d.content ?? [])
  return new Prisma.Decimal(rows.reduce((s, r) => s + (r.valorLancado ?? 0), 0).toFixed(2))
}

async function main() {
  console.log(`\n═══ Transferências financeiras (repasse) — autarquias de Maringá ${APPLY ? '[APPLY]' : '[DRY-RUN]'} ═══`)
  const usuario = await prisma.usuario.findFirstOrThrow({ orderBy: { criadoEm: 'asc' }, select: { id: true } })
  const service = new TransferenciasFinanceirasService(prisma)
  let totalGravado = new Prisma.Decimal(0)

  for (const a of AUTARQUIAS) {
    const ent = await prisma.entidade.findFirst({ where: { tipo: 'ADM_INDIRETA', nome: { contains: a.match }, municipio: { is: { nome: 'Maringá', estado: { is: { sigla: 'PR' } } } } }, select: { id: true, nome: true } })
    if (!ent) { console.log(`\n${a.rotulo}: entidade não encontrada — pulando`); continue }
    // pré-validação
    const contas = new Map((await prisma.contaContabilEntidade.findMany({ where: { entidadeId: ent.id, ano: ANO, codigo: { in: [CAIXA, VPA] } }, select: { codigo: true, admiteMovimento: true } })).map((c) => [c.codigo, c.admiteMovimento]))
    const okFonte = await prisma.fonteRecursoEntidade.findFirst({ where: { entidadeId: ent.id, ano: ANO, codigo: FONTE } })
    if (contas.get(CAIXA) !== true || contas.get(VPA) !== true || !okFonte) { console.log(`\n${ent.nome}: SEM caixa/VPA/fonte ${FONTE} — pulando`); continue }

    const valor = await repasseLancado(a.idPortal)
    console.log(`\n${ent.nome} [idPortal ${a.idPortal}]`)
    console.log(`  repasse lançado (portal): R$ ${reais(valor)}`)
    const jaExiste = await prisma.transferenciaFinanceira.findFirst({ where: { entidadeId: ent.id, data: new Date(DATA) }, select: { id: true } })
    if (jaExiste) { console.log('  já existe nessa data — idempotente, pulando'); continue }
    if (!APPLY) { console.log('  [dry-run] gravaria via evento 900'); continue }
    await service.registrar({ entidadeId: ent.id, data: DATA, valor: valor.toFixed(2), fonteCodigo: FONTE, historico: `Transferência financeira recebida do Município (repasse jan–jun/${ANO})`, criadoPorId: usuario.id })
    totalGravado = totalGravado.plus(valor)
    console.log(`  ✓ gravado R$ ${reais(valor)}`)
  }
  if (APPLY) console.log(`\n[apply] Σ repasse gravado nas autarquias: R$ ${reais(totalGravado)}`)
  else console.log('\nDRY-RUN: nada gravado. Rode com --apply.')
}
main().catch((e) => { console.error('FALHOU:', e instanceof Error ? e.stack || e.message : e); process.exitCode = 1 }).finally(async () => { await prisma.$disconnect(); await pool.end() })
