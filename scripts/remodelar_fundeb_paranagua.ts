/**
 * FUNDEB do Paranaguá IPM → modelo CANÔNICO (E150, espelho de Maringá).
 *
 * ANTES (modelagem do import): dedução FUNDEB como previsão REDUTORA separada
 * (natureza 9.7.1.0, prev −68.814.800,00 / arr −36.842.062,44) materializada como
 * ESTORNO — líquida certa, mas sem o controle contábil da dedução (6.2.1.3.1.01)
 * nem a bruta por natureza.
 *
 * DADO REAL (balanço IPM `Relatorio (3).xlsx`, linhas "9…" por natureza-base):
 *   FPM −31.720.000,00/−17.830.333,96 · ITR −10.000,00/−1.175,50 (→ base 1.7.1)
 *   ICMS −30.840.000,00/−14.775.899,43 · IPVA −5.780.000,00/−4.015.059,91 ·
 *   IPI −464.800,00/−219.593,64 (→ base 1.7.2)
 *   Σ = −68.814.800,00 prev / −36.842.062,44 arr = EXATAMENTE a linha 9.7.1.0 ✓
 *
 * DEPOIS (semântica canônica, igual Maringá):
 *   - valorPrevisto da linha = LÍQUIDO + valorDeducaoPrevisto (abertura soma p/ BRUTA);
 *   - valorArrecadado da linha = BRUTO + valorDeduzido;
 *   - Arrecadacao: ARRECADACAO = líquido recebido + DEDUCAO/FUNDEB = a dedução
 *     (o E150 completa 6.2.1.2 até a bruta e destaca 6.2.1.3.1.01);
 *   - a previsão redutora 9.7.1.0 SAI (e a conta órfã).
 *   Totais preservados: prevista líquida 1.282.085.954,72 e arrecadada líquida
 *   624.757.427,09 NÃO mudam (viram derivadas: valor − dedução).
 *
 * Depois re-materializa: limpa execução → estorna abertura → materializarRazao
 * (abertura BRUTA + replay E100/E150 + despesa). Dry-run por padrão.
 *   npx tsx scripts/remodelar_fundeb_paranagua.ts [--apply]
 */
import 'dotenv/config'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient, Prisma } from '@prisma/client'
import { LancamentosService } from '../src/services/lancamentos.js'
import { AberturaContabilService } from '../src/services/abertura-contabil.js'
import { materializarRazao } from '../src/conversor/nucleo/materializar-razao.js'

const ANO = 2026
const APPLY = process.argv.includes('--apply')
const HIST = 'CAPTURA ARRECADAÇÃO (conversor)'
const F = (n: number | Prisma.Decimal) => Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// dedução FUNDEB por linha-base do dev (3º nível), do balanço IPM (dado real):
const FUNDEB = [
  { natureza: '1.7.1.0.00.0.0.00.00.00.00.00', dedPrev: '31730000.00', dedArr: '17831509.46' }, // FPM + ITR
  { natureza: '1.7.2.0.00.0.0.00.00.00.00.00', dedPrev: '37084800.00', dedArr: '19010552.98' }, // ICMS + IPVA + IPI
]
const REDUTORA = '9.7.1.0.00.0.0.00.00.00.00.00'

const pool = new Pool({ connectionString: process.env['DATABASE_URL'] })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

async function main() {
  console.log(`\n═══ Remodelagem FUNDEB — Paranaguá IPM ${APPLY ? '[APPLY]' : '[DRY-RUN]'} ═══`)
  const ent = await prisma.entidade.findFirstOrThrow({
    where: { nome: 'Prefeitura Municipal de Paranaguá', municipio: { is: { nome: 'Paranaguá', estado: { is: { sigla: 'PR' } } } } },
    select: { id: true, nome: true },
  })
  const usuario = await prisma.usuario.findFirstOrThrow({ orderBy: { criadoEm: 'asc' }, select: { id: true } })

  // carrega as 3 previsões envolvidas
  const bases = []
  for (const f of FUNDEB) {
    const p = await prisma.previsaoReceita.findFirst({
      where: { orcamento: { entidadeId: ent.id, ano: ANO }, contaReceita: { codigo: f.natureza } },
      select: { id: true, valorPrevisto: true, valorArrecadado: true, contaReceita: { select: { codigo: true } }, arrecadacoes: { select: { id: true, tipo: true, valor: true } } },
    })
    if (!p) throw new Error(`Previsão base ${f.natureza} não encontrada`)
    bases.push({ ...f, p })
  }
  const red = await prisma.previsaoReceita.findFirst({
    where: { orcamento: { entidadeId: ent.id, ano: ANO }, contaReceita: { codigo: REDUTORA } },
    select: { id: true, valorPrevisto: true, valorArrecadado: true, contaReceitaEntidadeId: true, arrecadacoes: { select: { id: true } } },
  })

  console.log(`\n${ent.nome}`)
  for (const b of bases) {
    const liqPrev = new Prisma.Decimal(b.p.valorPrevisto).minus(b.dedPrev)
    const liqArr = new Prisma.Decimal(b.p.valorArrecadado).minus(b.dedArr)
    console.log(`  ${b.natureza.slice(0, 12)}: previsto ${F(b.p.valorPrevisto)} → líquido ${F(liqPrev)} + dedPrev ${F(Number(b.dedPrev))}`)
    console.log(`    arrecadado ${F(b.p.valorArrecadado)} (bruto, mantém) · ARRECADACAO vira líquida ${F(liqArr)} + DEDUCAO/FUNDEB ${F(Number(b.dedArr))}`)
  }
  console.log(`  redutora 9.7.1.0: ${red ? `prev ${F(red.valorPrevisto)} arr ${F(red.valorArrecadado)} → REMOVIDA` : 'já removida (idempotente)'}`)

  if (!APPLY) { console.log('\nDRY-RUN: nada gravado. Rode com --apply.'); return }

  // 1) remodela previsões + arrecadações numa transação
  await prisma.$transaction(async (tx) => {
    for (const b of bases) {
      const liqPrev = new Prisma.Decimal(b.p.valorPrevisto).minus(b.dedPrev)
      const liqArr = new Prisma.Decimal(b.p.valorArrecadado).minus(b.dedArr)
      await tx.previsaoReceita.update({
        where: { id: b.p.id },
        data: { valorPrevisto: liqPrev.toFixed(2), valorDeducaoPrevisto: b.dedPrev, valorDeduzido: b.dedArr },
      })
      // recria as Arrecadacao da base: 1 líquida + 1 dedução (IDs novos — o full razão regenera tudo)
      await tx.arrecadacao.deleteMany({ where: { previsaoId: b.p.id } })
      await tx.arrecadacao.createMany({
        data: [
          { previsaoId: b.p.id, tipo: 'ARRECADACAO', data: new Date(Date.UTC(ANO, 11, 31)), valor: liqArr.toFixed(2), historico: HIST },
          { previsaoId: b.p.id, tipo: 'DEDUCAO', deducaoTipo: 'FUNDEB', data: new Date(Date.UTC(ANO, 11, 31)), valor: b.dedArr, historico: HIST },
        ],
      })
    }
    if (red) {
      await tx.arrecadacao.deleteMany({ where: { previsaoId: red.id } })
      await tx.previsaoReceita.delete({ where: { id: red.id } })
      // conta redutora órfã (artefato da modelagem antiga): remove se sem outras previsões
      const outras = await tx.previsaoReceita.count({ where: { contaReceitaEntidadeId: red.contaReceitaEntidadeId } })
      if (outras === 0) await tx.contaReceitaEntidade.delete({ where: { id: red.contaReceitaEntidadeId } }).catch(() => {})
    }
  })
  console.log('  ✓ previsões/arrecadações remodeladas')

  // 2) limpa execução + estorna abertura + re-materializa (abertura BRUTA + E100/E150)
  const lancs = new LancamentosService(prisma)
  const antigos = await prisma.lancamento.findMany({ where: { entidadeId: ent.id, origemTipo: { in: ['ARRECADACAO', 'EMPENHO', 'LIQUIDACAO', 'PAGAMENTO'] } }, select: { id: true } })
  console.log(`  limpando ${antigos.length} lançamentos de execução...`)
  for (const l of antigos) await lancs.excluir(l.id)
  await new AberturaContabilService(prisma).estornar(ent.id, ANO, usuario.id)
  console.log('  ✓ abertura estornada')
  const raz = await materializarRazao(prisma, ent.id, ANO, usuario.id)
  console.log(`  ✓ razão: abertura + ${raz.arrecadacoes} arrec + ${raz.movimentos} movimentos`)

  // 3) verificação ao centavo
  async function credor(pfx: string) {
    const g = await prisma.lancamentoItem.groupBy({ by: ['tipo'], where: { conta: { entidadeId: ent.id, codigo: { startsWith: pfx } } }, _sum: { valor: true } })
    return new Prisma.Decimal(g.find((x) => x.tipo === 'CREDITO')?._sum.valor ?? 0).minus(new Prisma.Decimal(g.find((x) => x.tipo === 'DEBITO')?._sum.valor ?? 0))
  }
  const agg = await prisma.previsaoReceita.aggregate({ where: { orcamento: { entidadeId: ent.id } }, _sum: { valorPrevisto: true, valorArrecadado: true, valorDeduzido: true, valorDeducaoPrevisto: true } })
  const rr = await credor('6.2.1.2')
  const ded = (await credor('6.2.1.3.1.01')).negated() // devedora
  const g = await prisma.lancamentoItem.groupBy({ by: ['tipo'], where: { conta: { entidadeId: ent.id } }, _sum: { valor: true } })
  const D = new Prisma.Decimal(g.find((x) => x.tipo === 'DEBITO')?._sum.valor ?? 0)
  const C = new Prisma.Decimal(g.find((x) => x.tipo === 'CREDITO')?._sum.valor ?? 0)
  const ok = (a: Prisma.Decimal, b: Prisma.Decimal | string) => a.minus(new Prisma.Decimal(b)).abs().lte(new Prisma.Decimal('0.02'))
  const va = new Prisma.Decimal(agg._sum.valorArrecadado ?? 0)
  const vd = new Prisma.Decimal(agg._sum.valorDeduzido ?? 0)
  const vp = new Prisma.Decimal(agg._sum.valorPrevisto ?? 0)
  console.log(`\nVERIFICAÇÃO:`)
  console.log(`  PD Δ ${F(D.minus(C))} ${D.minus(C).abs().lte(new Prisma.Decimal('0.01')) ? '✓' : '✗'}`)
  console.log(`  6.2.1.2 (bruta) ${F(rr)} = Σ valorArrecadado ${F(va)} ${ok(rr, va) ? '✓' : '✗'}`)
  console.log(`  6.2.1.3.1.01 (dedução FUNDEB) ${F(ded)} = Σ valorDeduzido ${F(vd)} ${ok(ded, vd) && ok(ded, '36842062.44') ? '✓ (=36.842.062,44)' : '✗'}`)
  console.log(`  líquida derivada ${F(rr.minus(ded))} (esperado 624.757.427,09) ${ok(rr.minus(ded), '624757427.09') ? '✓' : '✗'}`)
  console.log(`  Σ valorPrevisto (líquida) ${F(vp)} (esperado 1.282.085.954,72) ${ok(vp, '1282085954.72') ? '✓' : '✗'}`)
}
main().catch((e) => { console.error('FALHOU:', e instanceof Error ? e.stack || e.message : e); process.exitCode = 1 }).finally(async () => { await prisma.$disconnect(); await pool.end() })
