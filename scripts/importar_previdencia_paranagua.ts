/**
 * PREVIDÊNCIA de Paranaguá 2026: orçado (LOA/QDD do IPM, com fonte) + empenhado
 * (PIT), reconciliados na MESMA dotação, no nível ELEMENTO.
 *
 * QDD `Relatorio (5).csv` (Órgão/Unidade/Ação/Elemento/Vínculo/Funcional/Total)
 * = mesmo formato da Prefeitura → dotação completa com fonte. A execução do PIT
 * usa códigos de fonte diferentes → de/para por DESCRIÇÃO (dinâmico), como na
 * Prefeitura. Natureza agregada ao elemento.
 *
 * One-time: apaga a execução paralela da Previdência (CAP-*) e regrava.
 *   npx tsx scripts/importar_previdencia_paranagua.ts [--csv <arq>] [--apply]
 */
import 'dotenv/config'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import JSZip from 'jszip'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'

const ANO = 2026, IBGE6 = '411820'
const CSV = (() => { const i = process.argv.indexOf('--csv'); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : '/home/marco/Downloads/Relatorio (5).csv' })()
const APPLY = process.argv.includes('--apply')
const arg = (n: string, d: string) => { const i = process.argv.indexOf(n); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : d }
const NOME = arg('--nome', 'Paranaguá Previdência'), PIT_MATCH = arg('--pit-match', 'PREVIDÊNCIA')

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })
const cent = (s: string | undefined): number => Math.round(parseFloat((s || '0').trim() || '0') * 100)
const reais = (c: number): string => (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const norm = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
// natureza no elemento (dropa 1º díg "3")
const naturezaDe = (e: string) => { const d = e.slice(1); return `${d[0]}.${d[1]}.${d.slice(2, 4)}.${d.slice(4, 6)}.00.00` }
function funcional(f: string) { const [a, b, c] = f.split('.'); return { funcao: String(parseInt(a || '0', 10)).padStart(2, '0'), subfuncao: String(parseInt(b || '0', 10)).padStart(3, '0'), programa: (c || '').padStart(4, '0') } }
const tipoPrograma = (c: string) => (c === '0000' || c === '9999' ? 'OPERACOES_ESPECIAIS' : 'FINALISTICO') as const
const tipoAcao = (c: string) => (c.startsWith('1') ? 'PROJETO' : c.startsWith('2') ? 'ATIVIDADE' : 'OPERACAO_ESPECIAL') as const
function registros(txt: string): string[][] { const rows: string[][] = []; let f = '', row: string[] = [], q = false; for (let i = 0; i < txt.length; i++) { const c = txt[i]!; if (q) { if (c === '"') { if (txt[i + 1] === '"') { f += '"'; i++ } else q = false } else f += c } else if (c === '"') q = true; else if (c === ';') { row.push(f); f = '' } else if (c === '\n') { row.push(f); rows.push(row); row = []; f = '' } else if (c !== '\r') f += c } if (f.length || row.length) { row.push(f); rows.push(row) } return rows }

type Dot = { uoCod: string; uoNome: string; funcao: string; subfuncao: string; programa: string; acao: string; acaoNome: string; natureza: string; fonte: string; fonteNome: string }
function lerQdd() {
  const loa = new Map<string, { d: Dot; valor: number }>(); const vinc = new Map<string, string>()
  for (const f of registros(readFileSync(CSV, 'latin1')).slice(1)) {
    if (f.length < 16) continue
    const fn = funcional((f[12] || '').trim())
    const d: Dot = { uoCod: `${(f[1] || '').trim()}.${(f[3] || '').trim()}`, uoNome: (f[4] || '').trim(), ...fn, acao: (f[5] || '').trim(), acaoNome: (f[6] || '').trim(), natureza: naturezaDe((f[8] || '').trim()), fonte: (f[10] || '').trim(), fonteNome: (f[11] || '').trim() }
    vinc.set(d.fonte, d.fonteNome)
    const k = `${d.uoCod}|${d.funcao}|${d.subfuncao}|${d.programa}|${d.acao}|${d.natureza}|${d.fonte}`
    const g = loa.get(k); if (g) g.valor += cent(f[15]); else loa.set(k, { d, valor: cent(f[15]) })
  }
  return { loa, vinc }
}
async function obterXml() { const cache = join(tmpdir(), `pit_${ANO}_${IBGE6}_Despesa.zip`); let buf: Buffer; if (existsSync(cache)) buf = readFileSync(cache); else { const r = await fetch(`https://pit.tce.pr.gov.br/Arquivos/${ANO}/${ANO}_${IBGE6}_Despesa.zip`); buf = Buffer.from(await r.arrayBuffer()); writeFileSync(cache, buf) } const zip = await JSZip.loadAsync(buf); const s = await zip.files[Object.keys(zip.files).find((n) => /_Empenho\.xml$/.test(n))!]!.async('string'); return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s }

function execPit(xml: string) {
  const ex = new Map<string, { uoCod: string; funcao: string; subfuncao: string; programa: string; acao: string; acaoNome: string; natureza: string; fonte: string; emp: number; liq: number; pag: number }>()
  const fdesc = new Map<string, string>()
  for (const m of xml.matchAll(/<Empenho ([^>]*?)\/>/g)) {
    const a: Record<string, string> = {}; for (const at of m[1]!.matchAll(/([A-Za-z]+)="([^"]*)"/g)) a[at[1]!] = at[2]!
    if (!(a.nmEntidade || '').includes(PIT_MATCH)) continue
    const fonte = (a.cdFontePadrao || '').trim(); fdesc.set(fonte, (a.dsFontePadrao || '').trim())
    const uoCod = `${(a.cdOrgao || '').trim()}.${(a.cdUnidade || '').trim()}`
    const natureza = `${(a.cdCategoriaEconomica || '').trim()}.${(a.cdGrupoNatureza || '').trim()}.${(a.cdModalidade || '').trim()}.${(a.cdElemento || '').trim()}.00.00`
    const k = `${uoCod}|${(a.cdFuncao || '').trim()}|${(a.cdSubFuncao || '').trim()}|${(a.cdPrograma || '').trim()}|${(a.cdProjetoAtividade || '').trim()}|${natureza}|${fonte}`
    let d = ex.get(k); if (!d) ex.set(k, (d = { uoCod, funcao: (a.cdFuncao || '').trim(), subfuncao: (a.cdSubFuncao || '').trim(), programa: (a.cdPrograma || '').trim(), acao: (a.cdProjetoAtividade || '').trim(), acaoNome: (a.dsProjetoAtividade || '').trim(), natureza, fonte, emp: 0, liq: 0, pag: 0 }))
    d.emp += cent(a.vlEmpenho); d.liq += cent(a.vlLiquidacao); d.pag += cent(a.vlPagamento)
  }
  return { ex, fdesc }
}

async function main() {
  console.log(`\n═══ Previdência de Paranaguá — orçado(LOA)+empenhado(PIT) por elemento ${APPLY ? '[APPLY]' : '[DRY-RUN]'} ═══`)
  const { loa, vinc } = lerQdd()
  const { ex, fdesc } = execPit(await obterXml())
  const totLoa = [...loa.values()].reduce((a, g) => a + g.valor, 0), totEmp = [...ex.values()].reduce((a, d) => a + d.emp, 0)
  console.log(`LOA(QDD): ${loa.size} dotações · Σ ${reais(totLoa)}  (alvo 173.247.000,00)`)
  console.log(`Execução PIT: ${ex.size} chaves · Σ empenhado ${reais(totEmp)}  (alvo 19.401.291,13)`)

  // de/para de fonte por descrição: PIT cdFontePadrao → vínculo LOA
  const vincList = [...vinc].map(([c, d]) => ({ c, n: norm(d), toks: new Set(norm(d).split(' ').filter(Boolean)) }))
  const depara = new Map<string, string>(); const semPar: string[] = []
  for (const [pit, d] of fdesc) {
    if (!pit) continue
    const nd = norm(d)
    let v = vincList.find((x) => x.n === nd)?.c // exato
    if (!v) { // fuzzy: melhor overlap de tokens (Jaccard ≥ 0,6)
      const dt = new Set(nd.split(' ').filter(Boolean)); let best = 0
      for (const x of vincList) { const inter = [...dt].filter((t) => x.toks.has(t)).length; const uni = new Set([...dt, ...x.toks]).size; const s = uni ? inter / uni : 0; if (s > best) { best = s; if (s >= 0.6) v = x.c } }
    }
    if (v) depara.set(pit, v); else semPar.push(`${pit}(${d.slice(0, 20)})`)
  }
  console.log(`de/para fonte: ${depara.size} casadas · sem par na LOA: ${semPar.length}${semPar.length ? ' ' + semPar.join(', ') : ''}`)
  const fonteLoaDe = (pit: string) => depara.get(pit) ?? pit

  // entidade + dimensões
  const ent = await prisma.entidade.findFirstOrThrow({ where: { tipo: 'ADM_INDIRETA', nome: NOME, municipio: { is: { nome: 'Paranaguá' } } }, select: { id: true, nome: true } })
  const orc = await prisma.orcamento.findUniqueOrThrow({ where: { entidadeId_ano: { entidadeId: ent.id, ano: ANO } }, select: { id: true } })
  const funcoesDb = new Map((await prisma.funcao.findMany()).map((f) => [f.codigo, f.id]))
  const subfuncoesDb = new Map((await prisma.subfuncao.findMany()).map((s) => [s.codigo, s.id]))
  const uosDb = new Map((await prisma.unidadeOrcamentaria.findMany({ where: { entidadeId: ent.id }, select: { codigo: true, id: true } })).map((u) => [u.codigo, u.id]))
  const programasDb = new Map((await prisma.programa.findMany({ where: { entidadeId: ent.id, ano: ANO }, select: { codigo: true, id: true } })).map((p) => [p.codigo, p.id]))
  const acoesDb = new Map((await prisma.acao.findMany({ where: { programa: { entidadeId: ent.id, ano: ANO } }, select: { codigo: true, id: true, programa: { select: { codigo: true } } } })).map((a) => [`${a.programa.codigo}|${a.codigo}`, a.id]))
  const fontesDb = new Map((await prisma.fonteRecursoEntidade.findMany({ where: { entidadeId: ent.id, ano: ANO }, select: { codigo: true, id: true } })).map((f) => [f.codigo.trim(), f.id]))
  const contasDb = new Map((await prisma.contaDespesaEntidade.findMany({ where: { entidadeId: ent.id, ano: ANO }, select: { codigo: true, id: true } })).map((c) => [c.codigo, c.id]))
  const resolverConta = (n: string): string | null => contasDb.get(n) ?? contasDb.get(`${n.split('.').slice(0, 4).join('.')}.00.00`) ?? null

  // chaves finais: LOA (com sua fonte) ∪ execução (fonte re-mapeada). Agrega.
  type Fin = { d: Dot; aut: number; emp: number; liq: number; pag: number }
  const fin = new Map<string, Fin>()
  const kk = (d: { uoCod: string; funcao: string; subfuncao: string; programa: string; acao: string; natureza: string; fonte: string }) => `${d.uoCod}|${d.funcao}|${d.subfuncao}|${d.programa}|${d.acao}|${d.natureza}|${d.fonte}`
  for (const { d, valor } of loa.values()) { const k = kk(d); fin.set(k, { d, aut: valor, emp: 0, liq: 0, pag: 0 }) }
  for (const e of ex.values()) {
    const fonte = fonteLoaDe(e.fonte); const d: Dot = { uoCod: e.uoCod, uoNome: `Unidade ${e.uoCod}`, funcao: e.funcao, subfuncao: e.subfuncao, programa: e.programa, acao: e.acao, acaoNome: e.acaoNome, natureza: e.natureza, fonte, fonteNome: vinc.get(fonte) ?? fdesc.get(e.fonte) ?? `Fonte ${fonte}` }
    const k = kk(d); const g = fin.get(k); if (g) { g.emp += e.emp; g.liq += e.liq; g.pag += e.pag } else fin.set(k, { d, aut: 0, emp: e.emp, liq: e.liq, pag: e.pag })
  }
  console.log(`dotações finais (união): ${fin.size}`)

  // dimensões a criar
  const novas = { fu: new Set<string>(), su: new Map<string, string>(), uo: new Map<string, string>(), pr: new Set<string>(), ac: new Map<string, { nome: string }>(), fo: new Map<string, string>() }; let semConta = 0
  for (const { d } of fin.values()) {
    if (!funcoesDb.has(d.funcao)) novas.fu.add(d.funcao)
    if (!subfuncoesDb.has(d.subfuncao)) novas.su.set(d.subfuncao, d.funcao)
    if (!uosDb.has(d.uoCod)) novas.uo.set(d.uoCod, d.uoNome)
    if (!programasDb.has(d.programa)) novas.pr.add(d.programa)
    if (!acoesDb.has(`${d.programa}|${d.acao}`)) novas.ac.set(`${d.programa}|${d.acao}`, { nome: d.acaoNome })
    if (!fontesDb.has(d.fonte)) novas.fo.set(d.fonte, d.fonteNome)
    if (!resolverConta(d.natureza)) semConta++
  }
  console.log(`criar: funções ${novas.fu.size} · subf ${novas.su.size} · UOs ${novas.uo.size} · prog ${novas.pr.size} · ações ${novas.ac.size} · fontes ${novas.fo.size}${semConta ? ` · SEM conta ${semConta}` : ''}`)
  if (!APPLY) { console.log('\nDRY-RUN: nada gravado.'); return }
  if (semConta) throw new Error('natureza sem conta — abortando')

  const usuario = await prisma.usuario.findFirstOrThrow({ orderBy: { criadoEm: 'asc' }, select: { id: true } })
  const fornecedor = await prisma.fornecedor.findFirstOrThrow({ where: { razaoSocial: 'CAPTURA PIT/TCE-PR' }, select: { id: true } })
  const dataMov = new Date(Date.UTC(ANO, 11, 31)), historico = `CAPTURA PIT execução ${ANO}`

  await prisma.$transaction(async (tx) => {
    for (const c of novas.fu) funcoesDb.set(c, (await tx.funcao.create({ data: { codigo: c, nome: `Função ${c}` }, select: { id: true } })).id)
    for (const [c, fn] of novas.su) subfuncoesDb.set(c, (await tx.subfuncao.create({ data: { codigo: c, nome: `Subfunção ${c}`, funcaoId: funcoesDb.get(fn)! }, select: { id: true } })).id)
    if (novas.uo.size) await tx.unidadeOrcamentaria.createMany({ data: [...novas.uo].map(([codigo, nome]) => ({ entidadeId: ent.id, codigo, nome: nome || `Unidade ${codigo}` })) })
    for (const u of await tx.unidadeOrcamentaria.findMany({ where: { entidadeId: ent.id }, select: { codigo: true, id: true } })) uosDb.set(u.codigo, u.id)
    if (novas.pr.size) await tx.programa.createMany({ data: [...novas.pr].map((codigo) => ({ entidadeId: ent.id, ano: ANO, codigo, nome: `Programa ${codigo}`, tipo: tipoPrograma(codigo) })) })
    for (const p of await tx.programa.findMany({ where: { entidadeId: ent.id, ano: ANO }, select: { codigo: true, id: true } })) programasDb.set(p.codigo, p.id)
    if (novas.ac.size) await tx.acao.createMany({ data: [...novas.ac].map(([ch, a]) => { const [pr, co] = ch.split('|') as [string, string]; return { programaId: programasDb.get(pr)!, codigo: co, nome: a.nome || `Ação ${co}`, tipo: tipoAcao(co) } }) })
    for (const a of await tx.acao.findMany({ where: { programa: { entidadeId: ent.id, ano: ANO } }, select: { codigo: true, id: true, programa: { select: { codigo: true } } } })) acoesDb.set(`${a.programa.codigo}|${a.codigo}`, a.id)
    if (novas.fo.size) await tx.fonteRecursoEntidade.createMany({ data: [...novas.fo].map(([codigo, nome]) => ({ entidadeId: ent.id, ano: ANO, codigo, nomenclatura: nome || `Fonte ${codigo}`, vinculada: codigo !== '01000', origem: 'DESDOBRAMENTO' as const })) })
    for (const f of await tx.fonteRecursoEntidade.findMany({ where: { entidadeId: ent.id, ano: ANO }, select: { codigo: true, id: true } })) fontesDb.set(f.codigo.trim(), f.id)

    // apaga execução paralela antiga
    const antigas = (await tx.dotacaoDespesa.findMany({ where: { orcamentoId: orc.id, empenhos: { some: { numero: { startsWith: 'CAP-' } } } }, select: { id: true } })).map((d) => d.id)
    await tx.movimentoEmpenho.deleteMany({ where: { entidadeId: ent.id } })
    await tx.empenho.deleteMany({ where: { entidadeId: ent.id, numero: { startsWith: 'CAP-' } } })
    await tx.dotacaoDespesa.deleteMany({ where: { id: { in: antigas } } })
    // zera proxy nas dotações LOA remanescentes (se houver)
    await tx.dotacaoDespesa.updateMany({ where: { orcamentoId: orc.id }, data: { valorAutorizado: 0 } })

    const mov: any[] = []; let ambos = 0, so = 0, se = 0
    for (const g of fin.values()) {
      if (g.aut && g.emp) ambos++; else if (g.aut) so++; else se++
      const key = { orcamentoId: orc.id, unidadeOrcamentariaId: uosDb.get(g.d.uoCod)!, funcaoId: funcoesDb.get(g.d.funcao)!, subfuncaoId: subfuncoesDb.get(g.d.subfuncao)!, programaId: programasDb.get(g.d.programa)!, acaoId: acoesDb.get(`${g.d.programa}|${g.d.acao}`)!, contaDespesaEntidadeId: resolverConta(g.d.natureza)!, fonteRecursoEntidadeId: fontesDb.get(g.d.fonte)! }
      const dot = await tx.dotacaoDespesa.upsert({ where: { dotacao_unica: key }, create: { ...key, valorAutorizado: (g.aut / 100).toFixed(2), valorEmpenhado: (g.emp / 100).toFixed(2) }, update: { valorAutorizado: (g.aut / 100).toFixed(2), valorEmpenhado: (g.emp / 100).toFixed(2) }, select: { id: true } })
      if (g.emp) {
        const numero = `CAP-${dot.id.slice(0, 8)}`
        const emp = await tx.empenho.upsert({ where: { entidadeId_numero: { entidadeId: ent.id, numero } }, create: { entidadeId: ent.id, dotacaoDespesaId: dot.id, fornecedorId: fornecedor.id, numero, tipo: 'ESTIMATIVO', data: dataMov, valor: (g.emp / 100).toFixed(2), valorLiquidado: (g.liq / 100).toFixed(2), historico: 'Empenho de CAPTURA da execução do PIT/TCE-PR (não é escrituração).' }, update: { valor: (g.emp / 100).toFixed(2), valorLiquidado: (g.liq / 100).toFixed(2) }, select: { id: true } })
        if (g.emp) mov.push({ entidadeId: ent.id, empenhoId: emp.id, tipo: 'EMPENHO', valor: (g.emp / 100).toFixed(2), data: dataMov, criadoPorId: usuario.id, historico })
        if (g.liq) mov.push({ entidadeId: ent.id, empenhoId: emp.id, tipo: 'LIQUIDACAO', valor: (g.liq / 100).toFixed(2), data: dataMov, criadoPorId: usuario.id, historico })
        if (g.pag) mov.push({ entidadeId: ent.id, empenhoId: emp.id, tipo: 'PAGAMENTO', valor: (g.pag / 100).toFixed(2), data: dataMov, criadoPorId: usuario.id, historico })
      }
    }
    await tx.movimentoEmpenho.createMany({ data: mov })
    console.log(`  [apply] dotações ${fin.size} (orçado+empenhado ${ambos} · só orçado ${so} · só empenho ${se}) · movimentos ${mov.length}`)
  }, { timeout: 180_000 })
}
main().catch((e) => { console.error('FALHOU:', e instanceof Error ? e.stack || e.message : e); process.exitCode = 1 }).finally(async () => { await prisma.$disconnect(); await pool.end() })
