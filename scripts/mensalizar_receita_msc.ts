/**
 * MENSALIZA a receita arrecadada dos municípios do conversor — hoje as
 * `Arrecadacao` capturadas do YTD do portal levam data fixa 31/12 (achado do
 * Marco: "toda a receita anotada em dezembro") e o razão/ResumoMensal concentra
 * tudo no mês 12.
 *
 * Fonte mensal REAL (sem rateio): MSC oficial do SICONFI — o delta mês a mês do
 * `ending_balance` da classe 6 (6212* receita realizada BRUTA; 6213* deduções)
 * por (poder, natureza, fonte STN) É o movimento do mês, ao centavo.
 *
 * Regras de honestidade:
 *  - célula MSC ↔ previsão só com CANDIDATO ÚNICO (2+ previsões na mesma chave =
 *    sem atribuição exata → ficam como estão, QUANTIFICADAS). O match normaliza
 *    granularidades reais dos fabricantes SEM rateio (agregar células p/ cima é
 *    soma exata; ratear p/ baixo seria invenção — nunca):
 *      natureza: dev mais FUNDO que a MSC (detalhamento local, ex. Vilhena)
 *        → compara no espaço 8-díg; dev mais RASO (ex. IPM na espécie)
 *        → soma as células sob o prefixo;
 *      fonte: natureza com UMA previsão no grupo → célula agregada em TODAS as
 *        fontes (completa por construção; a fonte da previsão fica INTOCADA);
 *        natureza com 2+ previsões → discrimina pela fonte STN POR IDENTIDADE
 *        (direta / 8-díg truncada / fonteStnCodigo da própria previsão) — sem
 *        conversão inventada (de/para local↔STN não é 1:1, Nota STN 008/2021);
 *  - ARRECADACAO mensal = líquida (bruta − dedução do mês); DEDUCAO mensal só
 *    quando a previsão TEM dedução no dev; delta negativo = ESTORNO;
 *  - resíduo (alvo do dev − Σ mensal MSC) datado de HOJE com histórico explícito
 *    ("após último mês homologado") — verdade, não invenção;
 *  - GATE por previsão: Σ novas linhas por tipo == Σ das linhas atuais do
 *    conversor AO CENTAVO (o total NÃO muda; só a distribuição temporal);
 *  - só substitui linhas com o marcador do conversor (`CAPTURA ARRECADAÇÃO%`);
 *    previsão com linhas fora do marcador é pulada (quantificada).
 *
 * Após o apply, re-materializa o razão da entidade (datas fluem pro
 * ResumoMensalConta). Idempotente (re-run re-deriva da MSC).
 *
 *   npx tsx scripts/mensalizar_receita_msc.ts --municipio=<nome|todos> [--apply]
 */
import 'dotenv/config'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient, Prisma } from '@prisma/client'
import { baixarMsc, fonteMsc, type LinhaMsc } from '../src/conversor/siconfi/api.js'
import { naturezaReceita } from '../src/conversor/nucleo/pcasp.js'
import { materializarRazao } from '../src/conversor/nucleo/materializar-razao.js'
import type { MunicipioConfig } from '../src/conversor/nucleo/tipos.js'
import { cianortePr } from '../src/conversor/municipios/cianorte-pr.js'
import { naviraiMs } from '../src/conversor/municipios/navirai-ms.js'
import { vilhenaRo } from '../src/conversor/municipios/vilhena-ro.js'
import { sarandiPr } from '../src/conversor/municipios/sarandi-pr.js'
import { criciumaSc } from '../src/conversor/municipios/criciuma-sc.js'
import { paranaguaPr } from '../src/conversor/municipios/paranagua-pr.js'
import { paranaguaSiconfi } from '../src/conversor/municipios/paranagua-pr-siconfi.js'

const APPLY = process.argv.includes('--apply')
const ANO = 2026
const HIST_PREFIXO = 'CAPTURA ARRECADAÇÃO'
const alvoArg = process.argv.find((a) => a.startsWith('--municipio='))?.split('=')[1]
if (!alvoArg) { console.error('uso: --municipio=<nome|todos> [--apply]'); process.exit(1) }

/** nome do município NO DEV → config (ibge). Maringá fora: já é mensal. */
const CONFIGS: [string, MunicipioConfig][] = [
  ['Cianorte', cianortePr], ['Naviraí', naviraiMs], ['Vilhena', vilhenaRo], ['Sarandi', sarandiPr],
  ['Criciúma', criciumaSc], ['Paranaguá', paranaguaPr], ['Paranaguá (SICONFI)', paranaguaSiconfi],
]
const IBGE_FIX: Record<string, string> = { '411820': '4118204' }

const pool = new Pool({ connectionString: process.env['DATABASE_URL'] })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })
const R = (c: number) => (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 })
const cents = (v: unknown) => Math.round(Number(v) * 100)

/** grupo de poder da entidade (mesma heurística da abertura patrimonial). */
function grupoEntidade(nome: string): 'EXEC' | 'LEG' | 'RPPS' {
  const n = nome.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')
  if (/camara/.test(n)) return 'LEG'
  if (/previdencia|rpps|preserv|capseci/.test(n)) return 'RPPS'
  return 'EXEC'
}
function grupoPoder(po: string): 'EXEC' | 'LEG' | 'RPPS' | null {
  if (/^2\d{2}31$/.test(po)) return 'LEG'
  if (/^1\d{2}32$/.test(po)) return 'RPPS'
  if (/^1\d{2}31$/.test(po)) return 'EXEC'
  return null
}
/**
 * fonte → espaço STN SÓ quando é identidade (já-STN direta ou 8-díg truncada).
 * Fonte LOCAL fica sem conversão de propósito: o de/para local↔STN NÃO é 1:1
 * (Nota STN 008/2021 — [[msc-siconfi-fonte-oficial]]); "converter" aqui
 * estreitaria a célula e distorceria o perfil mensal. O caminho p/ fontes locais
 * é a agregação por natureza com previsão única (exata).
 */
function paraStn(codigo: string, fonteStn: string | null): string | null {
  const f = codigo.trim()
  if (/^[12][5-8]\d{2}$/.test(f)) return f
  if (/^\d{8}$/.test(f)) return f.slice(0, 4)
  return fonteStn || null
}

/**
 * De/para local→STN do ESTADO (catálogo do TCE local provado ao centavo em
 * Maringá, facet A #268; só códigos inequívocos) — usado APENAS como
 * DISCRIMINADOR em natureza multi-previsão (nunca p/ estreitar célula única).
 * Cobre também o catálogo sem o dígito de exercício ('303' ≡ corrente '1303').
 */
async function deparaDoEstado(uf: string): Promise<Map<string, string>> {
  if (uf !== 'PR') return new Map()
  const rows: { codigo: string; stn: string }[] = await prisma.$queryRawUnsafe(`
    SELECT f.codigo, MIN(f."fonteStnCodigo") AS stn
    FROM fontes_recurso_entidade f
    JOIN entidades e ON e.id = f."entidadeId" JOIN municipios m ON m.id = e."municipioId"
    WHERE m.nome = 'Maringá' AND f."fonteStnCodigo" IS NOT NULL
    GROUP BY f.codigo HAVING COUNT(DISTINCT f."fonteStnCodigo") = 1`)
  const mapa = new Map(rows.map((r) => [r.codigo, r.stn]))
  for (const [cod, stn] of [...mapa]) if (/^1\d{3}$/.test(cod)) mapa.set(String(Number(cod.slice(1))), stn)
  return mapa
}
const ultimoDia = (mes: number) => new Date(Date.UTC(ANO, mes, 0))

type Celula = { ytd: Map<number, number>; ded: Map<number, number> }

/** Células (grupo|natureza12|fonteStn) → YTD por mês, das contas 6212 e 6213. */
async function celulasMsc(ibge: string): Promise<{ meses: number[]; celulas: Map<string, Celula> }> {
  const celulas = new Map<string, Celula>()
  const meses: number[] = []
  for (let m = 1; m <= 12; m++) {
    let linhas: LinhaMsc[] = []
    try { linhas = await baixarMsc({ ibge, ano: ANO, mes: m, classe: '6' }) } catch { /* mês não homologado */ }
    const receita = linhas.filter((l) => l.conta_contabil.startsWith('6212') || l.conta_contabil.startsWith('6213'))
    if (!receita.length) continue
    meses.push(m)
    for (const l of receita) {
      const g = grupoPoder(l.poder_orgao)
      if (!g || !l.natureza_receita) continue
      const stn = paraStn(fonteMsc(l.fonte_recursos), null)
      if (!stn) continue
      const k = `${g}|${naturezaReceita(l.natureza_receita)}|${stn}`
      const c = celulas.get(k) ?? { ytd: new Map(), ded: new Map() }
      const alvo = l.conta_contabil.startsWith('6212') ? c.ytd : c.ded
      alvo.set(m, (alvo.get(m) ?? 0) + Math.round((l.natureza_conta === 'C' ? l.valor : -l.valor) * 100))
      celulas.set(k, c)
    }
  }
  return { meses, celulas }
}

/** deltas mensais de uma série YTD nos meses disponíveis (ordem crescente). */
function deltas(serie: Map<number, number>, meses: number[]): Map<number, number> {
  const out = new Map<number, number>()
  let acc = 0
  for (const m of meses) {
    const y = serie.get(m) ?? acc // mês sem a célula = sem movimento novo
    if (y !== acc) out.set(m, y - acc)
    acc = y
  }
  return out
}

async function mensalizarMunicipio(nomeDev: string, cfg: MunicipioConfig): Promise<void> {
  const ibge = IBGE_FIX[cfg.ibge] ?? cfg.ibge
  console.log(`\n═══ ${nomeDev} (IBGE ${ibge}) ${APPLY ? '[APPLY]' : '[DRY-RUN]'} ═══`)
  const { meses, celulas } = await celulasMsc(ibge)
  if (!meses.length) { console.log('  MSC classe 6 vazia — nada a mensalizar.'); return }
  console.log(`  MSC meses homologados: ${meses.join(',')} · células receita: ${celulas.size}`)

  // previsões do município (todas as entidades) + Σ atuais das linhas do conversor
  const prevs: {
    id: string; entidadeId: string; entidade: string; natureza: string; fonte: string; fonteStn: string | null
    net: number | null; ded: number | null; foraMarcador: number
  }[] = await prisma.$queryRawUnsafe(`
    SELECT p.id, e.id AS "entidadeId", e.nome AS entidade, cr.codigo AS natureza, f.codigo AS fonte, p."fonteStnCodigo" AS "fonteStn",
      (SELECT SUM(CASE a.tipo WHEN 'ARRECADACAO' THEN a.valor WHEN 'ESTORNO' THEN -a.valor ELSE 0 END)::float
         FROM arrecadacoes a WHERE a."previsaoId" = p.id AND a.historico LIKE '${HIST_PREFIXO}%') AS net,
      (SELECT SUM(CASE a.tipo WHEN 'DEDUCAO' THEN a.valor ELSE 0 END)::float
         FROM arrecadacoes a WHERE a."previsaoId" = p.id AND a.historico LIKE '${HIST_PREFIXO}%') AS ded,
      (SELECT COUNT(*)::int FROM arrecadacoes a WHERE a."previsaoId" = p.id AND (a.historico IS NULL OR a.historico NOT LIKE '${HIST_PREFIXO}%')) AS "foraMarcador"
    FROM previsoes_receita p
    JOIN orcamentos o ON o.id = p."orcamentoId" AND o.ano = ${ANO}
    JOIN entidades e ON e.id = o."entidadeId"
    JOIN municipios m ON m.id = e."municipioId"
    JOIN contas_receita_entidade cr ON cr.id = p."contaReceitaEntidadeId"
    JOIN fontes_recurso_entidade f ON f.id = p."fonteRecursoEntidadeId"
    WHERE m.nome = '${nomeDev.replace(/'/g, "''")}'`)

  // chave de natureza do match: dev mais fundo que 8-díg → espaço 8-díg (7 segs);
  // dev raso (cauda zerada antes do 7º seg) → prefixo com ponto final (startsWith
  // seguro em fronteira de segmento)
  const natKeyDe = (nat: string): string => {
    const segs = nat.split('.')
    let ultimo = segs.length - 1
    while (ultimo >= 0 && /^0+$/.test(segs[ultimo]!)) ultimo--
    if (ultimo >= 6) return segs.slice(0, 7).join('.')
    return segs.slice(0, ultimo + 1).join('.') + '.'
  }
  /** soma (exata) das células que caem na chave — null se nenhuma. */
  const somaCelulas = (g: string, natKey: string, stn: string | null): Celula | null => {
    let achou = false
    const out: Celula = { ytd: new Map(), ded: new Map() }
    for (const [k, c] of celulas) {
      const [cg, cnat, cstn] = k.split('|') as [string, string, string]
      if (cg !== g || (stn && cstn !== stn)) continue
      const casa = natKey.endsWith('.') ? cnat.startsWith(natKey) : cnat.split('.').slice(0, 7).join('.') === natKey
      if (!casa) continue
      achou = true
      for (const [m, v] of c.ytd) out.ytd.set(m, (out.ytd.get(m) ?? 0) + v)
      for (const [m, v] of c.ded) out.ded.set(m, (out.ded.get(m) ?? 0) + v)
    }
    return achou ? out : null
  }

  // candidatas por chave (g¦natKey¦fonte-dim); candidato único = mensalizável.
  // Cascata: natureza com UMA previsão no grupo → célula agregada em TODAS as
  // fontes ('*', completa por construção — melhor que estreitar por STN);
  // natureza com 2+ previsões → a fonte STN (por identidade) é o discriminador;
  // sem conversão nesse caso → '∅' (ambígua, fica como está).
  const ativos = prevs.filter((p) => Math.round((p.net ?? 0) * 100) || Math.round((p.ded ?? 0) * 100))
  const porNat = new Map<string, number>()
  for (const p of ativos) {
    const gn = `${grupoEntidade(p.entidade)}|${natKeyDe(p.natureza)}`
    porNat.set(gn, (porNat.get(gn) ?? 0) + 1)
  }
  const depara = await deparaDoEstado(cfg.uf)
  const porChave = new Map<string, typeof prevs>()
  let viaDepara = 0
  for (const p of ativos) {
    const g = grupoEntidade(p.entidade)
    const natKey = natKeyDe(p.natureza)
    const unica = porNat.get(`${g}|${natKey}`) === 1
    let stn = paraStn(p.fonte, p.fonteStn)
    if (!unica && !stn && depara.has(p.fonte.trim())) { stn = depara.get(p.fonte.trim())!; viaDepara++ }
    const dim = unica ? '*' : (stn ?? '∅')
    const k = `${g}|${natKey}|${dim}`
    porChave.set(k, [...(porChave.get(k) ?? []), p])
  }
  if (viaDepara) console.log(`  discriminador de/para estadual (${cfg.uf}) em natureza multi-previsão: ${viaDepara} previsões`)

  type Nova = { previsaoId: string; tipo: 'ARRECADACAO' | 'ESTORNO' | 'DEDUCAO'; deducaoTipo: 'FUNDEB' | null; data: Date; valor: number; historico: string }
  const porEntidade = new Map<string, { novas: Nova[]; previsoes: string[] }>()
  const stats = { ok: 0, okValor: 0, ambiguas: 0, ambValor: 0, semCelula: 0, semCelValor: 0, foraMarcador: 0, dedInconsistente: 0 }
  const ultimoMes = meses[meses.length - 1]!
  const hoje = new Date(new Date().toISOString().slice(0, 10))

  for (const [k, cands] of porChave) {
    const somaNet = cands.reduce((s, p) => s + Math.round((p.net ?? 0) * 100), 0)
    const [g, natKey, stnRaw] = k.split('|') as [string, string, string]
    const stn = stnRaw === '*' ? null : stnRaw
    if (cands.length > 1 || stnRaw === '∅') {
      stats.ambiguas += cands.length
      stats.ambValor += somaNet
      continue
    }
    const p = cands[0]!
    if (p.foraMarcador > 0) { stats.foraMarcador++; continue }
    const alvoNet = Math.round((p.net ?? 0) * 100)
    const alvoDed = Math.round((p.ded ?? 0) * 100)
    const cel = somaCelulas(g, natKey, stn)
    if (!cel) { stats.semCelula++; stats.semCelValor += alvoNet; continue }

    const dBruta = deltas(cel.ytd, meses)
    const dDed = deltas(cel.ded, meses)
    // dedução mensal só quando a previsão TEM dedução e a série é consistente
    const comDed = alvoDed > 0
    if (comDed && ([...dDed.values()].some((v) => v < 0) || alvoDed - [...dDed.values()].reduce((s, v) => s + v, 0) < 0)) {
      stats.dedInconsistente++
      continue
    }
    const novas: Nova[] = []
    let somaMensalNet = 0
    let somaMensalDed = 0
    for (const m of new Set([...dBruta.keys(), ...dDed.keys()])) {
      const ded = comDed ? (dDed.get(m) ?? 0) : 0
      const net = (dBruta.get(m) ?? 0) - (dDed.get(m) ?? 0)
      const data = ultimoDia(m)
      const hist = `${HIST_PREFIXO} (conversor, mensal MSC ${ANO}-${String(m).padStart(2, '0')})`
      if (net !== 0) novas.push({ previsaoId: p.id, tipo: net > 0 ? 'ARRECADACAO' : 'ESTORNO', deducaoTipo: null, data, valor: Math.abs(net), historico: hist })
      if (ded > 0) novas.push({ previsaoId: p.id, tipo: 'DEDUCAO', deducaoTipo: 'FUNDEB', data, valor: ded, historico: hist })
      somaMensalNet += net
      somaMensalDed += ded
    }
    const resNet = alvoNet - somaMensalNet
    const resDed = alvoDed - somaMensalDed
    const histRes = `${HIST_PREFIXO} (conversor, resíduo pós-MSC mês ${ultimoMes})`
    if (resNet !== 0) novas.push({ previsaoId: p.id, tipo: resNet > 0 ? 'ARRECADACAO' : 'ESTORNO', deducaoTipo: null, data: hoje, valor: Math.abs(resNet), historico: histRes })
    if (resDed > 0) novas.push({ previsaoId: p.id, tipo: 'DEDUCAO', deducaoTipo: 'FUNDEB', data: hoje, valor: resDed, historico: histRes })

    // GATE por previsão: Σ novas == Σ atuais ao centavo, por tipo (net e dedução)
    const gNet = novas.reduce((s, n) => s + (n.tipo === 'ARRECADACAO' ? n.valor : n.tipo === 'ESTORNO' ? -n.valor : 0), 0)
    const gDed = novas.reduce((s, n) => s + (n.tipo === 'DEDUCAO' ? n.valor : 0), 0)
    if (gNet !== alvoNet || gDed !== alvoDed) throw new Error(`GATE interno falhou na previsão ${p.id} (${k}): net ${gNet}≠${alvoNet} ou ded ${gDed}≠${alvoDed}`)

    const ent = porEntidade.get(p.entidadeId) ?? { novas: [], previsoes: [] }
    ent.novas.push(...novas)
    ent.previsoes.push(p.id)
    porEntidade.set(p.entidadeId, ent)
    stats.ok++
    stats.okValor += alvoNet
  }

  console.log(`  mensalizáveis 1:1: ${stats.ok} previsões (Σ líquida ${R(stats.okValor)})`)
  if (stats.ambiguas) console.log(`  ⚠ ambíguas (candidato não-único; ficam como estão): ${stats.ambiguas} previsões (Σ ${R(stats.ambValor)})`)
  if (stats.semCelula) console.log(`  ⚠ sem célula na MSC (ficam como estão): ${stats.semCelula} previsões (Σ ${R(stats.semCelValor)})`)
  if (stats.foraMarcador) console.log(`  ⚠ com lançamentos fora do marcador (não toco): ${stats.foraMarcador}`)
  if (stats.dedInconsistente) console.log(`  ⚠ dedução mensal inconsistente (ficam como estão): ${stats.dedInconsistente}`)
  if (!APPLY || !porEntidade.size) return

  const usuario = await prisma.usuario.findFirstOrThrow({ orderBy: { criadoEm: 'asc' }, select: { id: true } })
  for (const [entidadeId, { novas, previsoes }] of porEntidade) {
    const nome = prevs.find((p) => p.entidadeId === entidadeId)!.entidade
    await prisma.$transaction(
      async (tx) => {
        await tx.arrecadacao.deleteMany({ where: { previsaoId: { in: previsoes }, historico: { startsWith: HIST_PREFIXO } } })
        await tx.arrecadacao.createMany({
          data: novas.map((n) => ({
            previsaoId: n.previsaoId, tipo: n.tipo, deducaoTipo: n.deducaoTipo, data: n.data,
            valor: new Prisma.Decimal(n.valor).div(100).toFixed(2), historico: n.historico,
          })),
        })
      },
      { timeout: 300_000 },
    )
    console.log(`  ✓ ${nome}: ${previsoes.length} previsões → ${novas.length} linhas mensais+resíduo`)
    const raz = await materializarRazao(prisma, entidadeId, ANO, usuario.id)
    console.log(`    razão re-materializado: ${raz.arrecadacoes} arrec + ${raz.movimentos} movimentos`)
  }

  // verificação pós-apply: perfil mensal + YTD por previsão intacto
  const perfil: { mes: number; v: number }[] = await prisma.$queryRawUnsafe(`
    SELECT EXTRACT(MONTH FROM a.data)::int AS mes, SUM(CASE a.tipo WHEN 'ESTORNO' THEN -a.valor ELSE a.valor END)::float AS v
    FROM arrecadacoes a JOIN previsoes_receita p ON p.id = a."previsaoId"
    JOIN orcamentos o ON o.id = p."orcamentoId" AND o.ano = ${ANO}
    JOIN entidades e ON e.id = o."entidadeId" JOIN municipios m ON m.id = e."municipioId"
    WHERE m.nome = '${nomeDev.replace(/'/g, "''")}' GROUP BY 1 ORDER BY 1`)
  console.log(`  perfil mensal (bruta, mi): ${perfil.map((r) => `${r.mes}:${Math.round(r.v / 1e6)}`).join(' ')}`)
  const quebradas: { n: number }[] = await prisma.$queryRawUnsafe(`
    SELECT COUNT(*)::int AS n FROM previsoes_receita p
    JOIN orcamentos o ON o.id = p."orcamentoId" AND o.ano = ${ANO}
    JOIN entidades e ON e.id = o."entidadeId" JOIN municipios m ON m.id = e."municipioId"
    WHERE m.nome = '${nomeDev.replace(/'/g, "''")}'
      AND ABS(COALESCE((SELECT SUM(CASE a.tipo WHEN 'ARRECADACAO' THEN a.valor WHEN 'ESTORNO' THEN -a.valor WHEN 'DEDUCAO' THEN a.valor END)
        FROM arrecadacoes a WHERE a."previsaoId" = p.id), 0) - (p."valorArrecadado")) > 0.01
      AND p."valorArrecadado" <> 0`)
  console.log(quebradas[0]!.n === 0
    ? '  ✓ verificação: Σ linhas = valorArrecadado em todas as previsões'
    : `  ⚠ ${quebradas[0]!.n} previsões com Σ linhas ≠ valorArrecadado (semântica líquida/bruta — conferir)`)
}

async function main() {
  const escolhidos = alvoArg === 'todos' ? CONFIGS : CONFIGS.filter(([n]) => n === alvoArg)
  if (!escolhidos.length) { console.error(`município '${alvoArg}' fora do escopo (${CONFIGS.map(([n]) => n).join(' · ')} | todos)`); process.exitCode = 1; return }
  for (const [nome, cfg] of escolhidos) await mensalizarMunicipio(nome, cfg)
  if (!APPLY) console.log('\nDRY-RUN: nada gravado. Rode com --apply.')
}
main().catch((e) => { console.error('FALHOU:', e instanceof Error ? e.stack || e.message : e); process.exitCode = 1 }).finally(async () => { await prisma.$disconnect(); await pool.end() })
