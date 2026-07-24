/**
 * MENSALIZA a execução da despesa dos municípios SICONFI-sourced (Criciúma e
 * Paranaguá (SICONFI)) — os MovimentoEmpenho de captura (empenhos CAP-*) levam
 * data fixa 31/12 (mesmo achado da receita, épico MENSALIZAÇÃO A2a).
 *
 * Fonte mensal REAL: MSC oficial, classe 6, contas 6.2.2.1.3.x por
 * (poder, função, subfunção, natureza-modalidade, fonte) — a MESMA célula de
 * onde as dotações destes municípios NASCERAM (match 1:1 por construção).
 * Fases por combinação de ending_balance: empenhado = .01+.02+.03 ·
 * liquidado = .02+.03 · pago = .03. Delta mensal negativo vira ESTORNO_<fase>.
 * Resíduo (alvo do dev − Σ mensal) datado de HOJE, histórico explícito.
 *
 * GATE por dotação e por fase: Σ das linhas novas = Σ das linhas CAP atuais AO
 * CENTAVO (totais intocados; só a distribuição temporal muda). Só toca
 * movimentos de empenhos CAP-* (marcador do conversor). Depois re-materializa
 * o razão. Idempotente.
 *
 *   npx tsx scripts/mensalizar_despesa_msc.ts --municipio=<nome|todos> [--apply]
 */
import 'dotenv/config'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient, Prisma } from '@prisma/client'
import { baixarMsc, fonteMsc, naturezaDespesaMsc, type LinhaMsc } from '../src/conversor/siconfi/api.js'
import { materializarRazao } from '../src/conversor/nucleo/materializar-razao.js'
import type { MunicipioConfig } from '../src/conversor/nucleo/tipos.js'
import { criciumaSc } from '../src/conversor/municipios/criciuma-sc.js'
import { paranaguaSiconfi } from '../src/conversor/municipios/paranagua-pr-siconfi.js'

const APPLY = process.argv.includes('--apply')
const ANO = 2026
const alvoArg = process.argv.find((a) => a.startsWith('--municipio='))?.split('=')[1]
if (!alvoArg) { console.error('uso: --municipio=<nome|todos> [--apply]'); process.exit(1) }

const CONFIGS: [string, MunicipioConfig][] = [['Criciúma', criciumaSc], ['Paranaguá (SICONFI)', paranaguaSiconfi]]

const pool = new Pool({ connectionString: process.env['DATABASE_URL'] })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })
const R = (c: number) => (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 })
const ultimoDia = (mes: number) => new Date(Date.UTC(ANO, mes, 0))

type Fases = { emp: number; liq: number; pag: number }
type Celula = Map<number, Fases> // mês → YTD (centavos)

/** Células (po|função|subfunção|natureza-modalidade|fonte) → YTD por mês/fase. */
async function celulasMsc(ibge: string): Promise<{ meses: number[]; celulas: Map<string, Celula> }> {
  const celulas = new Map<string, Celula>()
  const meses: number[] = []
  for (let m = 1; m <= 12; m++) {
    let linhas: LinhaMsc[] = []
    try { linhas = await baixarMsc({ ibge, ano: ANO, mes: m, classe: '6' }) } catch { /* não homologado */ }
    const exec = linhas.filter((l) => l.conta_contabil.startsWith('62213'))
    if (!exec.length) continue
    meses.push(m)
    for (const l of exec) {
      const sub = l.conta_contabil.slice(5, 7) // 01=a liquidar · 02=em liquidação · 03=liquidado a pagar · 04=pago
      if (!['01', '02', '03', '04'].includes(sub)) continue
      const k = [l.poder_orgao, Number(l.funcao ?? 0), Number(l.subfuncao ?? 0), naturezaDespesaMsc(l.natureza_despesa, 'modalidade'), fonteMsc(l.fonte_recursos)].join('|')
      const c = celulas.get(k) ?? new Map<number, Fases>()
      const f = c.get(m) ?? { emp: 0, liq: 0, pag: 0 }
      const v = Math.round((l.natureza_conta === 'C' ? l.valor : -l.valor) * 100)
      f.emp += v // empenhado = .01+.02+.03+.04
      if (sub === '03' || sub === '04') f.liq += v
      if (sub === '04') f.pag += v
      c.set(m, f)
      celulas.set(k, c)
    }
  }
  return { meses, celulas }
}

async function mensalizarMunicipio(nomeDev: string, cfg: MunicipioConfig): Promise<void> {
  console.log(`\n═══ ${nomeDev} (IBGE ${cfg.ibge}) ${APPLY ? '[APPLY]' : '[DRY-RUN]'} ═══`)
  const { meses, celulas } = await celulasMsc(cfg.ibge)
  if (!meses.length) { console.log('  MSC classe 6 vazia — nada a mensalizar.'); return }
  console.log(`  MSC meses homologados: ${meses.join(',')} · células de execução: ${celulas.size}`)
  const ultimoMes = meses[meses.length - 1]!
  const hoje = new Date(new Date().toISOString().slice(0, 10))
  const usuario = await prisma.usuario.findFirstOrThrow({ orderBy: { criadoEm: 'asc' }, select: { id: true } })

  for (const entCfg of cfg.entidades) {
    const po = entCfg.matchSiconfi
    if (!po) continue
    const ent = await prisma.entidade.findFirst({ where: { nome: entCfg.nome, municipio: { is: { nome: nomeDev } } }, select: { id: true, nome: true } })
    if (!ent) { console.log(`  ${entCfg.nome}: não está no dev — pulada`); continue }

    // dotações com empenho CAP-* + Σ atual por fase (líquida de estornos)
    const dots: { id: string; empenhoId: string; funcao: string; subfuncao: string; nat: string; fonte: string; emp: number | null; liq: number | null; pag: number | null }[] =
      await prisma.$queryRawUnsafe(`
        SELECT d.id, em.id AS "empenhoId", fu.codigo AS funcao, sf.codigo AS subfuncao, cd.codigo AS nat, f.codigo AS fonte,
          SUM(CASE mv.tipo WHEN 'EMPENHO' THEN mv.valor WHEN 'ESTORNO_EMPENHO' THEN -mv.valor END)::float AS emp,
          SUM(CASE mv.tipo WHEN 'LIQUIDACAO' THEN mv.valor WHEN 'ESTORNO_LIQUIDACAO' THEN -mv.valor END)::float AS liq,
          SUM(CASE mv.tipo WHEN 'PAGAMENTO' THEN mv.valor WHEN 'ESTORNO_PAGAMENTO' THEN -mv.valor END)::float AS pag
        FROM dotacoes_despesa d
        JOIN orcamentos o ON o.id = d."orcamentoId" AND o.ano = ${ANO} AND o."entidadeId" = '${ent.id}'
        JOIN funcoes fu ON fu.id = d."funcaoId" JOIN subfuncoes sf ON sf.id = d."subfuncaoId"
        JOIN contas_despesa_entidade cd ON cd.id = d."contaDespesaEntidadeId"
        JOIN fontes_recurso_entidade f ON f.id = d."fonteRecursoEntidadeId"
        JOIN empenhos em ON em."dotacaoDespesaId" = d.id AND em.numero LIKE 'CAP-%'
        JOIN movimentos_empenho mv ON mv."empenhoId" = em.id
        GROUP BY 1,2,3,4,5,6`)

    // candidato único por célula
    const porChave = new Map<string, typeof dots>()
    for (const d of dots) {
      const k = [po, Number(d.funcao), Number(d.subfuncao), d.nat, d.fonte.trim()].join('|')
      porChave.set(k, [...(porChave.get(k) ?? []), d])
    }
    type Nova = { empenhoId: string; tipo: string; data: Date; valor: number; historico: string }
    const novas: Nova[] = []
    const empenhosTocados: string[] = []
    const stats = { ok: 0, okValor: 0, amb: 0, ambValor: 0, semCel: 0, semCelValor: 0 }

    for (const [k, cands] of porChave) {
      const alvoEmp = cands.reduce((s, d) => s + Math.round((d.emp ?? 0) * 100), 0)
      if (cands.length > 1) { stats.amb += cands.length; stats.ambValor += alvoEmp; continue }
      const d = cands[0]!
      const cel = celulas.get(k)
      if (!cel) { stats.semCel++; stats.semCelValor += alvoEmp; continue }
      const alvo: Fases = { emp: Math.round((d.emp ?? 0) * 100), liq: Math.round((d.liq ?? 0) * 100), pag: Math.round((d.pag ?? 0) * 100) }

      const porFase: [keyof Fases, string, string][] = [['emp', 'EMPENHO', 'ESTORNO_EMPENHO'], ['liq', 'LIQUIDACAO', 'ESTORNO_LIQUIDACAO'], ['pag', 'PAGAMENTO', 'ESTORNO_PAGAMENTO']]
      const geradas: Nova[] = []
      for (const [fase, tipo, estorno] of porFase) {
        let acc = 0
        let soma = 0
        for (const m of meses) {
          const y = cel.get(m)?.[fase] ?? acc
          const delta = y - acc
          acc = y
          if (!delta) continue
          geradas.push({ empenhoId: d.empenhoId, tipo: delta > 0 ? tipo : estorno, data: ultimoDia(m), valor: Math.abs(delta), historico: `CAPTURA EXECUÇÃO (mensal MSC ${ANO})` })
          soma += delta
        }
        const res = alvo[fase] - soma
        if (res) geradas.push({ empenhoId: d.empenhoId, tipo: res > 0 ? tipo : estorno, data: hoje, valor: Math.abs(res), historico: `CAPTURA EXECUÇÃO (resíduo pós-MSC mês ${ultimoMes})` })
        // GATE por fase
        const g = geradas.filter((n) => n.tipo === tipo || n.tipo === estorno).reduce((s, n) => s + (n.tipo === tipo ? n.valor : -n.valor), 0)
        if (g !== alvo[fase]) throw new Error(`GATE interno falhou (${k} fase ${fase}): ${g} ≠ ${alvo[fase]}`)
      }
      novas.push(...geradas)
      empenhosTocados.push(d.empenhoId)
      stats.ok++
      stats.okValor += alvo.emp
    }

    console.log(`  ${ent.nome}: mensalizáveis 1:1 ${stats.ok} dotações (Σ empenhado ${R(stats.okValor)})` +
      (stats.amb ? ` · ⚠ ambíguas ${stats.amb} (Σ ${R(stats.ambValor)})` : '') +
      (stats.semCel ? ` · ⚠ sem célula ${stats.semCel} (Σ ${R(stats.semCelValor)})` : ''))
    if (!APPLY || !empenhosTocados.length) continue

    await prisma.$transaction(
      async (tx) => {
        await tx.movimentoEmpenho.deleteMany({ where: { empenhoId: { in: empenhosTocados } } })
        await tx.movimentoEmpenho.createMany({
          data: novas.map((n) => ({
            entidadeId: ent.id, empenhoId: n.empenhoId, tipo: n.tipo as never, data: n.data,
            valor: new Prisma.Decimal(n.valor).div(100).toFixed(2), criadoPorId: usuario.id, historico: n.historico,
          })),
        })
      },
      { timeout: 300_000 },
    )
    console.log(`    ✓ ${empenhosTocados.length} empenhos CAP re-datados → ${novas.length} movimentos mensais+resíduo`)
    const raz = await materializarRazao(prisma, ent.id, ANO, usuario.id)
    console.log(`    ✓ razão re-materializado: ${raz.arrecadacoes} arrec + ${raz.movimentos} movimentos`)
  }

  if (APPLY) {
    const perfil: { mes: number; v: number }[] = await prisma.$queryRawUnsafe(`
      SELECT EXTRACT(MONTH FROM mv.data)::int AS mes,
        SUM(CASE mv.tipo WHEN 'EMPENHO' THEN mv.valor WHEN 'ESTORNO_EMPENHO' THEN -mv.valor ELSE 0 END)::float AS v
      FROM movimentos_empenho mv JOIN empenhos em ON em.id = mv."empenhoId"
      JOIN entidades e ON e.id = em."entidadeId" JOIN municipios m ON m.id = e."municipioId"
      WHERE m.nome = '${nomeDev.replace(/'/g, "''")}' AND em.numero LIKE 'CAP-%'
      GROUP BY 1 ORDER BY 1`)
    console.log(`  perfil mensal do empenhado (mi): ${perfil.map((r) => `${r.mes}:${Math.round(r.v / 1e6)}`).join(' ')}`)
    const quebradas: { n: number }[] = await prisma.$queryRawUnsafe(`
      SELECT COUNT(*)::int AS n FROM dotacoes_despesa d
      JOIN orcamentos o ON o.id = d."orcamentoId" AND o.ano = ${ANO}
      JOIN entidades e ON e.id = o."entidadeId" JOIN municipios m ON m.id = e."municipioId"
      WHERE m.nome = '${nomeDev.replace(/'/g, "''")}' AND d."valorEmpenhado" <> 0
        AND ABS(COALESCE((SELECT SUM(CASE mv.tipo WHEN 'EMPENHO' THEN mv.valor WHEN 'ESTORNO_EMPENHO' THEN -mv.valor ELSE 0 END)
          FROM movimentos_empenho mv JOIN empenhos em2 ON em2.id = mv."empenhoId"
          WHERE em2."dotacaoDespesaId" = d.id AND em2.numero LIKE 'CAP-%'), 0) - d."valorEmpenhado") > 0.01`)
    console.log(quebradas[0]!.n === 0
      ? '  ✓ verificação: Σ movimentos CAP = valorEmpenhado em todas as dotações'
      : `  ⚠ ${quebradas[0]!.n} dotações com Σ movimentos ≠ valorEmpenhado — conferir`)
  }
}

async function main() {
  const escolhidos = alvoArg === 'todos' ? CONFIGS : CONFIGS.filter(([n]) => n === alvoArg)
  if (!escolhidos.length) { console.error(`município '${alvoArg}' fora do escopo (${CONFIGS.map(([n]) => n).join(' · ')} | todos)`); process.exitCode = 1; return }
  for (const [nome, cfg] of escolhidos) await mensalizarMunicipio(nome, cfg)
  if (!APPLY) console.log('\nDRY-RUN: nada gravado. Rode com --apply.')
}
main().catch((e) => { console.error('FALHOU:', e instanceof Error ? e.stack || e.message : e); process.exitCode = 1 }).finally(async () => { await prisma.$disconnect(); await pool.end() })
