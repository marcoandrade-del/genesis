/**
 * Re-materializa o RAZÃO (full) das entidades de um município — usado no rollout
 * das pernas PATRIMONIAIS (Dim II): limpa a execução e refaz o replay com
 * E300/E702/E802 além do orçamentário/controle.
 *
 * Verificação ao final, por entidade:
 *  - partida dobrada: ΣD − ΣC = 0
 *  - 6.2.1.2 (credor) = Σ arrecadado bruto (orçamentário intacto)
 *  - CAIXA (1.1.1.*): saldo = arrecadado LÍQUIDO − pago + transferências (evento
 *    900) — a identidade que passa a valer com o patrimonial materializado
 *    (sem saldo de abertura, que é o PR 2).
 *
 *   npx tsx scripts/rematerializar_razao.ts --municipio=<nome> [--apply]
 */
import 'dotenv/config'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient, Prisma } from '@prisma/client'
import { materializarRazao } from '../src/conversor/nucleo/materializar-razao.js'

const ANO = 2026
const APPLY = process.argv.includes('--apply')
const municipio = process.argv.find((a) => a.startsWith('--municipio='))?.split('=')[1]
if (!municipio) { console.error('uso: --municipio=<nome> [--apply]'); process.exit(1) }

const pool = new Pool({ connectionString: process.env['DATABASE_URL'] })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })
const R = (n: Prisma.Decimal | number) => Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const D = (x: unknown) => new Prisma.Decimal((x as string) ?? 0)

async function verificar(entidadeId: string): Promise<{ ok: boolean; linhas: string[] }> {
  const linhas: string[] = []
  const [pd]: { d: unknown; c: unknown }[] = await prisma.$queryRawUnsafe(
    `SELECT SUM(CASE WHEN li.tipo='DEBITO' THEN li.valor ELSE 0 END) AS d, SUM(CASE WHEN li.tipo='CREDITO' THEN li.valor ELSE 0 END) AS c
     FROM lancamento_itens li JOIN lancamentos l ON l.id = li."lancamentoId" WHERE l."entidadeId" = $1`, entidadeId)
  const dpd = D(pd?.d).minus(D(pd?.c))
  const okPd = dpd.isZero()
  linhas.push(`PD Δ ${R(dpd)} ${okPd ? '✓' : '✗'}`)

  const saldo = async (prefixo: string, credor: boolean): Promise<Prisma.Decimal> => {
    const [r]: { d: unknown; c: unknown }[] = await prisma.$queryRawUnsafe(
      `SELECT SUM(CASE WHEN li.tipo='DEBITO' THEN li.valor ELSE 0 END) AS d, SUM(CASE WHEN li.tipo='CREDITO' THEN li.valor ELSE 0 END) AS c
       FROM lancamento_itens li JOIN contas_contabil_entidade cc ON cc.id = li."contaId"
       WHERE cc."entidadeId" = $1 AND cc.codigo LIKE $2`, entidadeId, `${prefixo}%`)
    return credor ? D(r?.c).minus(D(r?.d)) : D(r?.d).minus(D(r?.c))
  }
  const [arr]: { bruto: unknown; liq: unknown }[] = await prisma.$queryRawUnsafe(
    `SELECT SUM(p."valorArrecadado") AS bruto, SUM(p."valorArrecadado" - COALESCE(p."valorDeduzido",0)) AS liq
     FROM previsoes_receita p JOIN orcamentos o ON o.id = p."orcamentoId" WHERE o."entidadeId" = $1 AND o.ano = ${ANO}`, entidadeId)
  const realizada = await saldo('6.2.1.2', true)
  const okArr = realizada.equals(D(arr?.bruto))
  linhas.push(`6.2.1.2 ${R(realizada)} = arrecadado bruto ${R(D(arr?.bruto))} ${okArr ? '✓' : '✗'}`)

  const [fluxo]: { pago: unknown; tf: unknown }[] = await prisma.$queryRawUnsafe(
    `SELECT (SELECT COALESCE(SUM(valor),0) FROM movimentos_empenho WHERE "entidadeId" = $1 AND tipo = 'PAGAMENTO') AS pago,
            (SELECT COALESCE(SUM(valor),0) FROM transferencias_financeiras WHERE "entidadeId" = $1) AS tf`, entidadeId)
  const caixa = await saldo('1.1.1', false)
  const esperado = D(arr?.liq).minus(D(fluxo?.pago)).plus(D(fluxo?.tf))
  const dCaixa = caixa.minus(esperado)
  // tolera resíduo do valor sem parâmetro (quantificado no de/para) — reporta sempre
  const okCaixa = dCaixa.abs().lt(0.01)
  linhas.push(`caixa ${R(caixa)} × (arrec líq − pago + TF) ${R(esperado)} → Δ ${R(dCaixa)} ${okCaixa ? '✓' : '⚠'}`)
  return { ok: okPd && okArr, linhas }
}

async function main() {
  console.log(`\n═══ Re-materialização do razão — ${municipio} ${ANO} ${APPLY ? '[APPLY]' : '[DRY-RUN]'} ═══`)
  const ents = await prisma.entidade.findMany({
    where: { municipio: { is: { nome: municipio } } },
    select: { id: true, nome: true },
    orderBy: { nome: 'asc' },
  })
  if (!ents.length) { console.error(`município '${municipio}' sem entidades`); process.exitCode = 1; return }
  const usuario = await prisma.usuario.findFirstOrThrow({ orderBy: { criadoEm: 'asc' }, select: { id: true } })

  for (const e of ents) {
    if (APPLY) {
      const t0 = Date.now()
      const r = await materializarRazao(prisma, e.id, ANO, usuario.id)
      console.log(`\n${e.nome}: ${r.arrecadacoes} arrec + ${r.movimentos} movimentos (${Math.round((Date.now() - t0) / 1000)}s)`)
    } else {
      console.log(`\n${e.nome}: (dry-run — só verificação do estado atual)`)
    }
    const v = await verificar(e.id)
    for (const l of v.linhas) console.log(`  ${l}`)
    if (APPLY && !v.ok) { console.error('  ✗ VERIFICAÇÃO FALHOU — parando.'); process.exitCode = 1; return }
  }
  if (!APPLY) console.log('\nDRY-RUN. Rode com --apply para re-materializar.')
}
main().catch((e) => { console.error('FALHOU:', e instanceof Error ? e.stack || e.message : e); process.exitCode = 1 }).finally(async () => { await prisma.$disconnect(); await pool.end() })
