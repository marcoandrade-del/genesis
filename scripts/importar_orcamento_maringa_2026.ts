/**
 * Importa o ORÇAMENTO 2026 (LOA — Lei nº 12.100, de 23/12/2025) da PREFEITURA
 * DE MARINGÁ a partir da API do Portal da Transparência (Elotech):
 *   https://transparencia.maringa.pr.gov.br/portaltransparencia-api
 *
 * Cria, para a entidade "Prefeitura do Município" (Maringá/PR), ano 2026:
 *   - Orcamento (APROVADO, lei/data reais) + PrevisaoReceita (natureza × fonte,
 *     valores ORÇADOS) + DotacaoDespesa (UO+função+subfunção+programa+ação+elemento)
 *   - dimensões ausentes: fontes de recurso TCE-PR usadas na receita, UOs,
 *     programas, ações, função 99 + subfunções fora do seed (245/608/999) e os
 *     DESDOBRAMENTOS municipais do plano de receita (códigos com detalhamento
 *     além do modelo TCE — pai vira sintética, como faz o app).
 *
 * Limitações da publicação (registradas em Orcamento.observacoes):
 *   - a receita publicada por natureza×fonte é a BRUTA; as deduções da LOA
 *     (FUNDEB etc.) não são abertas por natureza/fonte no portal, logo
 *     soma(previsões) > soma(dotações) — a diferença são as deduções.
 *   - o portal NÃO publica a fonte de recurso por dotação de despesa; todas as
 *     dotações entram na fonte sintética 9999 "Fonte não discriminada".
 *
 * Dry-run por padrão (diferencia em memória e imprime — não grava).
 * Para gravar: --apply. Se o orçamento 2026 já existir, aborta; com
 * --substituir apaga o orçamento existente (cascade) e recria.
 *
 * Rodar: npx tsx scripts/importar_orcamento_maringa_2026.ts [--apply] [--substituir]
 */

import 'dotenv/config'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'

const APPLY = process.argv.includes('--apply')
const SUBSTITUIR = process.argv.includes('--substituir')

const BASE = 'https://transparencia.maringa.pr.gov.br/portaltransparencia-api'
const ENT_PORTAL = '1' // Prefeitura do Município de Maringá no portal
const ANO = 2026
const FONTE_DESPESA = {
  codigo: '9999',
  nomenclatura: 'Fonte não discriminada (import Portal da Transparência)',
  especificacao:
    'A LOA publicada no portal não discrimina a fonte de recurso por dotação; todas as dotações importadas usam esta fonte.',
}

const pool = new Pool({ connectionString: process.env['DATABASE_URL'] })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

// ── HTTP ─────────────────────────────────────────────────────────────────────
async function getJson<T>(path: string, headers: Record<string, string> = {}): Promise<T> {
  for (let tentativa = 1; ; tentativa++) {
    try {
      const res = await fetch(`${BASE}${path}`, { headers })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return (await res.json()) as T
    } catch (e) {
      if (tentativa >= 3) throw new Error(`Falha em ${path}: ${e}`)
      await new Promise((r) => setTimeout(r, 1000 * tentativa))
    }
  }
}

// ── Códigos de receita (12 grupos: 1.1.1.2.50.0.1.00.00.00.00.00) ────────────
const GRUPOS_RECEITA = [1, 1, 1, 1, 2, 1, 1, 2, 2, 2, 2, 2]

/** "11125001" (dígitos crus da árvore) → "1.1.1.2.50.0.1" */
function agruparDigitos(raw: string): string {
  const partes: string[] = []
  let i = 0
  for (const g of GRUPOS_RECEITA) {
    if (i >= raw.length) break
    partes.push(raw.slice(i, i + g))
    i += g
  }
  return partes.join('.')
}

/** completa um código pontuado até os 12 grupos com zeros */
function pad12(codigo: string): string {
  const partes = codigo.split('.')
  for (let i = partes.length; i < 12; i++) partes.push('0'.repeat(GRUPOS_RECEITA[i]!))
  return partes.join('.')
}

/** nível = posição do último grupo não-zero */
function nivelReceita(codigo12: string): number {
  const partes = codigo12.split('.')
  for (let i = partes.length - 1; i >= 0; i--) {
    if (Number(partes[i]) !== 0) return i + 1
  }
  return 1
}

/** pai imediato = zera o último grupo significativo */
function paiReceita(codigo12: string): string {
  const partes = codigo12.split('.')
  const n = nivelReceita(codigo12)
  partes[n - 1] = '0'.repeat(GRUPOS_RECEITA[n - 1]!)
  return partes.join('.')
}

// ── DTOs do portal ───────────────────────────────────────────────────────────
interface PortalReceita {
  receita: string
  descricao: string
  valorOrcado: number | null
  aceitaMovimentacao: string | null
}
interface PortalDespesa {
  programatica: string
  descricao: string
  nivel: number
  valorPrevisto: number
}

console.log(`Portal da Transparência de Maringá → Gênesis (orçamento ${ANO})`)
console.log(APPLY ? 'Modo: APLICAR (grava no banco)\n' : 'Modo: dry-run (não grava)\n')

// entidade-alvo primeiro (fail-fast, antes dos ~70 fetches ao portal)
const entidade = await prisma.entidade.findFirst({
  where: {
    tipo: 'PREFEITURA',
    municipio: { is: { nome: { contains: 'Maring', mode: 'insensitive' }, estado: { is: { sigla: 'PR' } } } },
  },
})
if (!entidade) throw new Error('Entidade PREFEITURA de Maringá/PR não encontrada.')
console.log(`[banco] entidade: ${entidade.nome} (${entidade.id})`)

const orcamentoExistente = await prisma.orcamento.findUnique({
  where: { entidadeId_ano: { entidadeId: entidade.id, ano: ANO } },
})
if (orcamentoExistente && !SUBSTITUIR) {
  throw new Error(`Orçamento ${ANO} já existe (${orcamentoExistente.id}). Use --substituir para recriar.`)
}

// ── 1. Coleta ────────────────────────────────────────────────────────────────
const arvoreReceita = await getJson<PortalReceita[]>(`/api/receitas?entidade=${ENT_PORTAL}&exercicio=${ANO}`)
const catalogoReceita = new Map<string, string>() // codigo12 → descricao
for (const no of arvoreReceita) catalogoReceita.set(pad12(agruparDigitos(no.receita)), no.descricao)
console.log(`[coleta] árvore da receita: ${arvoreReceita.length} nós`)

const fontesPortal = await getJson<PortalReceita[]>(
  `/api/receitas/fonte-recursos?entidade=${ENT_PORTAL}&exercicio=${ANO}`
)
const fontesComValor = fontesPortal.filter((f) => (f.valorOrcado ?? 0) !== 0)
console.log(`[coleta] fontes de recurso: ${fontesPortal.length} (${fontesComValor.length} com receita orçada)`)

// previsões: (codigo12, fonte) → valor; o DTO de fontes reusa o campo `receita` como código
const previsoes = new Map<string, number>()
for (const fonte of fontesComValor) {
  const rows = await getJson<PortalReceita[]>(
    `/api/receitas/fonte-recursos/detalhes?entidade=${ENT_PORTAL}&exercicio=${ANO}&fonteRecurso=${fonte.receita}`
  )
  for (const r of rows) {
    const v = r.valorOrcado ?? 0
    if (v === 0) continue
    const chave = `${pad12(r.receita)}|${fonte.receita}`
    previsoes.set(chave, (previsoes.get(chave) ?? 0) + v)
  }
}
const totalReceita = [...previsoes.values()].reduce((a, b) => a + b, 0)
console.log(`[coleta] previsões natureza×fonte: ${previsoes.size}  total R$ ${totalReceita.toFixed(2)}`)

const despesaDetalhada = await getJson<PortalDespesa[]>(
  `/despesapornivel/detalhada?dataInicial=${ANO}-01-01&dataFinal=${ANO}-12-31`,
  { entidade: ENT_PORTAL, exercicio: String(ANO) }
)
// folhas (nível 11) = programática completa órgão.unidade.função.subfunção.programa.ação.c.g.m.elemento
// valorPrevisto=0 → dotação criada DEPOIS da LOA (crédito especial); fora do inicial
const folhasNivel11 = despesaDetalhada.filter((d) => d.nivel === 11)
const folhasDespesa = folhasNivel11.filter((d) => d.valorPrevisto > 0)
const puladasSemValor = folhasNivel11.length - folhasDespesa.length
if (puladasSemValor) {
  console.log(`[coleta] ${puladasSemValor} dotações com valor inicial 0 (créditos especiais pós-LOA) — puladas`)
}
const totalDespesa = folhasDespesa.reduce((a, d) => a + d.valorPrevisto, 0)
console.log(`[coleta] dotações de despesa (folhas): ${folhasDespesa.length}  total R$ ${totalDespesa.toFixed(2)}`)

// catálogos de dimensões a partir dos níveis intermediários da despesa
const nomesUO = new Map<string, string>() // "02.010" → nome
const nomesFuncao = new Map<string, string>()
const nomesSubfuncao = new Map<string, string>()
const funcaoDaSubfuncao = new Map<string, string>()
const nomesPrograma = new Map<string, string>()
const nomesAcao = new Map<string, string>() // "0002|2001" → nome
for (const d of despesaDetalhada) {
  const p = d.programatica.split('.')
  if (d.nivel === 2) nomesUO.set(d.programatica, d.descricao)
  if (d.nivel === 3) nomesFuncao.set(p[2]!, d.descricao)
  if (d.nivel === 4) {
    nomesSubfuncao.set(p[3]!, d.descricao)
    if (!funcaoDaSubfuncao.has(p[3]!)) funcaoDaSubfuncao.set(p[3]!, p[2]!)
  }
  if (d.nivel === 5) nomesPrograma.set(p[4]!, d.descricao)
  if (d.nivel === 6) nomesAcao.set(`${p[4]}|${p[5]}`, d.descricao)
}

// ── 2. Estado atual do banco ─────────────────────────────────────────────────
const contasReceitaDb = new Map(
  (
    await prisma.contaReceitaEntidade.findMany({
      where: { entidadeId: entidade.id, ano: ANO },
      select: { id: true, codigo: true, admiteMovimento: true },
    })
  ).map((c) => [c.codigo, c])
)
const contasDespesaDb = new Map(
  (
    await prisma.contaDespesaEntidade.findMany({
      where: { entidadeId: entidade.id, ano: ANO },
      select: { id: true, codigo: true, admiteMovimento: true },
    })
  ).map((c) => [c.codigo, c])
)
const fontesDb = new Map(
  (
    await prisma.fonteRecursoEntidade.findMany({
      where: { entidadeId: entidade.id, ano: ANO },
      select: { id: true, codigo: true },
    })
  ).map((f) => [f.codigo, f])
)
const uosDb = new Map(
  (await prisma.unidadeOrcamentaria.findMany({ where: { entidadeId: entidade.id } })).map((u) => [u.codigo, u])
)
const funcoesDb = new Map((await prisma.funcao.findMany()).map((f) => [f.codigo, f]))
const subfuncoesDb = new Map((await prisma.subfuncao.findMany()).map((s) => [s.codigo, s]))
const programasDb = new Map(
  (await prisma.programa.findMany({ where: { entidadeId: entidade.id, ano: ANO } })).map((p) => [p.codigo, p])
)

// ── 3. Diferenças a criar ────────────────────────────────────────────────────
// 3a. desdobramentos municipais da receita (cadeia até alcançar conta existente)
const novasContasReceita = new Map<string, { codigo: string; nivel: number; folha: boolean }>()
for (const chave of previsoes.keys()) {
  const codigo = chave.split('|')[0]!
  let atual = codigo
  let folha = true
  while (!contasReceitaDb.has(atual)) {
    const ja = novasContasReceita.get(atual)
    if (ja) {
      if (!folha) ja.folha = false
      break
    }
    if (!catalogoReceita.has(atual)) {
      throw new Error(`Código de receita ${atual} não está na árvore do portal — mapeamento de grupos errado?`)
    }
    novasContasReceita.set(atual, { codigo: atual, nivel: nivelReceita(atual), folha })
    atual = paiReceita(atual)
    folha = false
    if (nivelReceita(atual) <= 1 && !contasReceitaDb.has(atual)) {
      throw new Error(`Cadeia de ${codigo} não alcançou conta existente no plano da entidade.`)
    }
  }
}
// pais existentes (analíticos) que ganharão filhos → viram sintéticas
const paisQueViramSinteticas = new Set<string>()
for (const nova of novasContasReceita.values()) {
  const pai = paiReceita(nova.codigo)
  const existente = contasReceitaDb.get(pai)
  if (existente?.admiteMovimento) paisQueViramSinteticas.add(pai)
}

// 3b. fontes de recurso
const fontesACriar = fontesComValor
  .filter((f) => !fontesDb.has(f.receita))
  .map((f) => ({
    codigo: f.receita,
    nomenclatura: f.descricao,
    vinculada: !/livre/i.test(f.descricao),
  }))
if (!fontesDb.has(FONTE_DESPESA.codigo)) {
  fontesACriar.push({ codigo: FONTE_DESPESA.codigo, nomenclatura: FONTE_DESPESA.nomenclatura, vinculada: false })
}

// 3c. dimensões da despesa
const uosACriar = [...nomesUO].filter(([cod]) => !uosDb.has(cod))
const funcoesACriar = [...nomesFuncao].filter(([cod]) => !funcoesDb.has(cod))
const subfuncoesACriar = [...nomesSubfuncao].filter(([cod]) => !subfuncoesDb.has(cod))
const programasACriar = [...nomesPrograma].filter(([cod]) => !programasDb.has(cod))
// ações são por programa; como o orçamento é novo, criamos todas as usadas que faltarem
const acoesUsadas = new Map<string, string>() // "prog|acao" → nome
for (const f of folhasDespesa) {
  const p = f.programatica.split('.')
  acoesUsadas.set(`${p[4]}|${p[5]}`, nomesAcao.get(`${p[4]}|${p[5]}`) ?? '(sem nome no portal)')
}

function tipoPrograma(codigo: string, nome: string): 'FINALISTICO' | 'GESTAO' | 'OPERACOES_ESPECIAIS' {
  if (codigo === '0000' || codigo === '9999') return 'OPERACOES_ESPECIAIS'
  if (/APOIO ADMINISTRATIVO/i.test(nome)) return 'GESTAO'
  return 'FINALISTICO'
}
function tipoAcao(codigo: string): 'PROJETO' | 'ATIVIDADE' | 'OPERACAO_ESPECIAL' {
  if (codigo.startsWith('1')) return 'PROJETO'
  if (codigo.startsWith('2')) return 'ATIVIDADE'
  return 'OPERACAO_ESPECIAL'
}

// 3d. validações de mapeamento da despesa (conta por elemento: "3.1.90.07" → "3.1.90.07.00.00")
let dotacoesEmContaSintetica = 0
for (const f of folhasDespesa) {
  const p = f.programatica.split('.')
  if (p.length !== 10) throw new Error(`Programática inesperada: ${f.programatica}`)
  const conta = contasDespesaDb.get(`${p.slice(6).join('.')}.00.00`)
  if (!conta) throw new Error(`Natureza ${p.slice(6).join('.')} não existe no plano de despesa da entidade.`)
  if (!conta.admiteMovimento) dotacoesEmContaSintetica++
  if (f.valorPrevisto < 0) throw new Error(`Dotação com valor negativo: ${f.programatica}`)
}
let previsoesEmContaSintetica = 0
for (const chave of previsoes.keys()) {
  const conta = contasReceitaDb.get(chave.split('|')[0]!)
  if (conta && !conta.admiteMovimento) previsoesEmContaSintetica++
}

// ── 4. Relatório ─────────────────────────────────────────────────────────────
console.log('\n── diff (a criar) ──')
console.log(`contas de receita (desdobramentos municipais): ${novasContasReceita.size}`)
console.log(`  pais existentes que viram sintéticas: ${paisQueViramSinteticas.size}`)
console.log(`fontes de recurso: ${fontesACriar.length} (inclui a 9999 da despesa)`)
console.log(`unidades orçamentárias: ${uosACriar.length}`)
console.log(`funções: ${funcoesACriar.length} ${funcoesACriar.map(([c]) => c).join(' ')}`)
console.log(`subfunções: ${subfuncoesACriar.length} ${subfuncoesACriar.map(([c]) => c).join(' ')}`)
console.log(`programas: ${programasACriar.length}`)
console.log(`ações: ${acoesUsadas.size}`)
console.log(`orçamento: 1 (APROVADO, Lei nº 12.100/2025)${orcamentoExistente ? ' — SUBSTITUINDO o existente' : ''}`)
console.log(`previsões de receita: ${previsoes.size}  → R$ ${totalReceita.toFixed(2)} (bruta)`)
console.log(`dotações de despesa: ${folhasDespesa.length}  → R$ ${totalDespesa.toFixed(2)}`)
console.log(`  (deduções da receita não publicadas por fonte: R$ ${(totalReceita - totalDespesa).toFixed(2)})`)
if (dotacoesEmContaSintetica) {
  console.log(`  aviso: ${dotacoesEmContaSintetica} dotações apontam p/ conta de elemento sintética no plano`)
}
if (previsoesEmContaSintetica) {
  console.log(`  aviso: ${previsoesEmContaSintetica} previsões apontam p/ conta de receita sintética no plano`)
}

if (!APPLY) {
  console.log('\nDry-run. Reexecute com --apply para gravar.')
  await prisma.$disconnect()
  await pool.end()
  process.exit(0)
}

// ── 5. Gravação (uma transação) ──────────────────────────────────────────────
await prisma.$transaction(
  async (tx) => {
    if (orcamentoExistente) {
      await tx.orcamento.delete({ where: { id: orcamentoExistente.id } }) // cascade em dotações/previsões
      console.log('\n[apply] orçamento anterior removido (cascade)')
    }

    // funções e subfunções (referência global)
    for (const [codigo, nome] of funcoesACriar) {
      funcoesDb.set(codigo, await tx.funcao.create({ data: { codigo, nome } }))
    }
    for (const [codigo, nome] of subfuncoesACriar) {
      const funcao = funcoesDb.get(funcaoDaSubfuncao.get(codigo)!)
      if (!funcao) throw new Error(`Função da subfunção ${codigo} não encontrada.`)
      subfuncoesDb.set(codigo, await tx.subfuncao.create({ data: { codigo, nome, funcaoId: funcao.id } }))
    }

    // fontes
    await tx.fonteRecursoEntidade.createMany({
      data: fontesACriar.map((f) => ({
        entidadeId: entidade.id,
        ano: ANO,
        codigo: f.codigo,
        nomenclatura: f.nomenclatura,
        vinculada: f.vinculada,
        origem: 'DESDOBRAMENTO' as const,
        ...(f.codigo === FONTE_DESPESA.codigo ? { especificacao: FONTE_DESPESA.especificacao } : {}),
      })),
    })
    const fontesId = new Map(
      (await tx.fonteRecursoEntidade.findMany({ where: { entidadeId: entidade.id, ano: ANO } })).map((f) => [
        f.codigo,
        f.id,
      ])
    )

    // desdobramentos da receita (de cima p/ baixo; pai já existe quando o filho entra)
    const contasReceitaId = new Map([...contasReceitaDb].map(([cod, c]) => [cod, c.id]))
    const ordenadas = [...novasContasReceita.values()].sort((a, b) => a.nivel - b.nivel)
    for (const nova of ordenadas) {
      const paiId = contasReceitaId.get(paiReceita(nova.codigo))
      if (!paiId) throw new Error(`Pai de ${nova.codigo} ainda não existe na criação ordenada.`)
      const criada = await tx.contaReceitaEntidade.create({
        data: {
          entidadeId: entidade.id,
          ano: ANO,
          codigo: nova.codigo,
          descricao: catalogoReceita.get(nova.codigo)!,
          nivel: nova.nivel,
          admiteMovimento: nova.folha,
          origem: 'DESDOBRAMENTO',
          parentId: paiId,
        },
      })
      contasReceitaId.set(nova.codigo, criada.id)
    }
    if (paisQueViramSinteticas.size) {
      await tx.contaReceitaEntidade.updateMany({
        where: { entidadeId: entidade.id, ano: ANO, codigo: { in: [...paisQueViramSinteticas] } },
        data: { admiteMovimento: false },
      })
    }

    // UOs, programas, ações
    await tx.unidadeOrcamentaria.createMany({
      data: uosACriar.map(([codigo, nome]) => ({ entidadeId: entidade.id, codigo, nome })),
    })
    const uosId = new Map(
      (await tx.unidadeOrcamentaria.findMany({ where: { entidadeId: entidade.id } })).map((u) => [u.codigo, u.id])
    )
    await tx.programa.createMany({
      data: programasACriar.map(([codigo, nome]) => ({
        entidadeId: entidade.id,
        ano: ANO,
        codigo,
        nome,
        tipo: tipoPrograma(codigo, nome),
      })),
    })
    const programasId = new Map(
      (await tx.programa.findMany({ where: { entidadeId: entidade.id, ano: ANO } })).map((p) => [p.codigo, p.id])
    )
    const acoesExistentes = await tx.acao.findMany({
      where: { programa: { entidadeId: entidade.id, ano: ANO } },
      include: { programa: { select: { codigo: true } } },
    })
    const acoesId = new Map(acoesExistentes.map((a) => [`${a.programa.codigo}|${a.codigo}`, a.id]))
    const acoesData = [...acoesUsadas]
      .filter(([chave]) => !acoesId.has(chave))
      .map(([chave, nome]) => {
        const [prog, cod] = chave.split('|') as [string, string]
        return { programaId: programasId.get(prog)!, codigo: cod, nome, tipo: tipoAcao(cod) }
      })
    await tx.acao.createMany({ data: acoesData })
    for (const a of await tx.acao.findMany({
      where: { programa: { entidadeId: entidade.id, ano: ANO } },
      include: { programa: { select: { codigo: true } } },
    })) {
      acoesId.set(`${a.programa.codigo}|${a.codigo}`, a.id)
    }

    // orçamento + previsões + dotações
    const orcamento = await tx.orcamento.create({
      data: {
        entidadeId: entidade.id,
        ano: ANO,
        status: 'APROVADO',
        leiNumero: '12.100/2025',
        dataAprovacao: new Date('2025-12-23T00:00:00-03:00'),
        observacoes:
          'Importado do Portal da Transparência de Maringá (LOA 2026 — Lei nº 12.100, de 23/12/2025). ' +
          'Receita por natureza×fonte = valores ORÇADOS BRUTOS (deduções da LOA não são publicadas por fonte). ' +
          'O portal não publica fonte por dotação de despesa: todas as dotações usam a fonte 9999. ' +
          'Valores iniciais da LOA (créditos adicionais não importados).',
      },
    })

    await tx.previsaoReceita.createMany({
      data: [...previsoes].map(([chave, valor]) => {
        const [codigo, fonte] = chave.split('|') as [string, string]
        return {
          orcamentoId: orcamento.id,
          contaReceitaEntidadeId: contasReceitaId.get(codigo)!,
          fonteRecursoEntidadeId: fontesId.get(fonte)!,
          valorPrevisto: valor.toFixed(2),
        }
      }),
    })

    const fonteDespesaId = fontesId.get(FONTE_DESPESA.codigo)!
    await tx.dotacaoDespesa.createMany({
      data: folhasDespesa.map((f) => {
        const p = f.programatica.split('.')
        return {
          orcamentoId: orcamento.id,
          unidadeOrcamentariaId: uosId.get(`${p[0]}.${p[1]}`)!,
          funcaoId: funcoesDb.get(p[2]!)!.id,
          subfuncaoId: subfuncoesDb.get(p[3]!)!.id,
          programaId: programasId.get(p[4]!)!,
          acaoId: acoesId.get(`${p[4]}|${p[5]}`)!,
          contaDespesaEntidadeId: contasDespesaDb.get(`${p.slice(6).join('.')}.00.00`)!.id,
          fonteRecursoEntidadeId: fonteDespesaId,
          valorAutorizado: f.valorPrevisto.toFixed(2),
        }
      }),
    })

    // conferência dentro da transação
    const [nPrev, nDot] = [
      await tx.previsaoReceita.count({ where: { orcamentoId: orcamento.id } }),
      await tx.dotacaoDespesa.count({ where: { orcamentoId: orcamento.id } }),
    ]
    const somas = await tx.$queryRaw<{ receita: string; despesa: string }[]>`
      SELECT (SELECT COALESCE(SUM("valorPrevisto"),0) FROM previsoes_receita WHERE "orcamentoId"=${orcamento.id})::text AS receita,
             (SELECT COALESCE(SUM("valorAutorizado"),0) FROM dotacoes_despesa WHERE "orcamentoId"=${orcamento.id})::text AS despesa`
    console.log(`\n[apply] orçamento ${orcamento.id} criado`)
    console.log(`[apply] previsões: ${nPrev}  soma R$ ${somas[0]!.receita}  (esperado ${totalReceita.toFixed(2)})`)
    console.log(`[apply] dotações:  ${nDot}  soma R$ ${somas[0]!.despesa}  (esperado ${totalDespesa.toFixed(2)})`)
    if (Number(somas[0]!.receita) !== Number(totalReceita.toFixed(2))) throw new Error('Soma da receita divergiu!')
    if (Number(somas[0]!.despesa) !== Number(totalDespesa.toFixed(2))) throw new Error('Soma da despesa divergiu!')
  },
  { timeout: 180_000 }
)

console.log('\nConcluído.')
await prisma.$disconnect()
await pool.end()
