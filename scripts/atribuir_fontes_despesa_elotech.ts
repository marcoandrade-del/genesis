/**
 * Atribui FONTE REAL às dotações "9999" dos municípios Elotech (o portal não
 * publica fonte por dotação) usando a MSC oficial do SICONFI — SÓ ATRIBUIÇÃO
 * EXATA, sem rateio:
 *
 *   Regra única (fase A): se o grupo (poder × função × subfunção × natureza no
 *   ELEMENTO) tem UMA ÚNICA fonte na dotação da MSC (classe 5, contas 5.2.2.*),
 *   todas as dotações 9999 do grupo recebem essa fonte. Imune ao timing
 *   portal×MSC (a fonte da fixação não depende de valores). Grupos multi-fonte
 *   ficam 9999 — QUANTIFICADOS (o split exige mesmo-snapshot ou empenho a
 *   empenho; fila).
 *
 * NENHUM valor muda — o script prova Σ autorizado/empenhado por entidade
 * inalterado. Depois do apply, re-materializar o razão (a abertura e o cc de
 * fonte dos lançamentos derivam da dotação):
 *   npx tsx scripts/rematerializar_razao.ts --municipio=<X> --apply
 * (a abertura é estornada aqui p/ o ciclo recontabilizar com o cc novo)
 *
 *   npx tsx scripts/atribuir_fontes_despesa_elotech.ts --municipio=<nome> [--apply]
 */
import 'dotenv/config'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import { baixarMsc, naturezaDespesaMsc, fonteMsc } from '../src/conversor/siconfi/api.js'
import { AberturaContabilService } from '../src/services/abertura-contabil.js'

const APPLY = process.argv.includes('--apply')
const ANO = 2026
const alvo = process.argv.find((a) => a.startsWith('--municipio='))?.split('=')[1]
if (!alvo) { console.error('uso: --municipio=<nome> [--apply]'); process.exit(1) }

const IBGE: Record<string, string> = { Cianorte: '4105508', Naviraí: '5005707', Vilhena: '1100304', Sarandi: '4126256' }
const pool = new Pool({ connectionString: process.env['DATABASE_URL'] })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })
const R = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 2 })

/** Descrição STN padrão da fonte (da própria MSC não vem; usa a da fonte 8-díg da receita se existir). */
async function nomeFonte(municipioNome: string, stn: string): Promise<string> {
  const f: { nomenclatura: string }[] = await prisma.$queryRawUnsafe(
    `SELECT f.nomenclatura FROM fontes_recurso_entidade f
     JOIN entidades e ON e.id = f."entidadeId" JOIN municipios m ON m.id = e."municipioId"
     WHERE m.nome = $1 AND (f.codigo = $2 OR f.codigo LIKE $3) LIMIT 1`, municipioNome, stn, `${stn}%`)
  return f[0]?.nomenclatura ?? `Fonte STN ${stn}`
}

async function main() {
  const ibge = IBGE[alvo!]
  if (!ibge) { console.error(`município '${alvo}' fora do escopo Elotech (${Object.keys(IBGE).join(' · ')})`); process.exitCode = 1; return }
  console.log(`\n═══ Fontes da despesa via MSC — ${alvo} (IBGE ${ibge}) ${APPLY ? '[APPLY]' : '[DRY-RUN]'} ═══`)

  // MSC classe 5 (dotação por fonte), último mês homologado
  let c5: Awaited<ReturnType<typeof baixarMsc>> = []
  let mes = 0
  for (let m = 12; m >= 1; m--) { c5 = await baixarMsc({ ibge, ano: ANO, mes: m, classe: '5' }); if (c5.length) { mes = m; break } }
  if (!mes) { console.log('MSC classe 5 vazia — nada a fazer.'); return }
  const grupos = new Map<string, Set<string>>()
  for (const l of c5) {
    if (!l.conta_contabil.startsWith('522') || Math.abs(l.valor) < 0.005) continue
    const poder = l.poder_orgao.startsWith('2') ? 'L' : 'E'
    const k = `${poder}|${Number(l.funcao)}|${Number(l.subfuncao)}|${naturezaDespesaMsc(l.natureza_despesa, 'elemento')}`
    const g = grupos.get(k) ?? new Set<string>()
    g.add(fonteMsc(l.fonte_recursos))
    grupos.set(k, g)
  }
  console.log(`MSC mês ${mes}: ${grupos.size} grupos de dotação (poder×função×subfunção×elemento)`)

  // dotações 9999 do dev
  const dots: { id: string; entidadeId: string; entidade: string; poder: string; funcao: string; subfuncao: string; nat: string; aut: unknown; emp: unknown }[] =
    await prisma.$queryRawUnsafe(`
      SELECT d.id, e.id AS "entidadeId", e.nome AS entidade,
             CASE WHEN e.nome ILIKE '%câmara%' THEN 'L' ELSE 'E' END AS poder,
             fu.codigo AS funcao, sf.codigo AS subfuncao, cd.codigo AS nat,
             d."valorAutorizado" AS aut, d."valorEmpenhado" AS emp
      FROM dotacoes_despesa d
      JOIN orcamentos o ON o.id = d."orcamentoId" JOIN entidades e ON e.id = o."entidadeId"
      JOIN municipios m ON m.id = e."municipioId"
      JOIN funcoes fu ON fu.id = d."funcaoId" JOIN subfuncoes sf ON sf.id = d."subfuncaoId"
      JOIN contas_despesa_entidade cd ON cd.id = d."contaDespesaEntidadeId"
      JOIN fontes_recurso_entidade f ON f.id = d."fonteRecursoEntidadeId"
      WHERE m.nome = '${alvo!.replace(/'/g, "''")}' AND o.ano = ${ANO} AND f.codigo = '9999'`)
  console.log(`dotações 9999 no dev: ${dots.length}`)

  // Σ por entidade ANTES (prova de invariância de valores)
  const somaAntes = new Map<string, { aut: number; emp: number }>()
  for (const d of dots) {
    const s = somaAntes.get(d.entidadeId) ?? { aut: 0, emp: 0 }
    s.aut += Number(d.aut)
    s.emp += Number(d.emp)
    somaAntes.set(d.entidadeId, s)
  }

  type Plano = { dotacaoId: string; entidadeId: string; fonteStn: string }
  const plano: Plano[] = []
  let autOk = 0, autAmbiguo = 0, autSemGrupo = 0
  for (const d of dots) {
    const nat6 = d.nat.split('.').slice(0, 4).join('.') + '.00.00'
    const g = grupos.get(`${d.poder}|${Number(d.funcao)}|${Number(d.subfuncao)}|${nat6}`)
    if (!g) { autSemGrupo += Number(d.aut); continue }
    const fontes = [...g]
    if (fontes.length === 1 && fontes[0] !== '0') {
      plano.push({ dotacaoId: d.id, entidadeId: d.entidadeId, fonteStn: fontes[0]! })
      autOk += Number(d.aut)
    } else autAmbiguo += Number(d.aut)
  }
  const T = autOk + autAmbiguo + autSemGrupo
  console.log(`atribuição EXATA (fonte única cl.5): ${plano.length} dotações · autorizado ${R(autOk)} (${((100 * autOk) / T).toFixed(1)}%)`)
  console.log(`fica 9999 — multi-fonte: ${R(autAmbiguo)} (${((100 * autAmbiguo) / T).toFixed(1)}%) · sem grupo MSC: ${R(autSemGrupo)} (${((100 * autSemGrupo) / T).toFixed(1)}%)`)
  const porFonte = new Map<string, number>()
  for (const p of plano) porFonte.set(p.fonteStn, (porFonte.get(p.fonteStn) ?? 0) + 1)
  console.log(`fontes atribuídas: ${[...porFonte.entries()].sort((a, b) => b[1] - a[1]).map(([f, n]) => `${f}(${n})`).join(' ')}`)

  if (!APPLY) { console.log('\nDRY-RUN: nada gravado. Rode com --apply e depois rematerializar_razao --apply.'); return }

  // garante as fontes STN nas entidades e re-keya as dotações; estorna a abertura
  // (o rematerializar recontabiliza com o cc de fonte novo)
  const usuario = await prisma.usuario.findFirstOrThrow({ orderBy: { criadoEm: 'asc' }, select: { id: true } })
  const fonteIds = new Map<string, string>() // `${entidadeId}|${stn}` → id
  for (const p of plano) {
    const k = `${p.entidadeId}|${p.fonteStn}`
    if (!fonteIds.has(k)) {
      const existente = await prisma.fonteRecursoEntidade.findFirst({ where: { entidadeId: p.entidadeId, ano: ANO, codigo: p.fonteStn }, select: { id: true } })
      if (existente) fonteIds.set(k, existente.id)
      else {
        const nova = await prisma.fonteRecursoEntidade.create({
          data: { entidadeId: p.entidadeId, ano: ANO, codigo: p.fonteStn, nomenclatura: await nomeFonte(alvo!, p.fonteStn), vinculada: p.fonteStn !== '1500', origem: 'DESDOBRAMENTO' },
          select: { id: true },
        })
        fonteIds.set(k, nova.id)
      }
    }
  }
  await prisma.$transaction(
    async (tx) => {
      for (const p of plano) {
        await tx.dotacaoDespesa.update({ where: { id: p.dotacaoId }, data: { fonteRecursoEntidadeId: fonteIds.get(`${p.entidadeId}|${p.fonteStn}`)! } })
      }
    },
    { timeout: 300_000 },
  )
  console.log(`✓ ${plano.length} dotações re-keyadas.`)

  // prova de invariância: Σ autorizado/empenhado por entidade INALTERADO
  const depois: { entidadeId: string; aut: unknown; emp: unknown }[] = await prisma.$queryRawUnsafe(`
    SELECT o."entidadeId" AS "entidadeId", SUM(d."valorAutorizado") AS aut, SUM(d."valorEmpenhado") AS emp
    FROM dotacoes_despesa d JOIN orcamentos o ON o.id = d."orcamentoId"
    WHERE d.id = ANY($1) GROUP BY 1`, [...new Set(dots.map((d) => d.id))].length ? dots.map((d) => d.id) : ['-'])
  let invariante = true
  for (const r of depois) {
    const antes = somaAntes.get(r.entidadeId)!
    if (Math.abs(Number(r.aut) - antes.aut) > 0.005 || Math.abs(Number(r.emp) - antes.emp) > 0.005) {
      console.log(`  ✗ Σ mudou na entidade ${r.entidadeId}!`)
      invariante = false
    }
  }
  console.log(invariante ? '✓ invariância de valores confirmada (Σ aut/emp por entidade inalterados)' : '✗ INVARIÂNCIA VIOLADA — investigar')

  // estorna a abertura das entidades afetadas (o cc de dotação da abertura tem a fonte)
  const abertura = new AberturaContabilService(prisma)
  for (const entId of new Set(plano.map((p) => p.entidadeId))) {
    const st = await abertura.status(entId, ANO)
    if (st.contabilizada) { await abertura.estornar(entId, ANO, usuario.id); console.log(`  abertura estornada (${entId}) — rematerializar recontabiliza`) }
  }
  console.log('\nAgora rode: npx tsx scripts/rematerializar_razao.ts --municipio=' + alvo + ' --apply')
}
main().catch((e) => { console.error('FALHOU:', e instanceof Error ? e.stack || e.message : e); process.exitCode = 1 }).finally(async () => { await prisma.$disconnect(); await pool.end() })
