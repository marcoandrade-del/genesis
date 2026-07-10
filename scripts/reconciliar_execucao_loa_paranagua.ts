/**
 * RECONCILIA a execução (PIT) com a dotação inicial (LOA) da PREFEITURA de
 * Paranaguá: re-chaveia os empenhos para as MESMAS dotações da LOA, para cada
 * dotação ter orçado (LOA) + empenhado (PIT) na mesma linha.
 *
 * Duas diferenças de codificação entre TCE-PR (PIT) e IPM (LOA) resolvidas aqui:
 *  1. NATUREZA: PIT vem no desdobramento; agregamos ao ELEMENTO (nível da LOA).
 *  2. FONTE: de/para PIT→vínculo-LOA por descrição (24 fontes; 4 sem par na LOA
 *     ficam como execução-sem-dotação com o próprio código do PIT).
 *
 * One-time (migração): apaga as dotações paralelas da execução (as que têm
 * empenho CAP-*) e reconstrói os empenhos sobre as dotações da LOA. Guarda:
 * aborta se já houver dotação com orçado E empenhado (já reconciliado).
 *
 * Rodar: npx tsx scripts/reconciliar_execucao_loa_paranagua.ts [--apply]
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
const APPLY = process.argv.includes('--apply')

// de/para fonte PIT (cdFontePadrao) → vínculo LOA (por descrição). Sem par na LOA: 001,1005,1006,1011.
const DEPARA_FONTE: Record<string, string> = {
  '000': '01000', '104': '01104', '303': '01303', '101': '01101', '510': '01510', '103': '01103',
  '1045': '01045', '507': '01507', '511': '01511', '509': '01509', '494': '01520', '501': '01502',
  '1051': '01531', '496': '01493', '504': '01504', '1018': '01528', '880': '01880', '940': '01940',
  '941': '01941', '512': '01512', '934': '01934', '1017': '01527', '107': '01107', '900': '01900',
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })
const cent = (s: string | undefined): number => Math.round(parseFloat((s || '0').trim() || '0') * 100)
const reais = (c: number): string => (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

async function obterXml(): Promise<string> {
  const cache = join(tmpdir(), `pit_${ANO}_${IBGE6}_Despesa.zip`)
  let buf: Buffer
  if (existsSync(cache)) buf = readFileSync(cache)
  else {
    const res = await fetch(`https://pit.tce.pr.gov.br/Arquivos/${ANO}/${ANO}_${IBGE6}_Despesa.zip`)
    if (!res.ok) throw new Error(`download PIT falhou: ${res.status}`)
    buf = Buffer.from(await res.arrayBuffer()); writeFileSync(cache, buf)
  }
  const zip = await JSZip.loadAsync(buf)
  const nome = Object.keys(zip.files).find((n) => /_Empenho\.xml$/.test(n))!
  const s = await zip.files[nome]!.async('string')
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s
}

type Ag = { emp: number; liq: number; pag: number; uoCod: string; funcao: string; subfuncao: string; programa: string; acao: string; natureza: string; fonteLoa: string; semLoa: boolean }

function agregar(xml: string): Map<string, Ag> {
  const dots = new Map<string, Ag>()
  for (const m of xml.matchAll(/<Empenho ([^>]*?)\/>/g)) {
    const a: Record<string, string> = {}
    for (const at of m[1]!.matchAll(/([A-Za-z]+)="([^"]*)"/g)) a[at[1]!] = at[2]!
    if (!(a.nmEntidade || '').includes('MUNICÍPIO')) continue // só a Prefeitura (evita CÂMARA MUNICIPAL / INTERMUNICIPAL)
    const uoCod = `${(a.cdOrgao || '').trim()}.${(a.cdUnidade || '').trim()}`
    const funcao = (a.cdFuncao || '').trim()
    const subfuncao = (a.cdSubFuncao || '').trim()
    const programa = (a.cdPrograma || '').trim()
    const acao = (a.cdProjetoAtividade || '').trim()
    // natureza NO ELEMENTO (desdobramento zerado) = nível da LOA
    const natureza = `${(a.cdCategoriaEconomica || '').trim()}.${(a.cdGrupoNatureza || '').trim()}.${(a.cdModalidade || '').trim()}.${(a.cdElemento || '').trim()}.00.00`
    const pitFonte = (a.cdFontePadrao || '').trim()
    const fonteLoa = DEPARA_FONTE[pitFonte] ?? pitFonte // sem par → mantém código PIT
    const chave = `${uoCod}|${funcao}|${subfuncao}|${programa}|${acao}|${natureza}|${fonteLoa}`
    let d = dots.get(chave)
    if (!d) dots.set(chave, (d = { emp: 0, liq: 0, pag: 0, uoCod, funcao, subfuncao, programa, acao, natureza, fonteLoa, semLoa: !DEPARA_FONTE[pitFonte] && pitFonte !== '000' }))
    d.emp += cent(a.vlEmpenho); d.liq += cent(a.vlLiquidacao); d.pag += cent(a.vlPagamento)
  }
  return dots
}

async function main() {
  console.log(`\n═══ Reconciliação execução×LOA — Prefeitura de Paranaguá ${APPLY ? '[APPLY]' : '[DRY-RUN]'} ═══`)
  const ent = await prisma.entidade.findFirstOrThrow({ where: { tipo: 'PREFEITURA', municipio: { is: { nome: 'Paranaguá', estado: { is: { sigla: 'PR' } } } } }, select: { id: true, nome: true } })
  const orc = await prisma.orcamento.findUniqueOrThrow({ where: { entidadeId_ano: { entidadeId: ent.id, ano: ANO } }, select: { id: true } })

  const jaReconc = await prisma.dotacaoDespesa.count({ where: { orcamentoId: orc.id, valorAutorizado: { gt: 0 }, valorEmpenhado: { gt: 0 } } })
  if (jaReconc > 0) { console.log(`⚠ Já há ${jaReconc} dotações com orçado E empenhado — parece reconciliado. Abortando (rode só uma vez).`); return }

  const dots = agregar(await obterXml())
  const totEmp = [...dots.values()].reduce((a, d) => a + d.emp, 0)
  const semLoaVal = [...dots.values()].filter((d) => d.semLoa).reduce((a, d) => a + d.emp, 0)
  console.log(`agregado ao elemento+fonte-LOA: ${dots.size} chaves · Σ empenhado ${reais(totEmp)} · sem par LOA ${reais(semLoaVal)}`)

  // lookups (todas as dimensões já existem dos imports anteriores)
  const uosDb = new Map((await prisma.unidadeOrcamentaria.findMany({ where: { entidadeId: ent.id }, select: { codigo: true, id: true } })).map((u) => [u.codigo, u.id]))
  const funcoesDb = new Map((await prisma.funcao.findMany()).map((f) => [f.codigo, f.id]))
  const subfuncoesDb = new Map((await prisma.subfuncao.findMany()).map((s) => [s.codigo, s.id]))
  const programasDb = new Map((await prisma.programa.findMany({ where: { entidadeId: ent.id, ano: ANO }, select: { codigo: true, id: true } })).map((p) => [p.codigo, p.id]))
  const acoesDb = new Map((await prisma.acao.findMany({ where: { programa: { entidadeId: ent.id, ano: ANO } }, select: { codigo: true, id: true, programa: { select: { codigo: true } } } })).map((a) => [`${a.programa.codigo}|${a.codigo}`, a.id]))
  const fontesDb = new Map((await prisma.fonteRecursoEntidade.findMany({ where: { entidadeId: ent.id, ano: ANO }, select: { codigo: true, id: true } })).map((f) => [f.codigo.trim(), f.id]))
  const contasDb = new Map((await prisma.contaDespesaEntidade.findMany({ where: { entidadeId: ent.id, ano: ANO }, select: { codigo: true, id: true } })).map((c) => [c.codigo, c.id]))
  const resolverConta = (nat: string): string | null => contasDb.get(nat) ?? contasDb.get(`${nat.split('.').slice(0, 4).join('.')}.00.00`) ?? null

  // valida que tudo resolve
  const faltas: string[] = []
  for (const d of dots.values()) {
    if (!uosDb.has(d.uoCod)) faltas.push(`UO ${d.uoCod}`)
    if (!funcoesDb.has(d.funcao)) faltas.push(`função ${d.funcao}`)
    if (!acoesDb.has(`${d.programa}|${d.acao}`)) faltas.push(`ação ${d.programa}|${d.acao}`)
    if (!fontesDb.has(d.fonteLoa)) faltas.push(`fonte ${d.fonteLoa}`)
    if (!resolverConta(d.natureza)) faltas.push(`conta ${d.natureza}`)
  }
  if (faltas.length) { console.log(`⚠ dimensões faltando (${faltas.length}):`, [...new Set(faltas)].slice(0, 20)); if (!APPLY) return }

  if (!APPLY) { console.log('\nDRY-RUN: nada gravado. Rode com --apply.'); return }

  const usuario = await prisma.usuario.findFirstOrThrow({ orderBy: { criadoEm: 'asc' }, select: { id: true } })
  const fornecedor = await prisma.fornecedor.findFirstOrThrow({ where: { razaoSocial: 'CAPTURA PIT/TCE-PR' }, select: { id: true } })
  const dataMov = new Date(Date.UTC(ANO, 11, 31))
  const historico = `CAPTURA PIT execução ${ANO}`

  await prisma.$transaction(async (tx) => {
    // 1) apaga a execução paralela antiga (dotações com empenho CAP-*)
    const antigas = await tx.dotacaoDespesa.findMany({ where: { orcamentoId: orc.id, empenhos: { some: { numero: { startsWith: 'CAP-' } } } }, select: { id: true } })
    const ids = antigas.map((d) => d.id)
    await tx.movimentoEmpenho.deleteMany({ where: { entidadeId: ent.id } })
    await tx.empenho.deleteMany({ where: { entidadeId: ent.id, numero: { startsWith: 'CAP-' } } })
    await tx.dotacaoDespesa.deleteMany({ where: { id: { in: ids } } })
    console.log(`  [apply] execução paralela removida: ${ids.length} dotações`)

    // 2) re-grava empenhado sobre as dotações da LOA (ou cria execução-sem-LOA)
    const movRows: { entidadeId: string; empenhoId: string; tipo: 'EMPENHO' | 'LIQUIDACAO' | 'PAGAMENTO'; valor: string; data: Date; criadoPorId: string; historico: string }[] = []
    let casadas = 0, novas = 0
    for (const d of dots.values()) {
      const dotKey = {
        orcamentoId: orc.id,
        unidadeOrcamentariaId: uosDb.get(d.uoCod)!,
        funcaoId: funcoesDb.get(d.funcao)!,
        subfuncaoId: subfuncoesDb.get(d.subfuncao)!,
        programaId: programasDb.get(d.programa)!,
        acaoId: acoesDb.get(`${d.programa}|${d.acao}`)!,
        contaDespesaEntidadeId: resolverConta(d.natureza)!,
        fonteRecursoEntidadeId: fontesDb.get(d.fonteLoa)!,
      }
      const empReais = (d.emp / 100).toFixed(2)
      const existente = await tx.dotacaoDespesa.findUnique({ where: { dotacao_unica: dotKey }, select: { id: true } })
      let dotacaoId: string
      if (existente) { dotacaoId = existente.id; await tx.dotacaoDespesa.update({ where: { id: dotacaoId }, data: { valorEmpenhado: empReais } }); casadas++ }
      else { dotacaoId = (await tx.dotacaoDespesa.create({ data: { ...dotKey, valorAutorizado: 0, valorEmpenhado: empReais }, select: { id: true } })).id; novas++ }

      const numero = `CAP-${dotacaoId.slice(0, 8)}`
      const emp = await tx.empenho.upsert({
        where: { entidadeId_numero: { entidadeId: ent.id, numero } },
        create: { entidadeId: ent.id, dotacaoDespesaId: dotacaoId, fornecedorId: fornecedor.id, numero, tipo: 'ESTIMATIVO', data: dataMov, valor: empReais, valorLiquidado: (d.liq / 100).toFixed(2), historico: 'Empenho de CAPTURA da execução do PIT/TCE-PR (não é escrituração).' },
        update: { valor: empReais, valorLiquidado: (d.liq / 100).toFixed(2) },
        select: { id: true },
      })
      if (d.emp) movRows.push({ entidadeId: ent.id, empenhoId: emp.id, tipo: 'EMPENHO', valor: empReais, data: dataMov, criadoPorId: usuario.id, historico })
      if (d.liq) movRows.push({ entidadeId: ent.id, empenhoId: emp.id, tipo: 'LIQUIDACAO', valor: (d.liq / 100).toFixed(2), data: dataMov, criadoPorId: usuario.id, historico })
      if (d.pag) movRows.push({ entidadeId: ent.id, empenhoId: emp.id, tipo: 'PAGAMENTO', valor: (d.pag / 100).toFixed(2), data: dataMov, criadoPorId: usuario.id, historico })
    }
    await tx.movimentoEmpenho.createMany({ data: movRows })
    console.log(`  [apply] dotações da LOA com empenho: ${casadas} · execução-sem-LOA (novas): ${novas} · movimentos: ${movRows.length}`)
  }, { timeout: 300_000 })
}

main().catch((e) => { console.error('FALHOU:', e instanceof Error ? e.stack || e.message : e); process.exitCode = 1 }).finally(async () => { await prisma.$disconnect(); await pool.end() })
