/**
 * TRANSFERÊNCIA FINANCEIRA RECEBIDA (duodécimo) da Câmara de Maringá 2026 —
 * AUTOMATIZADO do portal Elotech (turn-key, sem export manual).
 *
 * Fonte: `GET /api/repasses?tipo=R&mesInicial=01&mesFinal=12` (header entidade=6),
 * campo `valorLancado` = repasse RECEBIDO YTD. Descoberto via /actuator/mappings +
 * a XHR da tela /portaltransparencia/6/repasses-receita/receita.
 *
 * NÃO é receita orçamentária — dispara o evento 900 (D Caixa 1.1.1.1.1.30 / C VPA
 * 4.5.1.1.2.02 REPASSE RECEBIDO), fonte 1001. Idempotente por (entidade, data).
 *
 *   npx tsx scripts/importar_transferencias_camara_maringa.ts [--apply]
 */
import 'dotenv/config'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient, Prisma } from '@prisma/client'
import { TransferenciasFinanceirasService } from '../src/services/transferencias-financeiras.js'
import { CONTAS_EVENTO } from '../src/services/motor-eventos-receita.js'

const ANO = 2026
const FONTE = '1001' // Recursos do Tesouro (Descentralizados) — o repasse do Executivo
const ID_PORTAL = '6' // Câmara no portal Elotech de Maringá
const DATA = '2026-06-30' // lançado YTD (jan–jun); um lançamento agregado
const APPLY = process.argv.includes('--apply')
const BASE = 'https://transparencia.maringa.pr.gov.br/portaltransparencia-api'
const CAIXA = CONTAS_EVENTO.caixaArrecadacao
const VPA = CONTAS_EVENTO.vpaRepasseRecebido

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })
const reais = (d: Prisma.Decimal) => Number(d).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

async function repasseLancado(): Promise<Prisma.Decimal> {
  const res = await fetch(`${BASE}/api/repasses?tipo=R&mesInicial=01&mesFinal=12`, { headers: { entidade: ID_PORTAL, exercicio: String(ANO) } })
  if (!res.ok) throw new Error(`portal HTTP ${res.status}`)
  const d = (await res.json()) as { content?: { valorLancado?: number }[] } | { valorLancado?: number }[]
  const rows = Array.isArray(d) ? d : (d.content ?? [])
  const total = rows.reduce((s, r) => s + (r.valorLancado ?? 0), 0)
  return new Prisma.Decimal(total.toFixed(2))
}

async function main() {
  console.log(`\n═══ Transferência financeira (duodécimo) — Câmara de Maringá ${APPLY ? '[APPLY]' : '[DRY-RUN]'} ═══`)
  const cam = await prisma.entidade.findFirstOrThrow({ where: { tipo: 'CAMARA', municipio: { is: { nome: 'Maringá', estado: { is: { sigla: 'PR' } } } } }, select: { id: true, nome: true } })
  const usuario = await prisma.usuario.findFirstOrThrow({ orderBy: { criadoEm: 'asc' }, select: { id: true } })

  // pré-validação
  const contas = new Map((await prisma.contaContabilEntidade.findMany({ where: { entidadeId: cam.id, ano: ANO, codigo: { in: [CAIXA, VPA] } }, select: { codigo: true, admiteMovimento: true } })).map((c) => [c.codigo, c.admiteMovimento]))
  const faltam: string[] = []
  if (contas.get(CAIXA) !== true) faltam.push(`Caixa ${CAIXA}`)
  if (contas.get(VPA) !== true) faltam.push(`VPA ${VPA}`)
  if (!(await prisma.fonteRecursoEntidade.findFirst({ where: { entidadeId: cam.id, ano: ANO, codigo: FONTE } }))) faltam.push(`fonte ${FONTE}`)
  if (faltam.length) throw new Error(`Câmara sem: ${faltam.join(' · ')}`)

  const valor = await repasseLancado()
  console.log(`${cam.nome}`)
  console.log(`repasse lançado (portal, tipo=R): R$ ${reais(valor)}  (esperado ~36.079.003,50)`)
  console.log(`evento 900: D ${CAIXA} / C ${VPA} · fonte ${FONTE} · data ${DATA}\n`)

  const jaExiste = await prisma.transferenciaFinanceira.findFirst({ where: { entidadeId: cam.id, data: new Date(DATA) }, select: { id: true } })
  if (jaExiste) { console.log('já existe transferência nessa data — nada a fazer (idempotente).'); return }
  if (!APPLY) { console.log('DRY-RUN: nada gravado. Rode com --apply.'); return }

  const service = new TransferenciasFinanceirasService(prisma)
  await service.registrar({ entidadeId: cam.id, data: DATA, valor: valor.toFixed(2), fonteCodigo: FONTE, historico: 'Transferência financeira recebida do Município (duodécimo jan–jun/2026)', criadoPorId: usuario.id })
  console.log(`  ✓ gravado R$ ${reais(valor)}`)

  // verificação
  const saldo = async (codigo: string) => {
    const conta = await prisma.contaContabilEntidade.findFirst({ where: { entidadeId: cam.id, ano: ANO, codigo }, select: { id: true } })
    if (!conta) return new Prisma.Decimal(0)
    const g = await prisma.lancamentoItem.groupBy({ by: ['tipo'], where: { contaId: conta.id }, _sum: { valor: true } })
    const d = g.find((x) => x.tipo === 'DEBITO')?._sum.valor ?? 0
    const c = g.find((x) => x.tipo === 'CREDITO')?._sum.valor ?? 0
    return new Prisma.Decimal(d).minus(new Prisma.Decimal(c))
  }
  console.log(`  razão Caixa (devedor): R$ ${reais(await saldo(CAIXA))}`)
  console.log(`  razão VPA (credor): R$ ${reais((await saldo(VPA)).negated())}`)
}
main().catch((e) => { console.error('FALHOU:', e instanceof Error ? e.stack || e.message : e); process.exitCode = 1 }).finally(async () => { await prisma.$disconnect(); await pool.end() })
