/**
 * CÂMARA de Paranaguá 2026: orçado (LOA, do CSV "despesa por elemento" do IPM) +
 * empenhado (PIT), na MESMA dotação, no nível ELEMENTO.
 *
 * A Câmara tem UO/função/subfunção/programa/ação/fonte ÚNICOS (01.001 / 01 / 031
 * / 0001 / 2000 / fonte 001) — só a natureza varia. Então o CSV por elemento
 * casa 1:1 com a execução reconciliada ao elemento (sem ambiguidade de fonte/ação).
 *
 * Reconstrói a natureza: Código (cat.grp.mod, dropando o 1º díg "3") + coluna
 * "Elemento" (nº) → cat.grp.mod.ele.00.00.
 *
 * One-time: apaga as dotações da execução paralela da Câmara (empenho CAP-*) e
 * regrava por elemento com orçado+empenhado. DRY-RUN por padrão; --apply grava.
 *   npx tsx scripts/importar_camara_paranagua.ts [--csv <arq>] [--apply]
 */
import 'dotenv/config'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import JSZip from 'jszip'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'

const ANO = 2026
const IBGE6 = '411820'
const CSV = (() => { const i = process.argv.indexOf('--csv'); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : '/home/marco/Downloads/Relatorio (4).csv' })()
const APPLY = process.argv.includes('--apply')

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })
const cent = (s: string | undefined): number => Math.round(parseFloat((s || '0').trim().replace(/[^0-9.-]/g, '') || '0') * 100)
const reais = (c: number): string => (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// natureza no elemento a partir do Código (modalidade) + nº do elemento
function natureza(codigo19: string, elementoNum: string): string {
  const d = codigo19.slice(1) // dropa "3"
  const ele = String(parseInt(elementoNum, 10) || 0).padStart(2, '0')
  return `${d[0]}.${d[1]}.${d.slice(2, 4)}.${ele}.00.00`
}

// parser CSV real (aspas, ';', quebras internas)
function registros(txt: string): string[][] {
  const rows: string[][] = []; let f = '', row: string[] = [], q = false
  for (let i = 0; i < txt.length; i++) { const c = txt[i]!
    if (q) { if (c === '"') { if (txt[i + 1] === '"') { f += '"'; i++ } else q = false } else f += c }
    else if (c === '"') q = true
    else if (c === ';') { row.push(f); f = '' }
    else if (c === '\n') { row.push(f); rows.push(row); row = []; f = '' }
    else if (c !== '\r') f += c }
  if (f.length || row.length) { row.push(f); rows.push(row) }
  return rows
}

function lerLoa(): Map<string, number> {
  const rows = registros(readFileSync(CSV, 'latin1'))
  const prev = new Map<string, number>()
  for (const r of rows.slice(1)) {
    if (r.length < 7 || !(r[0] || '').includes('CAMARA')) continue
    const nat = natureza((r[4] || '').trim(), (r[3] || '').trim())
    prev.set(nat, (prev.get(nat) ?? 0) + cent(r[6]))
  }
  return prev
}

async function obterXml(): Promise<string> {
  const cache = join(tmpdir(), `pit_${ANO}_${IBGE6}_Despesa.zip`)
  let buf: Buffer
  if (existsSync(cache)) buf = readFileSync(cache)
  else { const res = await fetch(`https://pit.tce.pr.gov.br/Arquivos/${ANO}/${ANO}_${IBGE6}_Despesa.zip`); if (!res.ok) throw new Error(`PIT ${res.status}`); buf = Buffer.from(await res.arrayBuffer()); writeFileSync(cache, buf) }
  const zip = await JSZip.loadAsync(buf)
  const s = await zip.files[Object.keys(zip.files).find((n) => /_Empenho\.xml$/.test(n))!]!.async('string')
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s
}

function execCamara(xml: string): Map<string, { emp: number; liq: number; pag: number }> {
  const ex = new Map<string, { emp: number; liq: number; pag: number }>()
  for (const m of xml.matchAll(/<Empenho ([^>]*?)\/>/g)) {
    const a: Record<string, string> = {}
    for (const at of m[1]!.matchAll(/([A-Za-z]+)="([^"]*)"/g)) a[at[1]!] = at[2]!
    if (!(a.nmEntidade || '').includes('CÂMARA')) continue
    const nat = `${(a.cdCategoriaEconomica || '').trim()}.${(a.cdGrupoNatureza || '').trim()}.${(a.cdModalidade || '').trim()}.${(a.cdElemento || '').trim()}.00.00`
    let d = ex.get(nat); if (!d) ex.set(nat, (d = { emp: 0, liq: 0, pag: 0 }))
    d.emp += cent(a.vlEmpenho); d.liq += cent(a.vlLiquidacao); d.pag += cent(a.vlPagamento)
  }
  return ex
}

async function main() {
  console.log(`\n═══ Câmara de Paranaguá — orçado(LOA)+empenhado(PIT) por elemento ${APPLY ? '[APPLY]' : '[DRY-RUN]'} ═══`)
  const loa = lerLoa()
  const exec = execCamara(await obterXml())
  const totLoa = [...loa.values()].reduce((a, b) => a + b, 0)
  const totEmp = [...exec.values()].reduce((a, d) => a + d.emp, 0)
  console.log(`LOA: ${loa.size} naturezas · Σ ${reais(totLoa)}  (alvo 53.900.000,00)`)
  console.log(`Execução PIT: ${exec.size} naturezas · Σ empenhado ${reais(totEmp)}  (alvo 10.372.853,82)`)

  const cam = await prisma.entidade.findFirstOrThrow({ where: { tipo: 'CAMARA', municipio: { is: { nome: 'Paranaguá', estado: { is: { sigla: 'PR' } } } } }, select: { id: true, nome: true } })
  const orc = await prisma.orcamento.findUniqueOrThrow({ where: { entidadeId_ano: { entidadeId: cam.id, ano: ANO } }, select: { id: true } })
  // função/subfunção são globais; as demais dimensões da Câmara são ÚNICAS e
  // provisionadas se ausentes (pós-onboarding/clobber elas não existem).
  const func = (await prisma.funcao.findFirstOrThrow({ where: { codigo: '01' }, select: { id: true } })).id
  const subf = (await prisma.subfuncao.findFirstOrThrow({ where: { codigo: '031' }, select: { id: true } })).id
  const contasDb = new Map((await prisma.contaDespesaEntidade.findMany({ where: { entidadeId: cam.id, ano: ANO }, select: { codigo: true, id: true } })).map((c) => [c.codigo, c.id]))
  const resolverConta = (nat: string): string | null => contasDb.get(nat) ?? contasDb.get(`${nat.split('.').slice(0, 4).join('.')}.00.00`) ?? null

  const naturezas = new Set([...loa.keys(), ...exec.keys()])
  const semConta = [...naturezas].filter((n) => !resolverConta(n))
  console.log(`naturezas (união LOA+exec): ${naturezas.size}${semConta.length ? ` · SEM conta: ${semConta.join(' ')}` : ' · todas resolvem'}`)
  const faltam = [
    !(await prisma.unidadeOrcamentaria.findFirst({ where: { entidadeId: cam.id, codigo: '01.001' } })) && 'UO 01.001',
    !(await prisma.programa.findFirst({ where: { entidadeId: cam.id, ano: ANO, codigo: '0001' } })) && 'programa 0001',
    !(await prisma.acao.findFirst({ where: { codigo: '2000', programa: { entidadeId: cam.id, ano: ANO } } })) && 'ação 2000',
    !(await prisma.fonteRecursoEntidade.findFirst({ where: { entidadeId: cam.id, ano: ANO, codigo: '001' } })) && 'fonte 001',
  ].filter(Boolean) as string[]
  if (faltam.length) console.log(`dims únicas a provisionar: ${faltam.join(' · ')}`)
  if (!APPLY) { console.log('\nDRY-RUN: nada gravado. Rode com --apply.'); return }
  if (semConta.length) throw new Error('há natureza sem conta — abortando')

  const usuario = await prisma.usuario.findFirstOrThrow({ orderBy: { criadoEm: 'asc' }, select: { id: true } })
  const fornecedor = await prisma.fornecedor.findFirstOrThrow({ where: { razaoSocial: 'CAPTURA PIT/TCE-PR' }, select: { id: true } })
  const dataMov = new Date(Date.UTC(ANO, 11, 31)); const historico = `CAPTURA PIT execução ${ANO}`

  await prisma.$transaction(async (tx) => {
    // apaga execução paralela antiga da Câmara
    const antigas = (await tx.dotacaoDespesa.findMany({ where: { orcamentoId: orc.id, empenhos: { some: { numero: { startsWith: 'CAP-' } } } }, select: { id: true } })).map((d) => d.id)
    await tx.movimentoEmpenho.deleteMany({ where: { entidadeId: cam.id } })
    await tx.empenho.deleteMany({ where: { entidadeId: cam.id, numero: { startsWith: 'CAP-' } } })
    await tx.dotacaoDespesa.deleteMany({ where: { id: { in: antigas } } })

    // provisiona as dimensões ÚNICAS da Câmara se ausentes (nomes reais do PIT)
    const uo = ((await tx.unidadeOrcamentaria.findFirst({ where: { entidadeId: cam.id, codigo: '01.001' }, select: { id: true } })) ?? (await tx.unidadeOrcamentaria.create({ data: { entidadeId: cam.id, codigo: '01.001', nome: 'Câmara Municipal de Paranaguá' }, select: { id: true } }))).id
    const prog = ((await tx.programa.findFirst({ where: { entidadeId: cam.id, ano: ANO, codigo: '0001' }, select: { id: true } })) ?? (await tx.programa.create({ data: { entidadeId: cam.id, ano: ANO, codigo: '0001', nome: 'Processo Legislativo', tipo: 'FINALISTICO' }, select: { id: true } }))).id
    const acao = ((await tx.acao.findFirst({ where: { codigo: '2000', programaId: prog }, select: { id: true } })) ?? (await tx.acao.create({ data: { programaId: prog, codigo: '2000', nome: 'Aprimoramento e Gestão do Processo Legislativo Municipal', tipo: 'ATIVIDADE' }, select: { id: true } }))).id
    const fonte = ((await tx.fonteRecursoEntidade.findFirst({ where: { entidadeId: cam.id, ano: ANO, codigo: '001' }, select: { id: true } })) ?? (await tx.fonteRecursoEntidade.create({ data: { entidadeId: cam.id, ano: ANO, codigo: '001', nomenclatura: 'Recursos do Tesouro (Descentralizados)', vinculada: false, origem: 'DESDOBRAMENTO' }, select: { id: true } }))).id

    const movRows: any[] = []; let comAmbos = 0, soOrc = 0, soEmp = 0
    for (const nat of naturezas) {
      const aut = (loa.get(nat) ?? 0); const e = exec.get(nat) ?? { emp: 0, liq: 0, pag: 0 }
      if (aut && e.emp) comAmbos++; else if (aut) soOrc++; else soEmp++
      const dotKey = { orcamentoId: orc.id, unidadeOrcamentariaId: uo, funcaoId: func, subfuncaoId: subf, programaId: prog, acaoId: acao, contaDespesaEntidadeId: resolverConta(nat)!, fonteRecursoEntidadeId: fonte }
      const dot = await tx.dotacaoDespesa.upsert({
        where: { dotacao_unica: dotKey },
        create: { ...dotKey, valorAutorizado: (aut / 100).toFixed(2), valorEmpenhado: (e.emp / 100).toFixed(2) },
        update: { valorAutorizado: (aut / 100).toFixed(2), valorEmpenhado: (e.emp / 100).toFixed(2) },
        select: { id: true },
      })
      if (e.emp) {
        const numero = `CAP-${dot.id.slice(0, 8)}`
        const emp = await tx.empenho.upsert({ where: { entidadeId_numero: { entidadeId: cam.id, numero } }, create: { entidadeId: cam.id, dotacaoDespesaId: dot.id, fornecedorId: fornecedor.id, numero, tipo: 'ESTIMATIVO', data: dataMov, valor: (e.emp / 100).toFixed(2), valorLiquidado: (e.liq / 100).toFixed(2), historico: 'Empenho de CAPTURA da execução do PIT/TCE-PR (não é escrituração).' }, update: { valor: (e.emp / 100).toFixed(2), valorLiquidado: (e.liq / 100).toFixed(2) }, select: { id: true } })
        if (e.emp) movRows.push({ entidadeId: cam.id, empenhoId: emp.id, tipo: 'EMPENHO', valor: (e.emp / 100).toFixed(2), data: dataMov, criadoPorId: usuario.id, historico })
        if (e.liq) movRows.push({ entidadeId: cam.id, empenhoId: emp.id, tipo: 'LIQUIDACAO', valor: (e.liq / 100).toFixed(2), data: dataMov, criadoPorId: usuario.id, historico })
        if (e.pag) movRows.push({ entidadeId: cam.id, empenhoId: emp.id, tipo: 'PAGAMENTO', valor: (e.pag / 100).toFixed(2), data: dataMov, criadoPorId: usuario.id, historico })
      }
    }
    await tx.movimentoEmpenho.createMany({ data: movRows })
    console.log(`  [apply] dotações: ${naturezas.size} (orçado+empenhado ${comAmbos} · só orçado ${soOrc} · só empenho ${soEmp}) · movimentos ${movRows.length}`)
  }, { timeout: 120_000 })
}

main().catch((e) => { console.error('FALHOU:', e instanceof Error ? e.stack || e.message : e); process.exitCode = 1 }).finally(async () => { await prisma.$disconnect(); await pool.end() })
