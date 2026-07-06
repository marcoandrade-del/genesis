/**
 * TRUE-UP da FONTE da execução capturada — balancete Elotech × banco.
 *
 * A captura mensal do dashboard (sincronizacao-portal.despesaMes) RATEIA o
 * executado entre as fontes da dotação proporcionalmente ao autorizado (a API
 * ignora o filtro de fonte). O balancete oficial da despesa traz o executado
 * REAL por dotação (programática × natureza × FONTE, mesmos códigos do QDD) —
 * este script corrige a distribuição: grava 1 movimento corretivo por dotação,
 * datado no ÚLTIMO DIA do período do balancete, com o delta por estágio
 * (empenhado/liquidado/pago; delta negativo vira ESTORNO_*).
 *
 * Invariantes (conferidas ANTES de gravar; qualquer quebra ⇒ aborta):
 *   - Σ deltas por estágio = 0 (o balancete e a captura já batem no TOTAL ao
 *     centavo — validado na conciliação PIT #201) ⇒ os totais mensais que
 *     conferem com o dashboard NÃO mudam; só a fonte fica exata no acumulado.
 *   - Toda linha do balancete com valor casa com uma dotação do banco.
 *   - Nenhuma dotação com execução no banco fica fora do balancete.
 *
 * Escrita espelha a captura (mesmas primitivas): empenho CAP-{id8} por dotação
 * (cria se faltar), MovimentoEmpenho idempotente por histórico, e re-
 * materialização de empenho.valor/valorLiquidado + dotacao.valorEmpenhado.
 *
 * Rodar: npx tsx scripts/trueup_fonte_balancete.ts [--apply]
 *        [--arquivo data/balancete_despesa_2026_jan-mai_elotech.xlsx]
 *        [--ano 2026] [--fim 2026-05-31]
 */

import 'dotenv/config'
import { readFileSync } from 'node:fs'
import JSZip from 'jszip'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'

function arg(nome: string, padrao: string): string {
  const i = process.argv.indexOf(nome)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : padrao
}
const APPLY = process.argv.includes('--apply')
const ARQUIVO = arg('--arquivo', 'data/balancete_despesa_2026_jan-mai_elotech.xlsx')
const ANO = parseInt(arg('--ano', '2026'), 10)
const FIM = arg('--fim', '2026-05-31') // último dia do período do balancete
const HISTORICO = `TRUE-UP fonte × balancete até ${FIM}`

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

const reais = (c: number): string =>
  (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

type Estagios = { emp: number; liq: number; pag: number } // centavos

// ── 1. balancete (xlsx = zip de XML; jszip + regex — exceljs é lento demais) ──
async function lerBalancete(caminho: string): Promise<Map<string, Estagios>> {
  const zip = await JSZip.loadAsync(readFileSync(caminho))
  const sharedXml = await zip.file('xl/sharedStrings.xml')!.async('string')
  const shared = [...sharedXml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => m[1].replace(/<[^>]+>/g, ''))
  const sheet = await zip.file('xl/worksheets/sheet1.xml')!.async('string')

  const porChave = new Map<string, Estagios>()
  let programatica: string[] | null = null // [uo, funcao, subfuncao, programa, acao]

  for (const row of sheet.matchAll(/<row [^>]*>([\s\S]*?)<\/row>/g)) {
    const cel: Record<string, string> = {}
    for (const c of row[1].matchAll(/<c r="([A-Z]+)\d+"(?:[^>]*t="(\w+)")?[^>]*>(?:<v>([^<]*)<\/v>)?/g)) {
      if (c[3] !== undefined) cel[c[1]] = c[2] === 's' ? shared[parseInt(c[3], 10)] : c[3]
    }
    // header de programática: "02.010.04.122.0002.2001 - NOME"
    const prog = String(cel.C ?? '').match(/^(\d{2})\.(\d{3})\.(\d{2})\.(\d{3})\.(\d{4})\.(\d{4})\s/)
    if (prog && !cel.A) {
      programatica = [`${prog[1]}.${prog[2]}`, prog[3], prog[4], prog[5], prog[6]]
      continue
    }
    // linha-folha: A=reduzido, B=natureza da dotação, C=natureza de despesa, G=fonte
    if (!cel.A || !cel.B || !cel.C || !programatica) continue
    const nat = String(cel.C).match(/^(\d\.\d\.\d\d\.\d\d\.\d\d\.\d\d)\s/)
    if (!nat) continue
    const fonte = String(cel.G ?? '').trim()
    if (!fonte) continue
    const chave = [...programatica, nat[1], fonte].join('|')
    const v = porChave.get(chave) ?? { emp: 0, liq: 0, pag: 0 }
    v.emp += Math.round(parseFloat(cel.L ?? '0') * 100)
    v.liq += Math.round(parseFloat(cel.N ?? '0') * 100)
    v.pag += Math.round(parseFloat(cel.O ?? '0') * 100)
    porChave.set(chave, v)
  }
  return porChave
}

// ── 2. banco: dotações (chave→id) e execução acumulada até FIM por dotação ───
async function lerBanco() {
  const entidade = await prisma.entidade.findFirst({
    where: {
      tipo: 'PREFEITURA',
      municipio: { is: { nome: { contains: 'Maring', mode: 'insensitive' }, estado: { is: { sigla: 'PR' } } } },
    },
    select: { id: true, nome: true },
  })
  if (!entidade) throw new Error('entidade PREFEITURA de Maringá/PR não encontrada')
  const orcamento = await prisma.orcamento.findUnique({
    where: { entidadeId_ano: { entidadeId: entidade.id, ano: ANO } },
    select: { id: true },
  })
  if (!orcamento) throw new Error(`sem orçamento ${ANO}`)

  const dots = await prisma.dotacaoDespesa.findMany({
    where: { orcamentoId: orcamento.id },
    select: {
      id: true,
      unidadeOrcamentaria: { select: { codigo: true } },
      funcao: { select: { codigo: true } },
      subfuncao: { select: { codigo: true } },
      programa: { select: { codigo: true } },
      acao: { select: { codigo: true } },
      contaDespesa: { select: { codigo: true } },
      fonteRecurso: { select: { codigo: true } },
    },
  })
  const chaveDe = new Map<string, string>() // chave → dotacaoId
  for (const d of dots) {
    const chave = [
      d.unidadeOrcamentaria.codigo,
      d.funcao.codigo,
      d.subfuncao.codigo,
      d.programa.codigo,
      d.acao.codigo,
      d.contaDespesa.codigo,
      d.fonteRecurso.codigo.trim(),
    ].join('|')
    if (chaveDe.has(chave)) throw new Error(`chave duplicada no banco: ${chave}`)
    chaveDe.set(chave, d.id)
  }

  // execução líquida acumulada até FIM, por dotação
  const movs = await prisma.movimentoEmpenho.findMany({
    where: { entidadeId: entidade.id, data: { gte: new Date(`${ANO}-01-01`), lte: new Date(FIM) } },
    select: { tipo: true, valor: true, empenho: { select: { dotacaoDespesaId: true } } },
  })
  const CAMPO: Record<string, { k: keyof Estagios; s: number }> = {
    EMPENHO: { k: 'emp', s: 1 },
    ESTORNO_EMPENHO: { k: 'emp', s: -1 },
    LIQUIDACAO: { k: 'liq', s: 1 },
    ESTORNO_LIQUIDACAO: { k: 'liq', s: -1 },
    PAGAMENTO: { k: 'pag', s: 1 },
    ESTORNO_PAGAMENTO: { k: 'pag', s: -1 },
  }
  const execPorDot = new Map<string, Estagios>()
  for (const mv of movs) {
    const dot = mv.empenho.dotacaoDespesaId
    const v = execPorDot.get(dot) ?? { emp: 0, liq: 0, pag: 0 }
    const { k, s } = CAMPO[mv.tipo]
    v[k] += s * Math.round(Number(mv.valor) * 100)
    execPorDot.set(dot, v)
  }
  return { entidade, chaveDe, execPorDot }
}

// ── 3. main ───────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n═══ True-up de fonte × balancete (${APPLY ? 'APPLY' : 'dry-run'}) — até ${FIM} ═══\n`)
  const balancete = await lerBalancete(ARQUIVO)
  const { entidade, chaveDe, execPorDot } = await lerBanco()
  console.log(`Balancete: ${balancete.size} linhas dotação×fonte · Banco: ${chaveDe.size} dotações, ${execPorDot.size} com execução`)

  // casamento + deltas
  const deltas = new Map<string, Estagios>() // dotacaoId → delta (balancete − banco)
  const semPar: string[] = []
  const vistos = new Set<string>()
  for (const [chave, alvo] of balancete) {
    const dotId = chaveDe.get(chave)
    if (!dotId) {
      if (alvo.emp || alvo.liq || alvo.pag) semPar.push(`${chave}  emp ${reais(alvo.emp)}`)
      continue
    }
    vistos.add(dotId)
    const atual = execPorDot.get(dotId) ?? { emp: 0, liq: 0, pag: 0 }
    const d = { emp: alvo.emp - atual.emp, liq: alvo.liq - atual.liq, pag: alvo.pag - atual.pag }
    if (d.emp || d.liq || d.pag) deltas.set(dotId, d)
  }
  const foraDoBalancete: string[] = []
  for (const [dotId, v] of execPorDot) {
    if (vistos.has(dotId)) continue
    if (v.emp || v.liq || v.pag) foraDoBalancete.push(dotId)
  }

  // invariantes
  if (semPar.length) {
    console.error(`ABORTADO: ${semPar.length} linha(s) do balancete sem dotação no banco:`)
    for (const l of semPar.slice(0, 10)) console.error('  ' + l)
    process.exit(1)
  }
  if (foraDoBalancete.length) {
    console.error(`ABORTADO: ${foraDoBalancete.length} dotação(ões) com execução no banco fora do balancete: ${foraDoBalancete.slice(0, 5).join(', ')}`)
    process.exit(1)
  }
  const soma = { emp: 0, liq: 0, pag: 0 }
  let somaAbs = 0
  for (const d of deltas.values()) {
    soma.emp += d.emp
    soma.liq += d.liq
    soma.pag += d.pag
    somaAbs += Math.abs(d.emp)
  }
  console.log(`\nDotações a corrigir: ${deltas.size} · Σ|Δ empenhado| = ${reais(somaAbs)} (massa redistribuída entre fontes)`)
  console.log(`Invariante Σ deltas ≈ 0: emp ${reais(soma.emp)} · liq ${reais(soma.liq)} · pago ${reais(soma.pag)}`)
  const TOL = 100 // R$ 1,00 — arredondamentos do rateio
  if (Math.abs(soma.emp) > TOL || Math.abs(soma.liq) > TOL || Math.abs(soma.pag) > TOL) {
    console.error('ABORTADO: Σ deltas fora da tolerância — balancete e captura não fecham no total; investigar antes.')
    process.exit(1)
  }

  // resumo por fonte (o que o true-up corrige)
  const porFonte = new Map<string, number>()
  const fonteDe = new Map([...chaveDe].map(([chave, id]) => [id, chave.split('|')[6]]))
  for (const [dotId, d] of deltas) {
    const f = fonteDe.get(dotId)!
    porFonte.set(f, (porFonte.get(f) ?? 0) + d.emp)
  }
  console.log('\nΔ empenhado por FONTE (top 15 |Δ| — o erro do rateio sendo corrigido):')
  for (const [f, v] of [...porFonte].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 15))
    console.log(`  fonte ${f.padEnd(8)} ${reais(v).padStart(16)}`)

  if (!APPLY) {
    console.log('\nDry-run — nada gravado. Rode com --apply para gravar.\n')
    await prisma.$disconnect()
    return
  }

  // ── escrita (espelha a captura: CAP-empenho, movimentos idempotentes, rematerialização)
  let fornecedor = await prisma.fornecedor.findFirst({ where: { razaoSocial: 'CAPTURA PORTAL DA TRANSPARÊNCIA' }, select: { id: true } })
  if (!fornecedor)
    fornecedor = await prisma.fornecedor.create({
      data: { tipoPessoa: 'PJ', razaoSocial: 'CAPTURA PORTAL DA TRANSPARÊNCIA', nomeFantasia: 'Execução capturada do portal (não é credor real)' },
      select: { id: true },
    })
  const usuario = await prisma.usuario.findFirst({ orderBy: { criadoEm: 'asc' }, select: { id: true } })
  if (!usuario) throw new Error('sem usuário para criadoPorId')
  const dataMov = new Date(`${FIM}T00:00:00Z`)

  await prisma.$transaction(
    async (tx) => {
      const ids = [...deltas.keys()]
      const existentes = await tx.empenho.findMany({
        where: { entidadeId: entidade.id, dotacaoDespesaId: { in: ids }, numero: { startsWith: 'CAP-' } },
        select: { id: true, dotacaoDespesaId: true },
      })
      const empPorDot = new Map(existentes.map((e) => [e.dotacaoDespesaId, e.id]))
      for (const id of ids) {
        if (empPorDot.has(id)) continue
        const novo = await tx.empenho.create({
          data: {
            entidadeId: entidade.id,
            dotacaoDespesaId: id,
            fornecedorId: fornecedor!.id,
            numero: `CAP-${id.slice(0, 8)}`,
            tipo: 'ESTIMATIVO',
            data: dataMov,
            valor: 0,
            historico: 'Empenho de CAPTURA da execução do portal (não é escrituração).',
          },
          select: { id: true },
        })
        empPorDot.set(id, novo.id)
      }
      await tx.movimentoEmpenho.deleteMany({ where: { entidadeId: entidade.id, historico: HISTORICO } })
      const rows: {
        entidadeId: string
        empenhoId: string
        tipo: 'EMPENHO' | 'ESTORNO_EMPENHO' | 'LIQUIDACAO' | 'ESTORNO_LIQUIDACAO' | 'PAGAMENTO' | 'ESTORNO_PAGAMENTO'
        valor: number
        data: Date
        criadoPorId: string
        historico: string
      }[] = []
      for (const [dotId, d] of deltas) {
        const eId = empPorDot.get(dotId)!
        const push = (
          c: number,
          pos: 'EMPENHO' | 'LIQUIDACAO' | 'PAGAMENTO',
          neg: 'ESTORNO_EMPENHO' | 'ESTORNO_LIQUIDACAO' | 'ESTORNO_PAGAMENTO',
        ) => {
          if (!c) return
          rows.push({
            entidadeId: entidade.id,
            empenhoId: eId,
            tipo: c > 0 ? pos : neg,
            valor: Math.abs(c) / 100,
            data: dataMov,
            criadoPorId: usuario.id,
            historico: HISTORICO,
          })
        }
        push(d.emp, 'EMPENHO', 'ESTORNO_EMPENHO')
        push(d.liq, 'LIQUIDACAO', 'ESTORNO_LIQUIDACAO')
        push(d.pag, 'PAGAMENTO', 'ESTORNO_PAGAMENTO')
      }
      await tx.movimentoEmpenho.createMany({ data: rows })
      // rematerializa empenho.valor/valorLiquidado e dotacao.valorEmpenhado
      for (const [dotId, empId] of empPorDot) {
        const ag = await tx.movimentoEmpenho.groupBy({ by: ['tipo'], where: { empenhoId: empId }, _sum: { valor: true } })
        const s = (t: string) => Number(ag.find((g) => g.tipo === t)?._sum.valor ?? 0)
        const emp = Math.round((s('EMPENHO') - s('ESTORNO_EMPENHO')) * 100) / 100
        const liq = Math.round((s('LIQUIDACAO') - s('ESTORNO_LIQUIDACAO')) * 100) / 100
        await tx.empenho.update({ where: { id: empId }, data: { valor: emp, valorLiquidado: liq } })
        await tx.dotacaoDespesa.update({ where: { id: dotId }, data: { valorEmpenhado: emp } })
      }
      console.log(`\nGravado: ${rows.length} movimentos corretivos em ${deltas.size} dotações (histórico "${HISTORICO}").`)
    },
    { timeout: 300000 },
  )

  // ── verificação pós-apply: banco por fonte = balancete por fonte, ao centavo
  const { execPorDot: execDepois } = await lerBanco()
  const bancoPorFonte = new Map<string, number>()
  for (const [dotId, v] of execDepois) bancoPorFonte.set(fonteDe.get(dotId) ?? '?', (bancoPorFonte.get(fonteDe.get(dotId) ?? '?') ?? 0) + v.emp)
  const balPorFonte = new Map<string, number>()
  for (const [chave, v] of balancete) balPorFonte.set(chave.split('|')[6], (balPorFonte.get(chave.split('|')[6]) ?? 0) + v.emp)
  let pior = 0
  for (const [f, v] of balPorFonte) pior = Math.max(pior, Math.abs((bancoPorFonte.get(f) ?? 0) - v))
  console.log(`Verificação por fonte pós-apply: maior |Δ| = ${reais(pior)} ${pior === 0 ? '✓ AO CENTAVO' : '(investigar!)'}`)
  console.log()
  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error('FALHOU:', e instanceof Error ? e.message : e)
  await prisma.$disconnect()
  process.exit(1)
})
