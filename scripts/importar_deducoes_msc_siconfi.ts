/**
 * Import das DEDUÇÕES da receita (FUNDEB) da Prefeitura de Maringá a partir da
 * MSC OFICIAL do Siconfi (ver msc-siconfi-fonte-oficial):
 *
 *  1. Dedução PREVISTA por natureza×fonte — conta 5.2.1.1.2.01.01 no
 *     ending_balance de jan/2026 (a LOA entra na MSC oficial como movimento de
 *     janeiro; o bb de jan não tem 5211*) → PrevisaoReceita.valorDeducaoPrevisto.
 *  2. Dedução REALIZADA mensal por natureza×fonte — conta 6.2.1.3.1.01 no
 *     period_change dos meses → movimentos DEDUCAO via ArrecadacoesService
 *     (dispara o evento 150 e materializa valorDeduzido, tudo rastreável).
 *
 * Escopo cut 1: só FUNDEB (6.2.1.3.1.01). Renúncia (6.2.1.3.2) e outras
 * (6.2.1.3.9) ficam para eventos próprios — o script REPORTA o que ficou fora.
 *
 * Idempotente: (1) é update por chave; (2) apaga os movimentos DEDUCAO
 * anteriores deste lote (histórico marcador) e reaplica.
 *
 * Uso: npx tsx scripts/importar_deducoes_msc_siconfi.ts [--apply] [--meses=1-5]
 */
import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient, Prisma } from '@prisma/client'
import { ArrecadacoesService } from '../src/services/arrecadacoes.js'
import { LancamentosService } from '../src/services/lancamentos.js'

const APPLY = process.argv.includes('--apply')
const MESES = (() => {
  const arg = process.argv.find((a) => a.startsWith('--meses='))?.split('=')[1] ?? '1-5'
  const [ini, fim] = arg.split('-').map(Number)
  return Array.from({ length: (fim ?? ini) - ini + 1 }, (_, i) => ini + i)
})()
const E = 'b186d24e-5f2a-4378-831f-c0092b626384' // Prefeitura do Município (Maringá)
const PODER = '10131'
const DIR = 'data/abertura-2026/msc_siconfi'
const HIST = (mes: number) => `Dedução FUNDEB — MSC oficial Siconfi ${String(mes).padStart(2, '0')}/2026`

const prisma = new PrismaClient({ adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })) })
const fmt = (x: number) => x.toLocaleString('pt-BR', { minimumFractionDigits: 2 })
const r2 = (x: number) => Math.round(x * 100) / 100

/** natureza da MSC ("17115201", 8 díg a.b.c.d.ee.f.g) → prefixo nosso "1.7.1.1.51.2.0.1"?
 *  Nosso plano usa segmentos a.b.c.d.ee.f.g nos 7 primeiros — normalizamos ambos p/ 8 díg. */
const nat8 = (codigo12seg: string) => codigo12seg.split('.').slice(0, 7).join('')

async function main() {
  // Previsões da Prefeitura indexadas por natureza(8díg)×fonte
  const previsoes = await prisma.previsaoReceita.findMany({
    where: { orcamento: { entidadeId: E, ano: 2026 } },
    select: { id: true, valorPrevisto: true, valorDeducaoPrevisto: true, contaReceita: { select: { codigo: true } }, fonteRecurso: { select: { codigo: true } } },
  })
  const porChave = new Map(previsoes.map((p) => [`${nat8(p.contaReceita.codigo)}|${p.fonteRecurso.codigo}`, p]))
  console.log(`previsões da Prefeitura: ${previsoes.length}`)

  // ── 1. dedução PREVISTA (eb jan, 5.2.1.1.2.01.01 = "521120101")
  const bb = JSON.parse(readFileSync(`${DIR}/mscc_2026-01_eb_classe5.json`, 'utf-8'))
  const prevDed = new Map<string, number>() // natureza8|fonte → valor
  for (const i of bb.items) {
    if (i.poder_orgao !== PODER || i.conta_contabil !== '521120101') continue
    const k = `${i.natureza_receita ?? ''}|${i.fonte_recursos ?? ''}`
    prevDed.set(k, r2((prevDed.get(k) ?? 0) + i.valor * (i.natureza_conta === 'C' ? 1 : -1)))
  }
  let prevOk = 0, prevOkValor = 0
  const prevSem: string[] = []
  for (const [k, v] of prevDed) {
    if (v === 0) continue
    if (porChave.has(k)) { prevOk++; prevOkValor += v } else prevSem.push(`${k} (${fmt(v)})`)
  }
  console.log(`\n[1] dedução PREVISTA (521120101): ${prevDed.size} chaves · casadas ${prevOk} (Σ ${fmt(prevOkValor)}) · sem previsão: ${prevSem.length}`)
  for (const s of prevSem.slice(0, 8)) console.log(`   sem match: ${s}`)

  // ── 2. dedução REALIZADA mensal (pc, 6.2.1.3.1.01 = "621310100")
  type Mov = { mes: number; chave: string; valor: number }
  const movs: Mov[] = []
  const foraEscopo = new Map<string, number>() // renúncia/outras
  for (const mes of MESES) {
    const pc = JSON.parse(readFileSync(`${DIR}/mscc_2026-${String(mes).padStart(2, '0')}_pc_classe6.json`, 'utf-8'))
    const porChaveMes = new Map<string, number>()
    for (const i of pc.items) {
      if (i.poder_orgao !== PODER) continue
      if (i.conta_contabil.startsWith('62132') || i.conta_contabil.startsWith('62139') || i.conta_contabil.startsWith('62133') || i.conta_contabil.startsWith('62138')) {
        foraEscopo.set(i.conta_contabil, r2((foraEscopo.get(i.conta_contabil) ?? 0) + i.valor * (i.natureza_conta === 'D' ? 1 : -1)))
        continue
      }
      if (i.conta_contabil !== '621310100') continue
      const k = `${i.natureza_receita ?? ''}|${i.fonte_recursos ?? ''}`
      porChaveMes.set(k, r2((porChaveMes.get(k) ?? 0) + i.valor * (i.natureza_conta === 'D' ? 1 : -1)))
    }
    for (const [chave, valor] of porChaveMes) if (valor > 0) movs.push({ mes, chave, valor })
  }
  const movsOk = movs.filter((m) => porChave.has(m.chave))
  const movsSem = movs.filter((m) => !porChave.has(m.chave))
  console.log(`\n[2] dedução REALIZADA (621310100) meses ${MESES.join(',')}: ${movs.length} chaves-mês · casadas ${movsOk.length} (Σ ${fmt(movsOk.reduce((s, m) => s + m.valor, 0))}) · sem previsão ${movsSem.length} (Σ ${fmt(movsSem.reduce((s, m) => s + m.valor, 0))})`)
  for (const m of movsSem.slice(0, 8)) console.log(`   sem match: mês ${m.mes} ${m.chave} (${fmt(m.valor)})`)
  if (foraEscopo.size) {
    console.log(`   FORA DO ESCOPO (renúncia/outras — eventos próprios pendentes):`)
    for (const [c, v] of foraEscopo) console.log(`     ${c}: Σ pc ${fmt(v)}`)
  }

  if (!APPLY) { console.log('\nDRY-RUN — nada gravado. --apply p/ aplicar.'); await prisma.$disconnect(); return }

  // apply 1: valorDeducaoPrevisto
  for (const [k, v] of prevDed) {
    const p = porChave.get(k)
    if (!p || v === 0) continue
    await prisma.previsaoReceita.update({ where: { id: p.id }, data: { valorDeducaoPrevisto: new Prisma.Decimal(v) } })
  }
  console.log(`\nAPPLY[1]: valorDeducaoPrevisto gravado em ${prevOk} previsões (Σ ${fmt(prevOkValor)})`)

  // apply 2: movimentos DEDUCAO (substituição por lote: apaga os deste marcador e reaplica)
  const lancamentos = new LancamentosService(prisma)
  const antigos = await prisma.arrecadacao.findMany({
    where: { previsao: { orcamento: { entidadeId: E, ano: 2026 } }, tipo: 'DEDUCAO', historico: { startsWith: 'Dedução FUNDEB — MSC oficial Siconfi' } },
    select: { id: true, previsaoId: true, valor: true },
  })
  for (const a of antigos) {
    const lancs = await prisma.lancamento.findMany({ where: { origemTipo: 'ARRECADACAO', origemId: a.id }, select: { id: true } })
    for (const l of lancs) await lancamentos.excluir(l.id)
    await prisma.$transaction([
      prisma.arrecadacao.delete({ where: { id: a.id } }),
      prisma.previsaoReceita.update({ where: { id: a.previsaoId }, data: { valorDeduzido: { decrement: a.valor } } }),
    ])
  }
  if (antigos.length) console.log(`APPLY[2]: ${antigos.length} movimentos DEDUCAO anteriores removidos (re-import)`)

  const svc = new ArrecadacoesService(prisma)
  const orc = await prisma.orcamento.findUnique({ where: { entidadeId_ano: { entidadeId: E, ano: 2026 } }, select: { id: true } })
  if (!orc) throw new Error('sem orçamento')
  const ULTIMO_DIA = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  let criados = 0
  for (const m of movsOk) {
    const p = porChave.get(m.chave)!
    await svc.criar(orc.id, {
      previsaoId: p.id,
      tipo: 'DEDUCAO',
      data: `2026-${String(m.mes).padStart(2, '0')}-${ULTIMO_DIA[m.mes - 1]}`,
      valor: String(m.valor),
      historico: HIST(m.mes),
      criadoPorId: 'IMPORT_DEDUCAO_MSC',
    })
    criados++
  }
  console.log(`APPLY[2]: ${criados} movimentos DEDUCAO criados (evento 150 disparado em cada)`)
  await prisma.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
