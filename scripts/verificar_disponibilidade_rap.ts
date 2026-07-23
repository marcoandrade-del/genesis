/**
 * Prova de DISPONIBILIDADE p/ restos a pagar (espírito do art. 42 da LRF), por
 * entidade — possível agora que o razão tem as pernas patrimoniais (PR 1) e a
 * abertura patrimonial está importada (PR 2):
 *
 *   disponibilidade = saldo inicial de caixa (SaldoInicialAno 1.1.1.*)
 *                   + fluxo do razão (D−C em 1.1.1.*)
 *   a pagar         = empenhado − pago (líquidos de estorno)
 *
 * `--por-fonte`: a prova FORMAL do art. 42 é por DESTINAÇÃO de recursos —
 * disponibilidade da fonte ≥ obrigações da fonte. Agrupa em espaço STN:
 *   - fonte já STN (1500–1899/2500–2899, Criciúma/SICONFI) → direta;
 *   - STN com desdobramento de 8 dígitos (Vilhena/Naviraí) → primeiros 4;
 *   - local com de/para (`FonteRecursoEntidade.fonteStnCodigo`, Maringá) → converte;
 *   - resto (locais TCE sem de/para, 9999/0000) → balde SEM-DEPARA, quantificado
 *     (sem chute — popular o de/para é a correção, não adivinhar aqui).
 *
 * ⚠ Leitura de MEIO de exercício: "a pagar" inclui empenho estimativo anual que
 * ainda vai liquidar — a prova formal do art. 42 é a de 31/12 (RAP inscrito).
 *
 *   npx tsx scripts/verificar_disponibilidade_rap.ts [--municipio=<nome>] [--por-fonte]
 */
import 'dotenv/config'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'

const alvo = process.argv.find((a) => a.startsWith('--municipio='))?.split('=')[1]
const POR_FONTE = process.argv.includes('--por-fonte')
const ANO = 2026
const pool = new Pool({ connectionString: process.env['DATABASE_URL'] })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })
const R = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Fonte da entidade → STN (4 díg) ou null (sem conversão fiel). */
function paraStn(codigo: string, deParaLocal: Map<string, string | null>): string | null {
  const c = (codigo ?? '').trim()
  if (/^[12][5-8]\d{2}$/.test(c)) return c // já STN
  const d8 = c.replace(/\D/g, '')
  if (d8.length === 8 && /^[12][5-8]\d{2}$/.test(d8.slice(0, 4))) return d8.slice(0, 4) // STN c/ desdobramento
  return deParaLocal.get(c) ?? null // local com de/para; senão sem conversão
}

async function porFonte() {
  const ents: { municipio: string; entidade: string; id: string }[] = await prisma.$queryRawUnsafe(`
    SELECT m.nome AS municipio, e.nome AS entidade, e.id FROM entidades e JOIN municipios m ON m.id = e."municipioId"
    ${alvo ? `WHERE m.nome = '${alvo.replace(/'/g, "''")}'` : `WHERE m.nome IN ('Maringá','Paranaguá','Paranaguá (SICONFI)','Criciúma','Cianorte','Naviraí','Vilhena','Sarandi')`}
    ORDER BY m.nome, e.nome`)
  let mun = ''
  for (const e of ents) {
    const deParaLocal = new Map<string, string | null>(
      (
        await prisma.fonteRecursoEntidade.findMany({ where: { entidadeId: e.id, ano: ANO }, select: { codigo: true, fonteStnCodigo: true } })
      ).map((f) => [f.codigo.trim(), f.fonteStnCodigo]),
    )
    // por fonte STN: inicial (SaldoInicialCc 1.1.1) + fluxo (razão 1.1.1 cc fonte) − a pagar (dotação×fonte)
    const buckets = new Map<string, { inicial: number; fluxo: number; aPagar: number }>()
    const b = (k: string) => {
      if (!buckets.has(k)) buckets.set(k, { inicial: 0, fluxo: 0, aPagar: 0 })
      return buckets.get(k)!
    }
    const iniciais: { fonte: string; v: unknown }[] = await prisma.$queryRawUnsafe(
      `SELECT s."fonteCodigo" AS fonte, SUM(s.valor) AS v FROM saldos_iniciais_cc s
       JOIN contas_contabil_entidade cc ON cc.id = s."contaId"
       WHERE s."entidadeId" = $1 AND s.ano = ${ANO} AND cc.codigo LIKE '1.1.1%' GROUP BY 1`, e.id)
    for (const r of iniciais) b(paraStn(r.fonte, deParaLocal) ?? 'SEM-DEPARA').inicial += Number(r.v)
    const fluxos: { fonte: string | null; v: unknown }[] = await prisma.$queryRawUnsafe(
      `SELECT li."fonteCodigo" AS fonte, SUM(CASE WHEN li.tipo='DEBITO' THEN li.valor ELSE -li.valor END) AS v
       FROM lancamento_itens li JOIN contas_contabil_entidade cc ON cc.id = li."contaId"
       WHERE cc."entidadeId" = $1 AND cc.codigo LIKE '1.1.1%' GROUP BY 1`, e.id)
    for (const r of fluxos) b(paraStn(r.fonte ?? '', deParaLocal) ?? 'SEM-DEPARA').fluxo += Number(r.v)
    const aPagar: { fonte: string; v: unknown }[] = await prisma.$queryRawUnsafe(
      `SELECT f.codigo AS fonte, SUM(CASE me.tipo
          WHEN 'EMPENHO' THEN me.valor WHEN 'ESTORNO_EMPENHO' THEN -me.valor
          WHEN 'PAGAMENTO' THEN -me.valor WHEN 'ESTORNO_PAGAMENTO' THEN me.valor ELSE 0 END) AS v
       FROM movimentos_empenho me JOIN empenhos emp ON emp.id = me."empenhoId"
       JOIN dotacoes_despesa d ON d.id = emp."dotacaoDespesaId"
       JOIN fontes_recurso_entidade f ON f.id = d."fonteRecursoEntidadeId"
       WHERE me."entidadeId" = $1 GROUP BY 1`, e.id)
    for (const r of aPagar) b(paraStn(r.fonte, deParaLocal) ?? 'SEM-DEPARA').aPagar += Number(r.v)

    const linhas = [...buckets.entries()]
      .map(([fonte, x]) => ({ fonte, disp: x.inicial + x.fluxo, ...x, folga: x.inicial + x.fluxo - x.aPagar }))
      .filter((l) => Math.abs(l.disp) >= 0.01 || Math.abs(l.aPagar) >= 0.01)
    if (!linhas.length) continue
    if (e.municipio !== mun) { mun = e.municipio; console.log(`\n═══ ${mun} ═══`) }
    const insuf = linhas.filter((l) => l.fonte !== 'SEM-DEPARA' && l.folga < -0.01).sort((a, b2) => a.folga - b2.folga)
    const semDepara = linhas.find((l) => l.fonte === 'SEM-DEPARA')
    console.log(`  ${e.entidade} — ${linhas.length} fontes; insuficientes: ${insuf.length}`)
    for (const l of insuf.slice(0, 8)) {
      console.log(`    ✗ fonte ${l.fonte}: disp ${R(l.disp)} (ini ${R(l.inicial)} + flx ${R(l.fluxo)}) × a pagar ${R(l.aPagar)} → folga ${R(l.folga)}`)
    }
    if (semDepara) console.log(`    ⚠ SEM-DEPARA (locais sem conversão STN): disp ${R(semDepara.disp)} × a pagar ${R(semDepara.aPagar)}`)
  }
  console.log('\n(prova formal do art. 42 é por fonte em 31/12; fontes SEM-DEPARA precisam do de/para local→STN p/ entrar na prova)')
}

async function main() {
  if (POR_FONTE) return porFonte()
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
