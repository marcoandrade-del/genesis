/**
 * Prova de DISPONIBILIDADE p/ restos a pagar (espírito do art. 42 da LRF), por
 * entidade — possível agora que o razão tem as pernas patrimoniais (PR 1) e a
 * abertura patrimonial está importada (PR 2):
 *
 *   disponibilidade = saldo inicial de caixa (SaldoInicialAno 1.1.1.*)
 *                   + fluxo do razão (D−C em 1.1.1.*)
 *   a pagar         = empenhado − pago (líquidos de estorno)
 *
 * ⚠ Leitura de MEIO de exercício: "a pagar" inclui empenho estimativo anual que
 * ainda vai liquidar — a prova formal do art. 42 é a de 31/12 (RAP inscrito).
 *
 *   npx tsx scripts/verificar_disponibilidade_rap.ts [--municipio=<nome>]
 */
import 'dotenv/config'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'

const alvo = process.argv.find((a) => a.startsWith('--municipio='))?.split('=')[1]
const ANO = 2026
const pool = new Pool({ connectionString: process.env['DATABASE_URL'] })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })
const R = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

async function main() {
  const rows: {
    municipio: string
    entidade: string
    inicial: unknown
    fluxo: unknown
    a_pagar: unknown
  }[] = await prisma.$queryRawUnsafe(`
    SELECT m.nome AS municipio, e.nome AS entidade,
      COALESCE((SELECT SUM(s.valor) FROM saldos_iniciais_ano s
        JOIN contas_contabil_entidade cc ON cc.id = s."contaId"
        WHERE s."entidadeId" = e.id AND s.ano = ${ANO} AND cc.codigo LIKE '1.1.1%'), 0) AS inicial,
      COALESCE((SELECT SUM(CASE WHEN li.tipo='DEBITO' THEN li.valor ELSE -li.valor END)
        FROM lancamento_itens li JOIN contas_contabil_entidade cc ON cc.id = li."contaId"
        WHERE cc."entidadeId" = e.id AND cc.codigo LIKE '1.1.1%'), 0) AS fluxo,
      COALESCE((SELECT SUM(CASE me.tipo
          WHEN 'EMPENHO' THEN me.valor WHEN 'ESTORNO_EMPENHO' THEN -me.valor
          WHEN 'PAGAMENTO' THEN -me.valor WHEN 'ESTORNO_PAGAMENTO' THEN me.valor ELSE 0 END)
        FROM movimentos_empenho me WHERE me."entidadeId" = e.id), 0) AS a_pagar
    FROM entidades e JOIN municipios m ON m.id = e."municipioId"
    ${alvo ? `WHERE m.nome = '${alvo.replace(/'/g, "''")}'` : `WHERE m.nome IN ('Maringá','Paranaguá','Paranaguá (SICONFI)','Criciúma','Cianorte','Naviraí','Vilhena','Sarandi')`}
    ORDER BY m.nome, e.nome`)
  let mun = ''
  for (const r of rows) {
    if (r.municipio !== mun) { mun = r.municipio; console.log(`\n═══ ${mun} ═══`) }
    const inicial = Number(r.inicial)
    const fluxo = Number(r.fluxo)
    const disp = inicial + fluxo
    const aPagar = Number(r.a_pagar)
    const cobre = disp >= aPagar
    console.log(`  ${r.entidade}`)
    console.log(`    disponibilidade ${R(disp)} (inicial ${R(inicial)} + fluxo ${R(fluxo)}) × a pagar ${R(aPagar)} → ${cobre ? 'COBRE ✓' : 'NÃO COBRE ✗'} (folga ${R(disp - aPagar)})`)
  }
}
main().catch((e) => { console.error('FALHOU:', e instanceof Error ? e.stack || e.message : e); process.exitCode = 1 }).finally(async () => { await prisma.$disconnect(); await pool.end() })
