/**
 * Backfill da razão imutável da execução da despesa (`movimentos_empenho`) a
 * partir do estado ATUAL de empenhos/liquidações/ordens de pagamento.
 *
 * Por que existe: o modelo novo (Specs 22-06-2026 §8) registra cada lançamento da
 * execução como uma linha imutável na razão, e estorno é lançamento em coluna à
 * parte. Os dados legados usam flip de status + decremento de contador; este
 * script reconstrói a razão equivalente, sem perder histórico.
 *
 * Mapeamento (modelo legado é all-or-nothing — não há estorno parcial):
 *   - Empenho            → EMPENHO (valor, data). Se status=ANULADO → + ESTORNO_EMPENHO (valor, atualizadoEm).
 *   - Liquidacao         → LIQUIDACAO (valor, data, liquidacaoId). Se CANCELADA → + ESTORNO_LIQUIDACAO.
 *   - OrdemPagamento     → PAGAMENTO (valor, data, liquidacaoId, ordemPagamentoId) p/ EMITIDA|PAGA
 *                          (no legado `valorPago` é incrementado já na emissão).
 *                          Se CANCELADA → PAGAMENTO + ESTORNO_PAGAMENTO (preserva o bruto; net 0).
 *
 * `criadoPorId='BACKFILL'` marca as linhas reconstruídas. Idempotente: com --apply,
 * apaga as linhas BACKFILL antes de reconstruir (não toca movimentos de usuário).
 *
 * Rodar:
 *   npx tsx scripts/backfill_movimentos_empenho.ts            # dry-run (não grava)
 *   npx tsx scripts/backfill_movimentos_empenho.ts --apply    # grava
 */

import 'dotenv/config'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient, type TipoMovimentoEmpenho } from '@prisma/client'

const APPLY = process.argv.includes('--apply')
const BACKFILL = 'BACKFILL'

const pool = new Pool({ connectionString: process.env['DATABASE_URL'] })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

console.log(`Backfill movimentos_empenho — modo: ${APPLY ? 'APPLY (vai gravar)' : 'DRY-RUN (não grava)'}\n`)

type Linha = {
  entidadeId: string
  empenhoId: string
  tipo: TipoMovimentoEmpenho
  valor: import('@prisma/client').Prisma.Decimal
  data: Date
  liquidacaoId: string | null
  ordemPagamentoId: string | null
  historico: string
  criadoPorId: string
}

const empenhos = await prisma.empenho.findMany({
  include: {
    liquidacoes: { include: { ordensPagamento: true } },
  },
})

const linhas: Linha[] = []
const push = (l: Omit<Linha, 'criadoPorId' | 'historico'> & { historico: string }) =>
  linhas.push({ ...l, criadoPorId: BACKFILL })

for (const e of empenhos) {
  push({ entidadeId: e.entidadeId, empenhoId: e.id, tipo: 'EMPENHO', valor: e.valor, data: e.data, liquidacaoId: null, ordemPagamentoId: null, historico: `backfill empenho ${e.numero}` })
  if (e.status === 'ANULADO') {
    push({ entidadeId: e.entidadeId, empenhoId: e.id, tipo: 'ESTORNO_EMPENHO', valor: e.valor, data: e.atualizadoEm, liquidacaoId: null, ordemPagamentoId: null, historico: `backfill anulação empenho ${e.numero}` })
  }
  for (const l of e.liquidacoes) {
    push({ entidadeId: e.entidadeId, empenhoId: e.id, tipo: 'LIQUIDACAO', valor: l.valor, data: l.data, liquidacaoId: l.id, ordemPagamentoId: null, historico: `backfill liquidação ${l.numero}` })
    if (l.status === 'CANCELADA') {
      push({ entidadeId: e.entidadeId, empenhoId: e.id, tipo: 'ESTORNO_LIQUIDACAO', valor: l.valor, data: l.atualizadoEm, liquidacaoId: l.id, ordemPagamentoId: null, historico: `backfill cancelamento liquidação ${l.numero}` })
    }
    for (const op of l.ordensPagamento) {
      push({ entidadeId: e.entidadeId, empenhoId: e.id, tipo: 'PAGAMENTO', valor: op.valor, data: op.data, liquidacaoId: l.id, ordemPagamentoId: op.id, historico: `backfill pagamento ${op.numero}` })
      if (op.status === 'CANCELADA') {
        push({ entidadeId: e.entidadeId, empenhoId: e.id, tipo: 'ESTORNO_PAGAMENTO', valor: op.valor, data: op.atualizadoEm, liquidacaoId: l.id, ordemPagamentoId: op.id, historico: `backfill cancelamento pagamento ${op.numero}` })
      }
    }
  }
}

const porTipo = linhas.reduce<Record<string, number>>((acc, l) => ((acc[l.tipo] = (acc[l.tipo] ?? 0) + 1), acc), {})
console.log(`Empenhos: ${empenhos.length}   movimentos a reconstruir: ${linhas.length}`)
for (const [t, n] of Object.entries(porTipo)) console.log(`  ${t}: ${n}`)

if (!APPLY) {
  console.log('\nDRY-RUN — nada gravado. Rode com --apply para gravar.')
  await pool.end()
  process.exit(0)
}

const apagados = await prisma.movimentoEmpenho.deleteMany({ where: { criadoPorId: BACKFILL } })
const criados = linhas.length ? await prisma.movimentoEmpenho.createMany({ data: linhas }) : { count: 0 }
console.log(`\nAPPLY — apagados ${apagados.count} BACKFILL antigos, criados ${criados.count}.`)
await pool.end()
