/**
 * Importa a DOTAÇÃO INICIAL da despesa (LOA 2026) da PREFEITURA de Paranaguá a
 * partir do CSV do portal IPM (Dados Abertos → "Orçamento da Despesa" / QDD).
 *
 * Grava valorAutorizado nas dotações (chave: UO × função × subfunção × programa
 * × ação × natureza@elemento × fonte@vínculo), criando dimensões sob demanda.
 * ZERA antes o valorAutorizado das dotações existentes (o proxy vindo do PIT).
 *
 * ⚠️ A fonte da LOA (vínculo "01000"…) e a da execução (PIT "000"…) usam
 * codificações diferentes → as dotações da LOA ficam PARALELAS às da execução
 * (orçado × empenhado agregam por órgão/função/natureza; o join 1:1 por fonte é
 * um de/para futuro). Natureza no ELEMENTO (LOA não detalha desdobramento).
 *
 * Layout do CSV: Elemento (natureza) = dropar 1º díg "3" → C.G.MM.EE;
 * Funcional = função.subfunção.programa; Vínculo = fonte; Total = fixado.
 *
 * DRY-RUN por padrão; --apply grava. Rodar (da raiz):
 *   npx tsx scripts/importar_despesa_loa_paranagua_ipm.ts [--csv <arq>] [--apply]
 */
import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'

const ANO = 2026
const CSV = (() => {
  const i = process.argv.indexOf('--csv')
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : '/home/marco/Downloads/Relatorio (1).csv'
})()
const APPLY = process.argv.includes('--apply')

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

const cent = (s: string): number => Math.round(parseFloat((s || '0').trim() || '0') * 100)
const reais = (c: number): string => (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// natureza no elemento: dropa o 1º díg "3" → cat.grp.mod.ele.00.00
function naturezaDe(elem19: string): string {
  const d = elem19.slice(1)
  return `${d[0]}.${d[1]}.${d.slice(2, 4)}.${d.slice(4, 6)}.00.00`
}
// funcional "0004.0122.0057" → função(2)/subfunção(3)/programa(4)
function funcionalDe(f: string): { funcao: string; subfuncao: string; programa: string } {
  const [a, b, c] = f.split('.')
  return {
    funcao: String(parseInt(a || '0', 10)).padStart(2, '0'),
    subfuncao: String(parseInt(b || '0', 10)).padStart(3, '0'),
    programa: (c || '').padStart(4, '0'),
  }
}
function tipoPrograma(codigo: string): 'FINALISTICO' | 'GESTAO' | 'OPERACOES_ESPECIAIS' {
  return codigo === '0000' || codigo === '9999' ? 'OPERACOES_ESPECIAIS' : 'FINALISTICO'
}
function tipoAcao(codigo: string): 'PROJETO' | 'ATIVIDADE' | 'OPERACAO_ESPECIAL' {
  if (codigo.startsWith('1')) return 'PROJETO'
  if (codigo.startsWith('2')) return 'ATIVIDADE'
  return 'OPERACAO_ESPECIAL'
}

type Dot = {
  uoCod: string; uoNome: string
  funcao: string; subfuncao: string
  programa: string; programaNome: string
  acao: string; acaoNome: string; acaoTipo: string
  natureza: string
  fonte: string; fonteNome: string
  valor: number
}

// parser CSV real (aspas, ';' e quebras de linha DENTRO de aspas, "" escapado)
function registros(txt: string): string[][] {
  const rows: string[][] = []
  let field = '', row: string[] = [], inQ = false
  for (let i = 0; i < txt.length; i++) {
    const c = txt[i]!
    if (inQ) {
      if (c === '"') { if (txt[i + 1] === '"') { field += '"'; i++ } else inQ = false }
      else field += c
    } else if (c === '"') inQ = true
    else if (c === ';') { row.push(field); field = '' }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = '' }
    else if (c !== '\r') field += c
  }
  if (field.length || row.length) { row.push(field); rows.push(row) }
  return rows
}

function parse(txt: string): Map<string, Dot> {
  const rows = registros(txt).filter((r) => r.length >= 16)
  const dots = new Map<string, Dot>()
  for (const f of rows.slice(1)) {
    if (f.length < 16) continue
    const orgao = (f[1] || '').trim()
    const unidade = (f[3] || '').trim()
    const uoCod = `${orgao}.${unidade}`
    const { funcao, subfuncao, programa } = funcionalDe((f[12] || '').trim())
    const acao = (f[5] || '').trim()
    const natureza = naturezaDe((f[8] || '').trim())
    const fonte = (f[10] || '').trim()
    const valor = cent(f[15] || '0')
    const chave = `${uoCod}|${funcao}|${subfuncao}|${programa}|${acao}|${natureza}|${fonte}`
    let d = dots.get(chave)
    if (!d) {
      d = {
        uoCod, uoNome: (f[4] || '').trim(),
        funcao, subfuncao,
        programa, programaNome: `Programa ${programa}`,
        acao, acaoNome: (f[6] || '').trim(), acaoTipo: (f[7] || '').trim(),
        natureza,
        fonte, fonteNome: (f[11] || '').trim(),
        valor: 0,
      }
      dots.set(chave, d)
    }
    d.valor += valor
  }
  return dots
}

async function main() {
  console.log(`\n═══ Dotação inicial (despesa LOA) ${ANO} — CSV IPM → Gênesis (Paranaguá) ${APPLY ? '[APPLY]' : '[DRY-RUN]'} ═══`)
  const entidade = await prisma.entidade.findFirstOrThrow({
    where: { tipo: 'PREFEITURA', municipio: { is: { nome: 'Paranaguá', estado: { is: { sigla: 'PR' } } } } },
    select: { id: true, nome: true },
  })
  const orcamento = await prisma.orcamento.findUniqueOrThrow({ where: { entidadeId_ano: { entidadeId: entidade.id, ano: ANO } }, select: { id: true } })

  const dots = parse(readFileSync(CSV, 'latin1'))
  const total = [...dots.values()].reduce((a, d) => a + d.valor, 0)
  console.log(`${entidade.nome}: ${dots.size} dotações distintas · Σ fixado R$ ${reais(total)}\n`)

  // catálogos
  const funcoesDb = new Map((await prisma.funcao.findMany()).map((f) => [f.codigo, f.id]))
  const subfuncoesDb = new Map((await prisma.subfuncao.findMany()).map((s) => [s.codigo, s.id]))
  const uosDb = new Map((await prisma.unidadeOrcamentaria.findMany({ where: { entidadeId: entidade.id }, select: { codigo: true, id: true } })).map((u) => [u.codigo, u.id]))
  const programasDb = new Map((await prisma.programa.findMany({ where: { entidadeId: entidade.id, ano: ANO }, select: { codigo: true, id: true } })).map((p) => [p.codigo, p.id]))
  const acoesDb = new Map(
    (await prisma.acao.findMany({ where: { programa: { entidadeId: entidade.id, ano: ANO } }, select: { codigo: true, id: true, programa: { select: { codigo: true } } } })).map((a) => [`${a.programa.codigo}|${a.codigo}`, a.id]),
  )
  const fontesDb = new Map((await prisma.fonteRecursoEntidade.findMany({ where: { entidadeId: entidade.id, ano: ANO }, select: { codigo: true, id: true } })).map((f) => [f.codigo.trim(), f.id]))
  const contasDb = new Map(
    (await prisma.contaDespesaEntidade.findMany({ where: { entidadeId: entidade.id, ano: ANO }, select: { codigo: true, id: true, admiteMovimento: true } })).map((c) => [c.codigo, c]),
  )
  const resolverConta = (nat: string): string | null => {
    const folha = contasDb.get(nat)
    if (folha) return folha.id
    const p = nat.split('.')
    const el = contasDb.get(`${p[0]}.${p[1]}.${p[2]}.${p[3]}.00.00`)
    return el ? el.id : null
  }

  // o que criar
  const novas = { funcoes: new Set<string>(), subf: new Map<string, string>(), uos: new Map<string, string>(), prog: new Set<string>(), acoes: new Map<string, { nome: string; tipo: string }>(), fontes: new Map<string, string>() }
  let semConta = 0
  for (const d of dots.values()) {
    if (!funcoesDb.has(d.funcao)) novas.funcoes.add(d.funcao)
    if (!subfuncoesDb.has(d.subfuncao)) novas.subf.set(d.subfuncao, d.funcao)
    if (!uosDb.has(d.uoCod)) novas.uos.set(d.uoCod, d.uoNome)
    if (!programasDb.has(d.programa)) novas.prog.add(d.programa)
    if (!acoesDb.has(`${d.programa}|${d.acao}`)) novas.acoes.set(`${d.programa}|${d.acao}`, { nome: d.acaoNome, tipo: d.acaoTipo })
    if (!fontesDb.has(d.fonte)) novas.fontes.set(d.fonte, d.fonteNome)
    if (!resolverConta(d.natureza)) semConta++
  }
  console.log(`criar sob demanda → funções ${novas.funcoes.size} · subfunções ${novas.subf.size} · UOs ${novas.uos.size} · programas ${novas.prog.size} · ações ${novas.acoes.size} · fontes ${novas.fontes.size}`)
  if (semConta) console.log(`  ⚠ dotações sem conta de despesa no plano: ${semConta}`)

  if (!APPLY) { console.log('\nDRY-RUN: nada gravado. Rode com --apply.'); return }

  await prisma.$transaction(
    async (tx) => {
      for (const c of novas.funcoes) funcoesDb.set(c, (await tx.funcao.create({ data: { codigo: c, nome: `Função ${c}` }, select: { id: true } })).id)
      for (const [c, fn] of novas.subf) subfuncoesDb.set(c, (await tx.subfuncao.create({ data: { codigo: c, nome: `Subfunção ${c}`, funcaoId: funcoesDb.get(fn)! }, select: { id: true } })).id)
      if (novas.uos.size) await tx.unidadeOrcamentaria.createMany({ data: [...novas.uos].map(([codigo, nome]) => ({ entidadeId: entidade.id, codigo, nome: nome || `Unidade ${codigo}` })) })
      for (const u of await tx.unidadeOrcamentaria.findMany({ where: { entidadeId: entidade.id }, select: { codigo: true, id: true } })) uosDb.set(u.codigo, u.id)
      if (novas.prog.size) await tx.programa.createMany({ data: [...novas.prog].map((codigo) => ({ entidadeId: entidade.id, ano: ANO, codigo, nome: `Programa ${codigo}`, tipo: tipoPrograma(codigo) })) })
      for (const p of await tx.programa.findMany({ where: { entidadeId: entidade.id, ano: ANO }, select: { codigo: true, id: true } })) programasDb.set(p.codigo, p.id)
      if (novas.acoes.size)
        await tx.acao.createMany({ data: [...novas.acoes].map(([chave, a]) => { const [prog, cod] = chave.split('|') as [string, string]; return { programaId: programasDb.get(prog)!, codigo: cod, nome: a.nome || `Ação ${cod}`, tipo: tipoAcao(cod) } }) })
      for (const a of await tx.acao.findMany({ where: { programa: { entidadeId: entidade.id, ano: ANO } }, select: { codigo: true, id: true, programa: { select: { codigo: true } } } })) acoesDb.set(`${a.programa.codigo}|${a.codigo}`, a.id)
      if (novas.fontes.size) await tx.fonteRecursoEntidade.createMany({ data: [...novas.fontes].map(([codigo, nome]) => ({ entidadeId: entidade.id, ano: ANO, codigo, nomenclatura: nome || `Fonte ${codigo}`, vinculada: codigo !== '01000', origem: 'DESDOBRAMENTO' as const })) })
      for (const f of await tx.fonteRecursoEntidade.findMany({ where: { entidadeId: entidade.id, ano: ANO }, select: { codigo: true, id: true } })) fontesDb.set(f.codigo.trim(), f.id)

      // zera o proxy de valorAutorizado de TODAS as dotações da Prefeitura (vinha do PIT)
      const zerou = await tx.dotacaoDespesa.updateMany({ where: { orcamentoId: orcamento.id }, data: { valorAutorizado: 0 } })
      console.log(`  [apply] valorAutorizado zerado (proxy) em ${zerou.count} dotações`)

      let criadas = 0, atualizadas = 0
      for (const d of dots.values()) {
        const contaId = resolverConta(d.natureza)
        if (!contaId) throw new Error(`Natureza ${d.natureza} sem conta — não pode gravar.`)
        const dotKey = {
          orcamentoId: orcamento.id,
          unidadeOrcamentariaId: uosDb.get(d.uoCod)!,
          funcaoId: funcoesDb.get(d.funcao)!,
          subfuncaoId: subfuncoesDb.get(d.subfuncao)!,
          programaId: programasDb.get(d.programa)!,
          acaoId: acoesDb.get(`${d.programa}|${d.acao}`)!,
          contaDespesaEntidadeId: contaId,
          fonteRecursoEntidadeId: fontesDb.get(d.fonte)!,
        }
        const valor = (d.valor / 100).toFixed(2)
        const existente = await tx.dotacaoDespesa.findUnique({ where: { dotacao_unica: dotKey }, select: { id: true } })
        if (existente) { await tx.dotacaoDespesa.update({ where: { id: existente.id }, data: { valorAutorizado: valor } }); atualizadas++ }
        else { await tx.dotacaoDespesa.create({ data: { ...dotKey, valorAutorizado: valor, valorEmpenhado: 0 } }); criadas++ }
      }
      console.log(`  [apply] dotações LOA: criadas ${criadas} · atualizadas (casaram execução) ${atualizadas}`)
    },
    { timeout: 300_000 },
  )
}

main().catch((e) => { console.error('FALHOU:', e instanceof Error ? e.stack || e.message : e); process.exitCode = 1 }).finally(async () => {
  await prisma.$disconnect()
  await pool.end()
})
