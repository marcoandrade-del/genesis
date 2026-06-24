/**
 * Smoke AO VIVO do disparo contábil tributário (E550 lançamento / E570 dívida ativa),
 * agora table-driven. Constitui um crédito (E550), inscreve parte em dívida ativa
 * (E570), confere os lançamentos e limpa tudo (try/finally).
 *
 *   npx tsx scripts/smoke_tributaria_eventos.ts            # DRY-RUN
 *   npx tsx scripts/smoke_tributaria_eventos.ts --apply    # roda e limpa
 */
import 'dotenv/config'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient, Prisma } from '@prisma/client'
import { LancamentoTributarioService } from '../src/services/lancamento-tributario.js'
import { LancamentosService } from '../src/services/lancamentos.js'

const APLICAR = process.argv.includes('--apply')
const SUFFIX = `SMOKE-${Date.now()}`
const pool = new Pool({ connectionString: process.env['DATABASE_URL'] })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })
const log = (s = '') => console.log(s)
const money = (v: Prisma.Decimal | string | number) => new Prisma.Decimal(v).toFixed(2)

async function main() {
  log(`Smoke disparo tributário — ${APLICAR ? 'APPLY' : 'DRY-RUN'}\n`)
  const orcamento = await prisma.orcamento.findFirst({ where: { status: { in: ['EM_EXECUCAO', 'APROVADO'] } }, orderBy: { ano: 'desc' }, include: { entidade: { select: { nome: true } } } })
  if (!orcamento) throw new Error('Nenhum orçamento.')
  const modeloId = await resolverModelo(orcamento.entidadeId)
  const params = modeloId ? await prisma.parametroReceita.findMany({ where: { modeloContabilId: modeloId } }) : []
  // de/para tributário completo (competência + ativo + dívida ativa).
  const trib = params.filter((p) => p.indicadorReconhecimento === 'COMPETENCIA' && p.contaAtivoCodigo && p.contaDividaAtivaCodigo)
  log(`Entidade: ${orcamento.entidade.nome} | de/para tributário completo: ${trib.length}`)
  if (!trib.length) throw new Error('Nenhum de/para tributário (competência + ativo + dívida ativa).')

  const previsoes = await prisma.previsaoReceita.findMany({ where: { orcamentoId: orcamento.id }, include: { contaReceita: { select: { codigo: true } } }, take: 2000 })
  const casa = (cod: string) => trib.find((p) => cod === p.naturezaCodigo || cod.startsWith(p.naturezaCodigo + '.'))
  const previsao = previsoes.find((p) => casa(p.contaReceita.codigo))
  if (!previsao) throw new Error('Nenhuma previsão de natureza tributária.')
  log(`Previsão tributária: ${previsao.contaReceita.codigo} (${previsao.id})\n`)

  if (!APLICAR) { log('DRY-RUN ok. Rode com --apply.'); return }

  const svc = new LancamentoTributarioService(prisma)
  const lancamentosSvc = new LancamentosService(prisma)
  const criados: string[] = []
  let ok = false
  try {
    log('── LANÇAMENTO TRIBUTÁRIO (E550) ────────────────────')
    const lt = await svc.criar(orcamento.id, { previsaoId: previsao.id, tipo: 'LANCAMENTO', data: hoje(), valor: '1.00', criadoPorId: SUFFIX } as never)
    criados.push(lt.id)
    await mostrar('LANCAMENTO_TRIBUTARIO', lt.id)

    log('── INSCRIÇÃO EM DÍVIDA ATIVA (E570) ────────────────')
    const ins = await svc.criar(orcamento.id, { previsaoId: previsao.id, tipo: 'INSCRICAO_DIVIDA_ATIVA', data: hoje(), valor: '0.30', criadoPorId: SUFFIX } as never)
    criados.push(ins.id)
    await mostrar('INSCRICAO_DIVIDA_ATIVA', ins.id)

    log('\n✅ Tributário validado ao vivo. Limpando…')
    ok = true
  } finally {
    await cleanup(criados, lancamentosSvc)
    log(ok ? '✅ Cleanup concluído.' : '⚠️ Cleanup após falha — verifique.')
  }
}

async function mostrar(origemTipo: 'LANCAMENTO_TRIBUTARIO' | 'INSCRICAO_DIVIDA_ATIVA', origemId: string) {
  const lancs = await prisma.lancamento.findMany({ where: { origemTipo, origemId }, include: { itens: { include: { conta: { select: { codigo: true } } } } }, orderBy: { eventoCodigo: 'asc' } })
  for (const l of lancs) {
    const somaD = l.itens.filter((i) => i.tipo === 'DEBITO').reduce((s, i) => s.plus(i.valor), new Prisma.Decimal(0))
    const somaC = l.itens.filter((i) => i.tipo === 'CREDITO').reduce((s, i) => s.plus(i.valor), new Prisma.Decimal(0))
    log(`  E${l.eventoCodigo}  ${l.historico}`)
    for (const i of l.itens) log(`      ${i.tipo === 'DEBITO' ? 'D' : 'C'} ${i.conta.codigo}  R$ ${money(i.valor)}  cc=${i.naturezaReceitaCodigo ? 'nat' : '—'}`)
    const balok = somaD.equals(somaC)
    log(`      ${balok ? '✓' : '✗'} balanço ΣD=ΣC (${money(somaD)}=${money(somaC)})`)
    if (!balok) throw new Error(`E${l.eventoCodigo} desbalanceado.`)
  }
}

function hoje() { return new Date().toISOString().slice(0, 10) }
async function resolverModelo(entidadeId: string) {
  const e = await prisma.entidade.findUnique({ where: { id: entidadeId }, include: { municipio: { include: { estado: { select: { modeloContabilId: true } } } } } })
  return e?.municipio?.modeloContabilId ?? e?.municipio?.estado?.modeloContabilId ?? null
}
async function cleanup(ltIds: string[], lancamentosSvc: LancamentosService) {
  const lancs = await prisma.lancamento.findMany({ where: { origemTipo: { in: ['LANCAMENTO_TRIBUTARIO', 'INSCRICAO_DIVIDA_ATIVA'] }, origemId: { in: ltIds } }, select: { id: true } })
  for (const l of lancs) { try { await lancamentosSvc.excluir(l.id) } catch (e) { log(`  (cleanup) ${l.id}: ${(e as Error).message}`) } }
  if (ltIds.length) await prisma.lancamentoTributario.deleteMany({ where: { id: { in: ltIds } } })
}

main().then(() => prisma.$disconnect().then(() => pool.end())).catch(async (e) => {
  console.error('\n❌ ERRO:', e instanceof Error ? e.message : e)
  await prisma.$disconnect().catch(() => {}); await pool.end().catch(() => {}); process.exit(1)
})
