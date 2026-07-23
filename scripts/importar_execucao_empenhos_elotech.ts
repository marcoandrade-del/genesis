/**
 * Re-importa a EXECUÇÃO da despesa dos municípios Elotech EMPENHO A EMPENHO —
 * a única visão do portal com FONTE real por dotação (fecha os 100% do gap que a
 * regra classe-5 cobriu só em parte). Mesmo snapshot p/ tudo (sem skew de timing).
 *
 * Pipeline por entidade (idPortal do config):
 *  1. lista + detalhe de cada empenho (cache JSONL em data/empenhos-elotech/ —
 *     re-run só busca o que falta);
 *  2. agrega por (órgão, unidade, função, subfunção, programa, ação,
 *     natureza-ELEMENTO, fonte 8-díg): empenhado líquido = Σ(empenhado−anulado),
 *     liquidado = Σ liquidado, pago = Σ(pago−retido) [retido em aberto fica
 *     como a-pagar — conservador p/ o art. 42 e consistente com o QDD];
 *  3. GATE: Σ por fonte × `/despesapornivel/fonte-recursos` (gabarito do próprio
 *     portal, ao centavo) — diverge → aborta a entidade;
 *  4. APPLY: LOA = dotações atuais (autorizado por dotação, fonte vigente) ∪
 *     execução dos empenhos, via reconciliarDespesa + escreverDespesa (linhas
 *     SEMPRE reconciliadas — lição da CAGEPAR) + materializarRazao full.
 *
 * A LOA sem fonte fica onde está (9999 ou classe-5 única); a EXECUÇÃO passa a
 * carregar a fonte real em 100% — dotações exec-sem-LOA (autorizado 0) são o
 * padrão já existente do reconciliar p/ granularidade que a LOA não tem.
 *
 *   npx tsx scripts/importar_execucao_empenhos_elotech.ts --municipio=<nome> [--apply]
 */
import 'dotenv/config'
import { mkdirSync, existsSync, readFileSync, appendFileSync } from 'node:fs'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import { listarEmpenhos, detalheEmpenho, comConcorrencia, type EmpenhoDetalhe } from '../src/conversor/fabricantes/elotech/empenhos.js'
import { reconciliarDespesa } from '../src/conversor/nucleo/reconciliar.js'
import { escreverDespesa } from '../src/conversor/nucleo/escrever-despesa.js'
import { materializarRazao } from '../src/conversor/nucleo/materializar-razao.js'
import type { LinhaDespesa, MunicipioConfig } from '../src/conversor/nucleo/tipos.js'
import { cianortePr } from '../src/conversor/municipios/cianorte-pr.js'
import { naviraiMs } from '../src/conversor/municipios/navirai-ms.js'
import { sarandiPr } from '../src/conversor/municipios/sarandi-pr.js'
import { vilhenaRo } from '../src/conversor/municipios/vilhena-ro.js'

const APPLY = process.argv.includes('--apply')
const ANO = 2026
const CACHE_DIR = 'data/empenhos-elotech'
const alvo = process.argv.find((a) => a.startsWith('--municipio='))?.split('=')[1]
if (!alvo) { console.error('uso: --municipio=<nome> [--apply]'); process.exit(1) }

const CONFIGS: MunicipioConfig[] = [cianortePr, naviraiMs, sarandiPr, vilhenaRo]
const pool = new Pool({ connectionString: process.env['DATABASE_URL'] })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })
const R = (n: number) => (n / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 })
const cents = (v: number | null | undefined) => Math.round(((v ?? 0) + Number.EPSILON) * 100)

type Registro = {
  empenho: number
  fonte: string
  fonteDesc: string
  empenhadoLiq: number // centavos
  liquidado: number
  pago: number
  det: EmpenhoDetalhe
}

/** Busca (com cache JSONL) os empenhos+detalhes de uma entidade do portal. */
async function buscarEmpenhos(baseUrl: string, idPortal: string): Promise<Registro[]> {
  mkdirSync(CACHE_DIR, { recursive: true })
  const cachePath = `${CACHE_DIR}/${alvo!.replace(/[^\p{L}\d]+/gu, '_')}-${idPortal}-${ANO}.jsonl`
  const cache = new Map<number, Registro>()
  if (existsSync(cachePath)) {
    for (const l of readFileSync(cachePath, 'utf-8').split('\n')) {
      if (!l.trim()) continue
      const r = JSON.parse(l) as Registro
      cache.set(r.empenho, r)
    }
  }
  const lista = await listarEmpenhos(baseUrl, idPortal, ANO)
  const out: Registro[] = []
  const faltam: typeof lista = []
  for (const e of lista) {
    const [fCod, ...fDesc] = (e.fonteRecurso ?? '').split(' - ')
    const base = {
      empenho: e.empenho,
      fonte: fCod?.trim() || '9999',
      fonteDesc: fDesc.join(' - ').trim(),
      empenhadoLiq: cents(e.valorEmpenhado) - cents(e.valorAnulado),
      liquidado: cents(e.valorLiquidado),
      pago: cents(e.valorPago) - cents(e.valorRetido),
    }
    const c = cache.get(e.empenho)
    // valores SEMPRE da lista atual (snapshot); só o detalhe (programática) é cacheável
    if (c) out.push({ ...base, det: c.det })
    else faltam.push(e)
  }
  if (faltam.length) {
    console.log(`    detalhes a buscar: ${faltam.length} (cache: ${cache.size})`)
    const novos = await comConcorrencia(faltam, 8, async (e) => {
      const det = await detalheEmpenho(baseUrl, idPortal, ANO, e.empenho)
      const [fc, ...fd] = (e.fonteRecurso ?? '').split(' - ')
      const reg: Registro = {
        empenho: e.empenho,
        fonte: fc?.trim() || '9999',
        fonteDesc: fd.join(' - ').trim(),
        empenhadoLiq: cents(e.valorEmpenhado) - cents(e.valorAnulado),
        liquidado: cents(e.valorLiquidado),
        pago: cents(e.valorPago) - cents(e.valorRetido),
        det,
      }
      appendFileSync(cachePath, JSON.stringify(reg) + '\n')
      return reg
    })
    out.push(...novos)
  }
  return out
}

/** Registro do empenho → LinhaDespesa de EXECUÇÃO (dims no formato do dev). */
function paraLinha(r: Registro): LinhaDespesa | null {
  const d = r.det
  if (!d.orgao || !d.unidade || !d.funcao || !d.subFuncao || !d.programa || !d.projeto || !d.elemento) return null
  const orgao = d.orgao
  const unidade = d.unidade.startsWith(orgao) ? d.unidade.slice(orgao.length) : d.unidade
  const natElemento = d.elemento.split('.').slice(0, 4).join('.') + '.00.00'
  return {
    orgao: { codigo: orgao, nome: `Órgão ${orgao}` },
    unidade: { codigo: unidade, nome: `Unidade ${orgao}.${unidade}` },
    funcao: d.funcao,
    subfuncao: d.subFuncao,
    programa: { codigo: d.programa },
    acao: { codigo: d.projeto },
    naturezaPcasp: natElemento,
    fonte: { codigo: r.fonte, descricao: r.fonteDesc || `Fonte ${r.fonte}` },
    empenhado: r.empenhadoLiq,
    liquidado: r.liquidado,
    pago: r.pago,
  }
}

async function main() {
  const cfg = CONFIGS.find((c) => c.nome === alvo)
  if (!cfg) { console.error(`município '${alvo}' fora do escopo (${CONFIGS.map((c) => c.nome).join(' · ')})`); process.exitCode = 1; return }
  const baseUrl = cfg.portalUrl
  console.log(`\n═══ Execução EMPENHO A EMPENHO — ${cfg.nome} ${APPLY ? '[APPLY]' : '[DRY-RUN]'} ═══`)

  const usuario = await prisma.usuario.findFirstOrThrow({ orderBy: { criadoEm: 'asc' }, select: { id: true } })
  for (const entCfg of cfg.entidades) {
    const idPortal = entCfg.params?.['idPortal'] as string | undefined
    const url = (entCfg.params?.['portalUrl'] as string | undefined) ?? (baseUrl as string | undefined)
    if (!idPortal || !url) { console.log(`  ${entCfg.nome}: sem idPortal/portalUrl — pulado`); continue }
    const ent = await prisma.entidade.findFirst({
      where: { nome: entCfg.nome, municipio: { is: { nome: cfg.nome } } },
      select: { id: true, nome: true },
    })
    if (!ent) { console.log(`  ${entCfg.nome}: não está no dev — pulado`); continue }
    console.log(`\n  ── ${ent.nome} (portal ${idPortal}) ──`)

    const regs = await buscarEmpenhos(url, idPortal)
    console.log(`    empenhos: ${regs.length}`)
    if (!regs.length) continue

    // GATE: Σ por fonte × gabarito do portal (mesmo snapshot)
    const porFonte = new Map<string, { emp: number; pago: number }>()
    for (const r of regs) {
      const t = porFonte.get(r.fonte) ?? { emp: 0, pago: 0 }
      t.emp += r.empenhadoLiq
      t.pago += r.pago
      porFonte.set(r.fonte, t)
    }
    const gabarito = (await (async () => {
      const res = await fetch(`${url}/despesapornivel/fonte-recursos`, { headers: { entidade: idPortal, exercicio: String(ANO), 'User-Agent': 'Mozilla/5.0' } })
      if (!res.ok) throw new Error(`gabarito HTTP ${res.status}`)
      return (await res.json()) as { codigo: string; valorEmpenhado: number; valorPago: number }[]
    })())
    let gateOk = true
    for (const g of gabarito) {
      const t = porFonte.get(g.codigo) ?? { emp: 0, pago: 0 }
      const de = t.emp - cents(g.valorEmpenhado)
      const dp = t.pago - cents(g.valorPago)
      if (Math.abs(de) > 1 || Math.abs(dp) > 1) {
        console.log(`    ✗ GATE fonte ${g.codigo}: Δ empenhado ${R(de)} · Δ pago ${R(dp)}`)
        gateOk = false
      }
    }
    console.log(gateOk ? `    ✓ GATE: ${gabarito.length} fontes batem com o gabarito do portal ao centavo` : '    ✗ gabarito divergente — entidade PULADA')
    if (!gateOk) continue

    // execução agregada por dotação×fonte
    const exec = new Map<string, LinhaDespesa>()
    let semDims = 0
    for (const r of regs) {
      const l = paraLinha(r)
      if (!l) { semDims += r.empenhadoLiq; continue }
      const k = [l.orgao.codigo, l.unidade.codigo, l.funcao, l.subfuncao, l.programa.codigo, l.acao.codigo, l.naturezaPcasp, l.fonte.codigo].join('|')
      const j = exec.get(k)
      if (j) {
        j.empenhado = (j.empenhado ?? 0) + (l.empenhado ?? 0)
        j.liquidado = (j.liquidado ?? 0) + (l.liquidado ?? 0)
        j.pago = (j.pago ?? 0) + (l.pago ?? 0)
      } else exec.set(k, l)
    }
    if (semDims) console.log(`    ⚠ empenhos sem dims completas (descartados, quantificado): ${R(semDims)}`)
    const execLinhas = [...exec.values()].filter((l) => (l.empenhado ?? 0) !== 0 || (l.liquidado ?? 0) !== 0 || (l.pago ?? 0) !== 0)
    console.log(`    execução: ${execLinhas.length} dotações×fonte · Σ empenhado ${R(execLinhas.reduce((s, l) => s + (l.empenhado ?? 0), 0))}`)

    if (!APPLY) continue

    // LOA atual do dev (autorizado por dotação, fonte vigente) — reconciliada com a execução
    const loaRows: { orgao: string; orgaoNome: string; unidade: string; unidadeNome: string; funcao: string; subfuncao: string; programa: string; acao: string; nat: string; fonte: string; fonteNome: string; aut: unknown }[] =
      await prisma.$queryRawUnsafe(`
        SELECT split_part(u.codigo, '.', 1) AS orgao, u.nome AS "orgaoNome", split_part(u.codigo, '.', 2) AS unidade, u.nome AS "unidadeNome",
               fu.codigo AS funcao, sf.codigo AS subfuncao, p.codigo AS programa, a.codigo AS acao,
               cd.codigo AS nat, f.codigo AS fonte, f.nomenclatura AS "fonteNome", d."valorAutorizado" AS aut
        FROM dotacoes_despesa d
        JOIN orcamentos o ON o.id = d."orcamentoId"
        JOIN unidades_orcamentarias u ON u.id = d."unidadeOrcamentariaId"
        JOIN funcoes fu ON fu.id = d."funcaoId" JOIN subfuncoes sf ON sf.id = d."subfuncaoId"
        JOIN programas p ON p.id = d."programaId" JOIN acoes a ON a.id = d."acaoId"
        JOIN contas_despesa_entidade cd ON cd.id = d."contaDespesaEntidadeId"
        JOIN fontes_recurso_entidade f ON f.id = d."fonteRecursoEntidadeId"
        WHERE o."entidadeId" = '${ent.id}' AND o.ano = ${ANO} AND d."valorAutorizado" > 0`)
    const loa: LinhaDespesa[] = loaRows.map((r) => ({
      orgao: { codigo: r.orgao, nome: r.orgaoNome },
      unidade: { codigo: r.unidade, nome: r.unidadeNome },
      funcao: r.funcao,
      subfuncao: r.subfuncao,
      programa: { codigo: r.programa },
      acao: { codigo: r.acao },
      naturezaPcasp: r.nat,
      fonte: { codigo: r.fonte, descricao: r.fonteNome },
      autorizado: Math.round(Number(r.aut) * 100),
    }))
    const orc = await prisma.orcamento.findUniqueOrThrow({ where: { entidadeId_ano: { entidadeId: ent.id, ano: ANO } }, select: { id: true } })
    const merged = reconciliarDespesa(loa, execLinhas)
    const d = await escreverDespesa(prisma, orc.id, ent.id, ANO, merged, { historico: `EXECUÇÃO EMPENHO-A-EMPENHO ${ANO} (fonte real)` })
    console.log(`    ✓ despesa: ${d.dotacoes} dotações (com empenho ${d.comEmpenho})${d.semConta.length ? ` · ⚠ sem conta: ${d.semConta.length} nat = emp ${R(d.valorSemConta.empenhado)}` : ''}`)
    const raz = await materializarRazao(prisma, ent.id, ANO, usuario.id)
    console.log(`    ✓ razão: ${raz.arrecadacoes} arrec + ${raz.movimentos} movimentos`)
  }
  if (!APPLY) console.log('\nDRY-RUN: nada gravado. Rode com --apply.')
}
main().catch((e) => { console.error('FALHOU:', e instanceof Error ? e.stack || e.message : e); process.exitCode = 1 }).finally(async () => { await prisma.$disconnect(); await pool.end() })
