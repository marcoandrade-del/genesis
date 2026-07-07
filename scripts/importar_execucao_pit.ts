/**
 * CONCILIA a execução da despesa registrada no Gênesis com os dados abertos
 * do PIT/TCE-PR (XMLs nível-empenho do SIM-AM) — prova real EXTERNA da
 * captura do portal Elotech.
 *
 * Por que importa: a captura mensal (sincronizacao-portal) RATEIA o valor
 * entre as fontes da dotação proporcionalmente ao autorizado (a API da
 * Elotech ignora o filtro de fonte). O PIT traz a FONTE REAL empenho a
 * empenho (fonte TCE, independente da Elotech) — esta conciliação mede o
 * erro do rateio por mês × função × fonte e valida os totais.
 *
 * Fonte dos dados: https://pit.tce.pr.gov.br/Arquivos/{ano}/{ano}_{ibge6}_Despesa.zip
 * (gerado semanalmente das remessas FECHADAS do SIM-AM; ver memória
 * tce-pr-pit-dados-abertos). Dentro: Empenho.xml (nível empenho, atributos),
 * EmpenhoLiquidacao/EmpenhoPagamento + estornos + docs fiscais.
 * ⚠️ EmpenhoPagamento.xml tem atributos DESALINHADOS pelo gerador do TCE
 * (vlPagamentoBruto="CAIXA"...) — o valor confiável é vlOperacao.
 *
 * READ-ONLY: nada grava no banco. Um futuro --apply (true-up de fonte) só
 * será considerado depois de avaliadas as divergências desta conciliação.
 *
 * Rodar: npx tsx scripts/importar_execucao_pit.ts [--zip <caminho.zip>]
 *        [--ano 2026] [--ibge 411520] [--pit-entidade "MUNICÍPIO DE MARINGÁ"]
 */

import 'dotenv/config'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import JSZip from 'jszip'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'

// ── args ────────────────────────────────────────────────────────────────────
function arg(nome: string, padrao: string): string {
  const i = process.argv.indexOf(nome)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : padrao
}
const ANO = parseInt(arg('--ano', '2026'), 10)
const IBGE6 = arg('--ibge', '411520')
const ZIP_ARG = arg('--zip', '')
const PIT_ENTIDADE = arg('--pit-entidade', 'MUNICÍPIO DE MARINGÁ')

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

// centavos p/ não acumular erro de float
const cent = (s: string | undefined): number => Math.round(parseFloat(s || '0') * 100)
const reais = (c: number): string =>
  (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// ── 1. obter o ZIP do PIT ───────────────────────────────────────────────────
async function obterZip(): Promise<Buffer> {
  if (ZIP_ARG) {
    console.log(`ZIP local: ${ZIP_ARG}`)
    return readFileSync(ZIP_ARG)
  }
  const url = `https://pit.tce.pr.gov.br/Arquivos/${ANO}/${ANO}_${IBGE6}_Despesa.zip`
  const cache = join(tmpdir(), `pit_${ANO}_${IBGE6}_Despesa.zip`)
  if (existsSync(cache)) {
    console.log(`ZIP em cache: ${cache}`)
    return readFileSync(cache)
  }
  console.log(`Baixando ${url} ...`)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`download falhou: HTTP ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  writeFileSync(cache, buf)
  console.log(`  ${(buf.length / 1e6).toFixed(1)} MB (cache: ${cache})`)
  return buf
}

// ── 2. parse dos XMLs (self-closing tags com atributos) ─────────────────────
type Attrs = Record<string, string>
function* registros(xml: string, tag: string): Generator<Attrs> {
  for (const m of xml.matchAll(new RegExp(`<${tag} ([^>]*?)/>`, 'g'))) {
    const attrs: Attrs = {}
    for (const a of m[1].matchAll(/([A-Za-z]+)="([^"]*)"/g)) attrs[a[1]] = a[2]
    yield attrs
  }
}

// De/para dos códigos IRREGULARES — fogem da regra geral d+g+spec (a família
// "via decreto" 21045 usa grupo+spec4 sem destino; 231150 não tem irmão g2 no
// catálogo). Casados por NOMENCLATURA/valor contra o catálogo (2026-07-07).
const DE_PARA_FONTE: Record<string, string> = {
  '1045': '11045', // Outros Recursos não Vinculados (g1)
  '2045': '21045', // idem, exercícios anteriores (g2)
  '231150': '31150', // PETE g2 → catálogo só tem o g1
}

type Agregado = { emp: number; liq: number; pag: number }

async function lerPit(zipBuf: Buffer, fontesCatalogo: Set<string>) {
  const zip = await JSZip.loadAsync(zipBuf)
  const nomeXml = Object.keys(zip.files).find((n) => /_Empenho\.xml$/.test(n))
  if (!nomeXml) throw new Error(`Empenho.xml não encontrado no ZIP (${Object.keys(zip.files).join(', ')})`)
  const xml = await zip.files[nomeXml].async('string')

  const porEntidade = new Map<string, number>()
  const porMFF = new Map<string, Agregado>() // mes|funcao|fonte (entidade-alvo, incl. intra-91)
  const total: Agregado = { emp: 0, liq: 0, pag: 0 }
  const intra: Agregado = { emp: 0, liq: 0, pag: 0 } // recorte informativo da modalidade 91
  let nAlvo = 0
  let corte = ''

  for (const r of registros(xml, 'Empenho')) {
    porEntidade.set(r.nmEntidade, (porEntidade.get(r.nmEntidade) ?? 0) + 1)
    if (r.nmEntidade !== PIT_ENTIDADE) continue
    nAlvo++
    corte = corte || `${r.ultimoEnvioSIMAMNesteExercicio} (referência ${(r.DataReferencia || '').trim()})`
    const emp = cent(r.vlEmpenho)
    const liq = cent(r.vlLiquidacao)
    const pag = cent(r.vlPagamento)
    total.emp += emp
    total.liq += liq
    total.pag += pag
    if (r.cdModalidade === '91') {
      // intra-orçamentária — só um recorte informativo; ela FICA na comparação
      // (o balancete Elotech jan–mai, que inclui a 91, bateu o banco ao centavo
      // em 2026-07-06 — logo a captura do dashboard também a inclui).
      intra.emp += emp
      intra.liq += liq
      intra.pag += pag
    }
    const mes = parseInt(r.nrMesCompetencia || '0', 10)
    // Fonte no código do catálogo (QDD/LOA) = cdGrupoFonte + cdFonteReceita, SEM
    // padding: 1+000→1000, 1+486→1486, 1+097→1097 (regra validada contra
    // FonteRecursoEntidade de Maringá 2026). Atenção: é a fonte da RECEITA
    // (cdFonteReceita) — o cdFontePadrao (despesa) diverge (494≠486) e NÃO casa.
    // As fontes de safra nova (spec 4 dígitos) fogem da regra: o prefixo do
    // catálogo é o grupo de DESTINAÇÃO Elotech/TCE (1=tesouro, 3=transf.
    // federal, 4=op. crédito), não o grupo de exercício do PIT — de/para
    // explícito abaixo, casado por NOMENCLATURA contra o catálogo (2026-07-07).
    const g = (r.cdGrupoFonte || '1').trim()
    const spec = (r.cdFonteReceita || '').trim()
    const composto = `${g}${spec}`
    // Codificação do catálogo (Elotech/QDD) p/ fontes de 5 dígitos:
    //   destino(1 díg: 1=tesouro, 3=transf. federal, 4=op. crédito, 5=doações…)
    //   + grupoExercício(1 díg: 1=corrente, 2=anteriores) + spec(3 díg).
    // O PIT manda grupo+spec (sem destino) — o resolver tenta, nesta ordem:
    // composto direto no catálogo → DE_PARA (irregulares) → candidato ÚNICO
    // d+g+spec3 no catálogo → pendente (listado no relatório).
    let fonte = composto
    if (!fontesCatalogo.has(composto)) {
      const dePara = DE_PARA_FONTE[composto]
      if (dePara) fonte = dePara
      else {
        const spec3 = spec.slice(-3)
        const candidatos = ['1', '2', '3', '4', '5', '6', '7', '8', '9']
          .map((d) => `${d}${g}${spec3}`)
          .filter((c) => fontesCatalogo.has(c))
        if (candidatos.length === 1) fonte = candidatos[0]
      }
    }
    const chave = `${mes}|${r.cdFuncao}|${fonte}`
    const ag = porMFF.get(chave) ?? { emp: 0, liq: 0, pag: 0 }
    ag.emp += emp
    ag.liq += liq
    ag.pag += pag
    porMFF.set(chave, ag)
  }
  return { porEntidade, porMFF, total, intra, nAlvo, corte }
}

// ── 3. agregado do banco (MovimentoEmpenho → dotação → função/fonte) ────────
async function lerBanco() {
  const entidade = await prisma.entidade.findFirst({
    where: {
      tipo: 'PREFEITURA',
      municipio: { is: { nome: { contains: 'Maring', mode: 'insensitive' }, estado: { is: { sigla: 'PR' } } } },
    },
    select: { id: true, nome: true },
  })
  if (!entidade) throw new Error('entidade PREFEITURA de Maringá/PR não encontrada no banco')

  const movs = await prisma.movimentoEmpenho.findMany({
    where: { entidadeId: entidade.id, data: { gte: new Date(`${ANO}-01-01`), lte: new Date(`${ANO}-12-31`) } },
    select: {
      tipo: true,
      valor: true,
      data: true,
      empenho: {
        select: {
          numero: true,
          dotacaoDespesa: { select: { funcao: { select: { codigo: true } }, fonteRecurso: { select: { codigo: true } } } },
        },
      },
    },
  })

  const SINAL: Record<string, { campo: keyof Agregado; s: number }> = {
    EMPENHO: { campo: 'emp', s: 1 },
    ESTORNO_EMPENHO: { campo: 'emp', s: -1 },
    LIQUIDACAO: { campo: 'liq', s: 1 },
    ESTORNO_LIQUIDACAO: { campo: 'liq', s: -1 },
    PAGAMENTO: { campo: 'pag', s: 1 },
    ESTORNO_PAGAMENTO: { campo: 'pag', s: -1 },
  }

  const porMFF = new Map<string, Agregado>()
  const total: Agregado = { emp: 0, liq: 0, pag: 0 }
  let nCap = 0
  let nOutros = 0

  for (const mv of movs) {
    const { campo, s } = SINAL[mv.tipo]
    const v = s * Math.round(Number(mv.valor) * 100)
    total[campo] += v
    const mes = mv.data.getUTCMonth() + 1
    const fonte = mv.empenho.dotacaoDespesa.fonteRecurso.codigo.trim()
    const funcao = mv.empenho.dotacaoDespesa.funcao.codigo
    const chave = `${mes}|${funcao}|${fonte}`
    const ag = porMFF.get(chave) ?? { emp: 0, liq: 0, pag: 0 }
    ag[campo] += v
    porMFF.set(chave, ag)
    if (mv.empenho.numero.startsWith('CAP-')) nCap++
    else nOutros++
  }
  const catalogo = new Set(
    (
      await prisma.fonteRecursoEntidade.findMany({ where: { entidadeId: entidade.id, ano: ANO }, select: { codigo: true } })
    ).map((f) => f.codigo.trim()),
  )
  return { entidade, porMFF, total, nCap, nOutros, catalogo }
}

// ── 4. relatório ────────────────────────────────────────────────────────────
function linha(rotulo: string, pit: number, banco: number): string {
  const d = banco - pit
  const pct = pit !== 0 ? ((d / pit) * 100).toFixed(2) : '—'
  return `${rotulo.padEnd(28)} ${reais(pit).padStart(18)} ${reais(banco).padStart(18)} ${reais(d).padStart(15)} ${String(pct).padStart(8)}%`
}

async function main() {
  console.log(`\n═══ Conciliação execução da despesa ${ANO} — PIT/TCE-PR × Gênesis (READ-ONLY) ═══\n`)
  const zipBuf = await obterZip()
  const banco = await lerBanco()
  const fontesCatalogo = banco.catalogo // catálogo COMPLETO (não só fontes com movimento)
  const pit = await lerPit(zipBuf, fontesCatalogo)

  console.log(`\nPIT: entidade-alvo "${PIT_ENTIDADE}" → ${pit.nAlvo} empenhos · corte SIM-AM: ${pit.corte}`)
  console.log('     entidades no arquivo:')
  for (const [nome, n] of [...pit.porEntidade].sort((a, b) => b[1] - a[1]))
    console.log(`       ${String(n).padStart(6)}  ${nome}`)
  console.log(`\nBanco: "${banco.entidade.nome}" · movimentos de empenhos CAP-*: ${banco.nCap} · outros: ${banco.nOutros}`)

  // meses comparáveis: onde AMBOS têm empenhado (o PIT corta na remessa fechada)
  const mesesPit = new Set([...pit.porMFF.keys()].map((k) => parseInt(k.split('|')[0], 10)))
  const mesesBanco = new Set([...banco.porMFF.keys()].map((k) => parseInt(k.split('|')[0], 10)))
  const meses = [...mesesPit].filter((m) => mesesBanco.has(m)).sort((a, b) => a - b)
  console.log(`\nMeses no PIT: ${[...mesesPit].sort((a, b) => a - b).join(', ')} · no banco: ${[...mesesBanco].sort((a, b) => a - b).join(', ')} · comparáveis: ${meses.join(', ')}`)

  const filtra = (m: Map<string, Agregado>, pred: (mes: number, fun: string, fonte: string) => boolean): Agregado => {
    const t = { emp: 0, liq: 0, pag: 0 }
    for (const [k, v] of m) {
      const [mesS, fun, fonte] = k.split('|')
      if (!pred(parseInt(mesS, 10), fun, fonte)) continue
      t.emp += v.emp
      t.liq += v.liq
      t.pag += v.pag
    }
    return t
  }
  const pitPer = filtra(pit.porMFF, (mes) => meses.includes(mes))
  const bancoPer = filtra(banco.porMFF, (mes) => meses.includes(mes))

  console.log(`\n── TOTAIS ── (PIT = valor EMITIDO/bruto; Gênesis = líquido de anulações ⇒ Δ ≈ anulações)`)
  console.log(`Recorte informativo: intra-91 no PIT = ${reais(pit.intra.emp)} (incluída nos dois lados)`)
  console.log(`${''.padEnd(28)} ${'PIT (bruto)'.padStart(18)} ${'Gênesis (líq.)'.padStart(18)} ${'Δ (Gên−PIT)'.padStart(15)} ${'Δ%'.padStart(9)}`)
  console.log(linha('Empenhado (meses compar.)', pitPer.emp, bancoPer.emp))
  console.log(linha('Liquidado (acum. no corte)', pit.total.liq, banco.total.liq))
  console.log(linha('Pago      (acum. no corte)', pit.total.pag, banco.total.pag))

  // Cobertura do de/para de fonte: quanto do empenhado PIT caiu em código que existe no catálogo
  const fontesBanco = new Set([...banco.porMFF.keys()].map((k) => k.split('|')[2]))
  let cobertos = 0
  const semPar = new Map<string, number>()
  for (const [k, v] of pit.porMFF) {
    const fonte = k.split('|')[2]
    if (fontesBanco.has(fonte)) cobertos += v.emp
    else semPar.set(fonte, (semPar.get(fonte) ?? 0) + v.emp)
  }
  console.log(`\nCobertura do código de fonte (PIT→catálogo): ${((cobertos / pit.total.emp) * 100).toFixed(1)}% do empenhado`)
  const pendentes = [...semPar].sort((a, b) => b[1] - a[1]).slice(0, 8)
  if (pendentes.length) {
    console.log(`  códigos sem par no banco (de/para pendente): ${pendentes.map(([f, v]) => `${f} (${reais(v)})`).join(' · ')}`)
  }

  console.log(`\n── EMPENHADO por mês ──`)
  for (const mes of meses) {
    const p = filtra(pit.porMFF, (m) => m === mes)
    const b = filtra(banco.porMFF, (m) => m === mes)
    console.log(linha(`  ${String(mes).padStart(2, '0')}/${ANO}`, p.emp, b.emp))
  }

  const porDim = (idx: 1 | 2) => {
    const chaves = new Set<string>()
    for (const mapa of [pit.porMFF, banco.porMFF])
      for (const k of mapa.keys()) if (meses.includes(parseInt(k.split('|')[0], 10))) chaves.add(k.split('|')[idx])
    const linhas: { chave: string; p: number; b: number }[] = []
    for (const c of chaves) {
      const p = filtra(pit.porMFF, (m, fun, fonte) => meses.includes(m) && (idx === 1 ? fun : fonte) === c)
      const b = filtra(banco.porMFF, (m, fun, fonte) => meses.includes(m) && (idx === 1 ? fun : fonte) === c)
      linhas.push({ chave: c, p: p.emp, b: b.emp })
    }
    return linhas.sort((x, y) => Math.abs(y.b - y.p) - Math.abs(x.b - x.p))
  }

  console.log(`\n── EMPENHADO por FUNÇÃO (ordenado por |Δ|) ──`)
  for (const l of porDim(1)) console.log(linha(`  função ${l.chave}`, l.p, l.b))

  console.log(`\n── EMPENHADO por FONTE (top 20 |Δ| — mede o erro do RATEIO da captura) ──`)
  for (const l of porDim(2).slice(0, 20)) console.log(linha(`  fonte ${l.chave || '(vazia)'}`, l.p, l.b))

  console.log(`\nNotas de leitura:`)
  console.log(`  • O PIT corta na remessa fechada do SIM-AM (${pit.corte}); liquidado/pago do PIT são`)
  console.log(`    acumulados até o corte (atributos do Empenho.xml), o banco acumula o ano.`)
  console.log(`  • PIT traz o valor EMITIDO (bruto) do empenho; o banco captura o LÍQUIDO de anulações`)
  console.log(`    do dashboard — Δ negativo ≈ anulações (concentradas em janeiro/estimativas).`)
  console.log(`    Validação externa 2026-07-06: balancete Elotech jan–mai (data/balancete_despesa_...)`)
  console.log(`    = banco AO CENTAVO (1.513,9mi, incl. intra-91) — a captura CAP-* está íntegra.`)
  console.log(`  • Fonte: PIT usa códigos TCE por safra; o de/para p/ o catálogo (QDD) é`)
  console.log(`    cdGrupoFonte+cdFonteReceita — resolve as fontes grandes; pendências listadas acima.`)
  console.log(`    P/ true-up de fonte da captura, a MELHOR base é o balancete Elotech (mesmos códigos).`)
  console.log(`Nada foi gravado (conciliação read-only).\n`)

  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error('FALHOU:', e instanceof Error ? e.message : e)
  await prisma.$disconnect()
  process.exit(1)
})
