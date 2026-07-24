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
import { listarEmpenhos, listarEmpenhosPorFaixa, detalheEmpenho, comConcorrencia, criarRitmo, dentroDaJanelaGentil, JanelaFechada, RitmoEsgotado, type EmpenhoDetalhe, type Ritmo } from '../src/conversor/fabricantes/elotech/empenhos.js'
import { reconciliarDespesa } from '../src/conversor/nucleo/reconciliar.js'
import { escreverDespesa } from '../src/conversor/nucleo/escrever-despesa.js'
import { materializarRazao } from '../src/conversor/nucleo/materializar-razao.js'
import type { LinhaDespesa, MunicipioConfig } from '../src/conversor/nucleo/tipos.js'
import { cianortePr } from '../src/conversor/municipios/cianorte-pr.js'
import { naviraiMs } from '../src/conversor/municipios/navirai-ms.js'
import { sarandiPr } from '../src/conversor/municipios/sarandi-pr.js'
import { vilhenaRo } from '../src/conversor/municipios/vilhena-ro.js'

const APPLY = process.argv.includes('--apply')
const GENTIL_FLAG = process.argv.includes('--gentil')
const ANO = 2026
const CACHE_DIR = 'data/empenhos-elotech'
const alvo = process.argv.find((a) => a.startsWith('--municipio='))?.split('=')[1]
// SMOKE: teste limitado de conectividade/ritmo — lista por faixas + no máx N
// detalhes NOVOS por entidade, SEM gate/apply (o cache alimenta a coleta real).
const smokeArg = process.argv.find((a) => a === '--smoke' || a.startsWith('--smoke='))
const SMOKE = smokeArg ? Number(smokeArg.split('=')[1] ?? 25) : 0
// deadline dura (HH:MM de hoje) — só vale em SMOKE: permite testar fora da
// janela padrão com fim garantido (ex.: almoço --ate=12:50)
const ATE = process.argv.find((a) => a.startsWith('--ate='))?.split('=')[1]
const prazo = SMOKE && ATE ? (() => { const [h, m] = ATE.split(':').map(Number); const d = new Date(); d.setHours(h ?? 0, m ?? 0, 0, 0); return d })() : null
const naJanela = () => dentroDaJanelaGentil(new Date()) || (prazo !== null && new Date() < prazo)
if (!alvo) { console.error('uso: --municipio=<nome> [--apply] [--gentil] [--smoke[=N] --ate=HH:MM]'); process.exit(1) }

/**
 * MODO GENTIL — p/ o Elotech LEGADO (eloweb/Delphi) em PRODUÇÃO: o sistema
 * atende a prefeitura (milhares de usuários) e a coleta agressiva de 23/07 o
 * derrubou (502). Automático p/ hosts eloweb.net; liga: serial 1-a-1 com pausa
 * adaptativa, circuit breaker, janela 22h–06h + fim de semana e health-check
 * antes de qualquer carga. Coleta interrompida retoma do cache na próxima janela.
 */
const ehGentil = (url: string) => GENTIL_FLAG || url.includes('eloweb.net')
let ritmoRun: Ritmo | null = null
const ritmoDe = (url: string): Ritmo | undefined => {
  if (!ehGentil(url)) return undefined
  ritmoRun ??= criarRitmo({ dentroDaJanela: naJanela })
  return ritmoRun
}

/** Sonda leve antes de QUALQUER carga no host gentil: portal fora do ar/lento → não coletar. */
async function healthCheck(baseUrl: string): Promise<boolean> {
  const t0 = Date.now()
  try {
    const res = await fetch(`${baseUrl}/api/entidades`, { headers: { exercicio: String(ANO), 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(10_000) })
    const ms = Date.now() - t0
    if (!res.ok) { console.log(`  ✗ health-check: HTTP ${res.status} — coleta NÃO iniciada`); return false }
    if (ms > 5_000) { console.log(`  ✗ health-check: portal lento (${ms}ms) — coleta NÃO iniciada (não vamos piorar)`); return false }
    console.log(`  ✓ health-check: portal são (${ms}ms)`)
    return true
  } catch (e) {
    console.log(`  ✗ health-check: ${e instanceof Error ? e.message : e} — coleta NÃO iniciada`)
    return false
  }
}

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
  // legado (eloweb) degrada com offset — no modo GENTIL nem tenta (vai direto às
  // faixas, offset sempre 0); nos modernos o offset segue como caminho rápido
  const ritmo = ritmoDe(baseUrl)
  let lista
  if (ritmo) {
    lista = await listarEmpenhosPorFaixa(baseUrl, idPortal, ANO, 500, ritmo)
  } else {
    try {
      lista = await listarEmpenhos(baseUrl, idPortal, ANO)
    } catch {
      console.log('    lista por offset falhou — particionando por faixas de empenho')
      lista = await listarEmpenhosPorFaixa(baseUrl, idPortal, ANO)
    }
  }
  const out: Registro[] = []
  let faltam: typeof lista = []
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
  if (SMOKE && faltam.length > SMOKE) {
    console.log(`    [smoke] limitando detalhes novos a ${SMOKE} (de ${faltam.length} pendentes)`)
    faltam = faltam.slice(0, SMOKE)
  }
  if (faltam.length) {
    console.log(`    detalhes a buscar: ${faltam.length} (cache: ${cache.size})${ritmo ? ' [modo gentil: serial]' : ''}`)
    const t0 = Date.now()
    let feitos = 0
    const novos = await comConcorrencia(faltam, ritmo ? 1 : 8, async (e) => {
      const det = await detalheEmpenho(baseUrl, idPortal, ANO, e.empenho, ritmo)
      if (ritmo && ++feitos % 50 === 0) {
        const porReq = (Date.now() - t0) / feitos
        const eta = Math.round(((faltam.length - feitos) * porReq) / 60_000)
        console.log(`      … ${feitos}/${faltam.length} (${Math.round(porReq)}ms/req · pausa ${ritmo.estado().pausaMs}ms · ETA ~${eta}min)`)
      }
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
  if (ehGentil(baseUrl as string)) {
    console.log(`  [modo GENTIL: eloweb legado em produção — serial, pausa adaptativa, janela 22h–06h + fim de semana]`)
    if (SMOKE) console.log(`  [SMOKE: máx ${SMOKE} detalhes novos/entidade, sem gate/apply${prazo ? `, deadline ${ATE}` : ''}]`)
    if (SMOKE && !dentroDaJanelaGentil(new Date()) && !ATE) { console.log('  ✗ smoke fora da janela exige deadline explícito (--ate=HH:MM)'); process.exitCode = 3; return }
    if (!naJanela()) { console.log('  ✗ fora da janela de coleta — nada a fazer agora (rode à noite/fim de semana)'); process.exitCode = 3; return }
    if (!(await healthCheck(baseUrl as string))) { process.exitCode = 2; return }
  }
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

    if (SMOKE) {
      const t0 = Date.now()
      const regs = await buscarEmpenhos(url, idPortal)
      console.log(`    [smoke] ok em ${Math.round((Date.now() - t0) / 1000)}s · registros com detalhe no cache: ${regs.length}${ritmoRun ? ` · pausa atual ${ritmoRun.estado().pausaMs}ms · cooldowns ${ritmoRun.estado().cooldowns}` : ''}`)
      continue
    }

    // GATE com RETRY: em portal VIVO (dia útil) empenhos entram entre a lista e o
    // gabarito — re-busca em janela apertada (detalhes já cacheados; a lista é
    // barata) até 3× antes de desistir da entidade.
    let regs: Registro[] = []
    let gateOk = false
    for (let tent = 1; tent <= 3 && !gateOk; tent++) {
      regs = await buscarEmpenhos(url, idPortal)
      if (!regs.length) break
      const porFonte = new Map<string, { emp: number; pago: number }>()
      for (const r of regs) {
        const t = porFonte.get(r.fonte) ?? { emp: 0, pago: 0 }
        t.emp += r.empenhadoLiq
        t.pago += r.pago
        porFonte.set(r.fonte, t)
      }
      if (ritmoRun) await ritmoRun.antes() // gabarito também respeita o ritmo no host gentil
      const res = await fetch(`${url}/despesapornivel/fonte-recursos`, { headers: { entidade: idPortal, exercicio: String(ANO), 'User-Agent': 'Mozilla/5.0' } })
      if (!res.ok) throw new Error(`gabarito HTTP ${res.status}`)
      const gabarito = (await res.json()) as { codigo: string; valorEmpenhado: number; valorPago: number }[]
      gateOk = true
      for (const g of gabarito) {
        const t = porFonte.get(g.codigo) ?? { emp: 0, pago: 0 }
        const de = t.emp - cents(g.valorEmpenhado)
        const dp = t.pago - cents(g.valorPago)
        if (Math.abs(de) > 1 || Math.abs(dp) > 1) {
          if (tent === 3) console.log(`    ✗ GATE fonte ${g.codigo}: Δ empenhado ${R(de)} · Δ pago ${R(dp)}`)
          gateOk = false
        }
      }
      if (gateOk) console.log(`    ✓ GATE: ${gabarito.length} fontes batem com o gabarito do portal ao centavo (tentativa ${tent})`)
      else if (tent < 3) console.log(`    … gate divergente (portal vivo?) — re-tentando em janela apertada (${tent}/3)`)
    }
    console.log(`    empenhos: ${regs.length}`)
    if (!regs.length) continue
    if (!gateOk) { console.log('    ✗ gabarito divergente após 3 tentativas — entidade PULADA'); continue }

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
main().catch((e) => {
  if (e instanceof JanelaFechada) {
    console.log('\n⏸ janela de coleta encerrada — progresso salvo no cache; re-rode na próxima janela (retoma de onde parou).')
    process.exitCode = 3
  } else if (e instanceof RitmoEsgotado) {
    console.log(`\n⏸ ${e.message}\n   coleta abortada SEM insistir (servidor em produção); progresso salvo no cache — re-rode na próxima janela.`)
    process.exitCode = 2
  } else {
    console.error('FALHOU:', e instanceof Error ? e.stack || e.message : e)
    process.exitCode = 1
  }
}).finally(async () => { await prisma.$disconnect(); await pool.end() })
