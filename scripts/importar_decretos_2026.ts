/**
 * Importa os DECRETOS de alteração orçamentária de Maringá 2026 direto da API
 * do Portal da Transparência (Elotech/OXY) e os lança como créditos adicionais
 * — via CreditosAdicionaisService, nunca editando valorAutorizado na mão
 * (ver memória alteracoes-orcamentarias-dinamica).
 *
 *   GET /api/creditosadicionais?entidade=1&exercicio=2026&size=5000
 *   Semântica dos campos (validada item a item, saldo = antes + delta):
 *     Suplementar: antes=valorInicial, delta=+valor
 *     Reduzida:    antes=valor,        delta=−valorInicial
 *   Normalização: delta negativo em Suplementar (estorno) vira ANULACAO;
 *   positivo em Reduzida vira REFORCO; delta 0 é pulado (reportado).
 *
 * Itens em fonte que a LOA não tinha (superávit 2xxx, convênios 5xxxx…):
 * cria a FonteRecursoEntidade e a dotação-fonte (autorizado 0) clonando as
 * dimensões da dotação-irmã de mesma programática — o decreto é quem a dota.
 *
 * A data oficial dos decretos NÃO é publicada pela API: usa a data do import
 * como placeholder e registra a limitação na justificativa; a ordem oficial
 * (número do decreto) rege a aplicação. Backfill de datas: Diário Oficial.
 *
 * Segurança: SIMULA a sequência completa em memória (saldo nunca negativo,
 * Σ final previsto) e só grava com --apply se a simulação fechar limpa.
 * Idempotente: decretos já lançados (mesmo número) são pulados.
 *
 * ⚠️ WIP (2026-07-03): o dry-run BLOQUEIA a aplicação — corretamente. A
 * reconstrução da ordem dos movimentos pelo Nº DO DECRETO gera 475 resíduos
 * (os `antes` se sobrepõem entre decretos → a ordem real não é a numérica).
 * PRÓXIMO PASSO (não aplicar antes disso): reconstruir a cadeia POR DOTAÇÃO
 * encadeando antes→saldo (a ordem emerge da própria cadeia), comparar a
 * abertura da cadeia com nossa LOA, e só então emitir os decretos. A âncora
 * de estado final atual reescreve documentos em massa — NÃO usar como está.
 *
 * Rodar: npx tsx scripts/importar_decretos_2026.ts [--apply]
 */

import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import { CreditosAdicionaisService } from '../src/services/creditos-adicionais.js'

const APPLY = process.argv.includes('--apply')
const API = 'https://transparencia.maringa.pr.gov.br/portaltransparencia-api/api/creditosadicionais?entidade=1&exercicio=2026&size=5000'
const FALLBACK_JSON =
  '/tmp/claude-1000/-home-marco-claude-Projetos/79bbedb3-98e6-4e27-b5b9-eeb825e596e4/scratchpad/creditos_full.json'
const LOA_INICIAL = 2_842_650_399.0

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

type ItemPortal = {
  despesa: string
  valorInicial: number
  valor: number
  saldoAtualizado: number
  decreto: string
  natureza: 'Suplementar' | 'Reduzida'
  fonteRecurso: number
  sequencia: number
}
const r2 = (n: number) => Math.round(n * 100) / 100
const brl = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 2 })

async function carregarItens(): Promise<ItemPortal[]> {
  try {
    const res = await fetch(API)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const body = (await res.json()) as { content: ItemPortal[] }
    console.log(`API ao vivo: ${body.content.length} itens`)
    return body.content
  } catch (e) {
    const body = JSON.parse(readFileSync(FALLBACK_JSON, 'utf-8')) as { content: ItemPortal[] }
    console.log(`⚠️ API indisponível (${e instanceof Error ? e.message : e}); usando snapshot local: ${body.content.length} itens`)
    return body.content
  }
}

// "26.010.06.181.0021.2.125.4.4.90.52.00.00" → dimensões
function parseDespesa(despesa: string) {
  const p = despesa.split('.')
  if (p.length !== 13) return null
  return {
    uo: `${p[0]}.${p[1]}`,
    funcao: p[2]!,
    subfuncao: p[3]!,
    programa: p[4]!,
    acao: `${p[5]}${p[6]!.padStart(3, '0')}`,
    conta: p.slice(7).join('.'),
  }
}
const chaveSemFonte = (d: NonNullable<ReturnType<typeof parseDespesa>>) =>
  `${d.uo}|${d.funcao}|${d.subfuncao}|${d.programa}|${d.acao}|${d.conta}`

async function main() {
  const entidade = await prisma.entidade.findFirstOrThrow({ where: { nome: 'Prefeitura do Município' } })
  const orcamento = await prisma.orcamento.findFirstOrThrow({ where: { entidadeId: entidade.id, ano: 2026 } })

  // ── 1. Itens do portal, normalizados ──────────────────────────────────────
  const brutos = await carregarItens()
  // Itens sem nº de decreto são movimentos REAIS não numerados no portal —
  // entram como lançamento sintético "S/N-2026", aplicado antes dos numerados.
  const itens = brutos.map((i) => (!i.decreto || i.decreto === 'null/null' ? { ...i, decreto: 'S/N-2026' } : i))
  const qtdSN = itens.filter((i) => i.decreto === 'S/N-2026').length
  console.log(`itens: ${itens.length} (sem nº de decreto, lançados como S/N-2026: ${qtdSN})`)

  type Mov = { despesa: string; dims: NonNullable<ReturnType<typeof parseDespesa>>; fonte: string; operacao: 'REFORCO' | 'ANULACAO'; valor: number; antes: number }
  const movimentos = new Map<string, Mov[]>() // decreto → movimentos
  let pulados = 0
  for (const i of itens) {
    const dims = parseDespesa(i.despesa)
    if (!dims) throw new Error(`programática inesperada: ${i.despesa}`)
    const delta = i.natureza === 'Suplementar' ? i.valor : -i.valorInicial
    if (delta === 0) {
      pulados++
      continue
    }
    const mov: Mov = {
      despesa: i.despesa,
      dims,
      fonte: String(i.fonteRecurso),
      operacao: delta > 0 ? 'REFORCO' : 'ANULACAO',
      valor: r2(Math.abs(delta)),
      antes: r2(i.natureza === 'Suplementar' ? i.valorInicial : i.valor),
    }
    const l = movimentos.get(i.decreto) ?? []
    l.push(mov)
    movimentos.set(i.decreto, l)
  }
  console.log(`decretos: ${movimentos.size} | itens delta=0 pulados: ${pulados}`)

  // ── 1b. Dedup por dotação-fonte: o portal registra certas anulações DUAS
  // vezes (estorno "Suplementar" de delta negativo num decreto + a "Reduzida"
  // formal noutro, com o MESMO saldo final). Aplicar ambas = dupla contagem.
  // Regra: descarta o Suplementar-negativo quando existe Reduzida da mesma
  // dotação com o mesmo saldoAtualizado (a Reduzida é o documento formal).
  const porDotacao = new Map<string, { dec: string; mov: Mov; saldoFinalItem: number }[]>()
  for (const [dec, ls] of movimentos) {
    for (const m of ls) {
      const kf = `${chaveSemFonte(m.dims)}|${m.fonte}`
      const l = porDotacao.get(kf) ?? []
      l.push({ dec, mov: m, saldoFinalItem: r2(m.antes + (m.operacao === 'REFORCO' ? m.valor : -m.valor)) })
      porDotacao.set(kf, l)
    }
  }
  let dedup = 0
  for (const [, regs] of porDotacao) {
    for (const a of regs) {
      // Suplementar de delta negativo virou ANULACAO na normalização; o par
      // formal é uma Reduzida (também ANULACAO) de outro decreto com mesmo saldo.
      if (a.mov.operacao !== 'ANULACAO') continue
      const par = regs.find(
        (b) => b !== a && b.mov.operacao === 'ANULACAO' && Math.abs(b.saldoFinalItem - a.saldoFinalItem) < 0.01 && (parseInt(b.dec) || 0) > (parseInt(a.dec) || 0),
      )
      if (par) {
        const lista = movimentos.get(a.dec)!
        const idx = lista.indexOf(a.mov)
        if (idx >= 0) {
          lista.splice(idx, 1)
          dedup++
        }
      }
    }
  }
  console.log(`anulações duplicadas descartadas (estorno espelhado em decreto posterior): ${dedup}`)

  // ── 2. Estado do banco ────────────────────────────────────────────────────
  const dots = await prisma.dotacaoDespesa.findMany({
    where: { orcamentoId: orcamento.id },
    select: {
      id: true,
      valorAutorizado: true,
      esfera: true,
      unidadeOrcamentariaId: true,
      funcaoId: true,
      subfuncaoId: true,
      programaId: true,
      acaoId: true,
      contaDespesaEntidadeId: true,
      unidadeOrcamentaria: { select: { codigo: true } },
      funcao: { select: { codigo: true } },
      subfuncao: { select: { codigo: true } },
      programa: { select: { codigo: true } },
      acao: { select: { codigo: true } },
      contaDespesa: { select: { codigo: true } },
      fonteRecurso: { select: { codigo: true } },
    },
  })
  type Dot = (typeof dots)[number]
  const porChaveFonte = new Map<string, Dot>()
  for (const d of dots) {
    const k = `${d.unidadeOrcamentaria.codigo}|${d.funcao.codigo}|${d.subfuncao.codigo}|${d.programa.codigo}|${d.acao.codigo}|${d.contaDespesa.codigo}`
    porChaveFonte.set(`${k}|${d.fonteRecurso.codigo}`, d)
  }
  // dimensões por código (todas existem — conferido no recon)
  const [uosDb, funcoesDb, subfDb, progsDb, acoesDb, contasDb] = await Promise.all([
    prisma.unidadeOrcamentaria.findMany({ where: { entidadeId: entidade.id }, select: { id: true, codigo: true } }),
    prisma.funcao.findMany({ select: { id: true, codigo: true } }),
    prisma.subfuncao.findMany({ select: { id: true, codigo: true } }),
    prisma.programa.findMany({ where: { entidadeId: entidade.id, ano: 2026 }, select: { id: true, codigo: true } }),
    prisma.acao.findMany({ where: { programa: { entidadeId: entidade.id, ano: 2026 } }, select: { id: true, codigo: true, programa: { select: { codigo: true } } } }),
    prisma.contaDespesaEntidade.findMany({ where: { entidadeId: entidade.id, ano: 2026 }, select: { id: true, codigo: true } }),
  ])
  const uoId = new Map(uosDb.map((x) => [x.codigo, x.id]))
  const funcaoId = new Map(funcoesDb.map((x) => [x.codigo, x.id]))
  const subfId = new Map(subfDb.map((x) => [x.codigo, x.id]))
  const progId = new Map(progsDb.map((x) => [x.codigo, x.id]))
  const acaoId = new Map(acoesDb.map((a) => [`${a.programa.codigo}|${a.codigo}`, a.id]))
  const contaId = new Map(contasDb.map((x) => [x.codigo, x.id]))
  const fontesDb = new Map(
    (await prisma.fonteRecursoEntidade.findMany({ where: { entidadeId: entidade.id, ano: 2026 }, select: { id: true, codigo: true } })).map(
      (f) => [f.codigo, f.id],
    ),
  )
  const jaLancados = new Set(
    (await prisma.creditoAdicional.findMany({ where: { orcamentoId: orcamento.id }, select: { numero: true } })).map((c) => c.numero),
  )

  // ── 3. Simulação completa em memória ─────────────────────────────────────
  const ordenados = [...movimentos.keys()].sort((a, b) => (a === 'S/N-2026' ? -1 : b === 'S/N-2026' ? 1 : parseInt(a) - parseInt(b)))
  const fontesACriar = new Set<string>()
  const dotacoesACriar = new Map<string, { fonte: string; abertura: number; ids: Record<string, string> }>() // chave+fonte
  const saldoSim = new Map<string, number>() // dotKey(chave|fonte) → autorizado simulado
  const erros: string[] = []
  let somaDelta = 0
  let decretosNovos = 0

  for (const dec of ordenados) {
    if (jaLancados.has(dec)) continue
    decretosNovos++
    for (const m of movimentos.get(dec)!) {
      const k = chaveSemFonte(m.dims)
      const kf = `${k}|${m.fonte}`
      if (!porChaveFonte.has(kf) && !dotacoesACriar.has(kf)) {
        const ids = {
          uo: uoId.get(m.dims.uo),
          funcao: funcaoId.get(m.dims.funcao),
          subfuncao: subfId.get(m.dims.subfuncao),
          programa: progId.get(m.dims.programa),
          acao: acaoId.get(`${m.dims.programa}|${m.dims.acao}`),
          conta: contaId.get(m.dims.conta),
        }
        const faltando = Object.entries(ids).filter(([, v]) => !v).map(([n]) => n)
        if (faltando.length) {
          erros.push(`decreto ${dec}: dimensão inexistente (${faltando.join(',')}) em ${m.despesa}`)
          continue
        }
        // abertura = "antes" do 1º movimento numerado (captura itens sem nº de decreto)
        dotacoesACriar.set(kf, { fonte: m.fonte, abertura: m.antes, ids: ids as Record<string, string> })
        if (!fontesDb.has(m.fonte)) fontesACriar.add(m.fonte)
        saldoSim.set(kf, m.antes)
        somaDelta = r2(somaDelta + m.antes) // a abertura também entra no Σ esperado
      }
      if (!saldoSim.has(kf)) saldoSim.set(kf, Number(porChaveFonte.get(kf)!.valorAutorizado))
      const delta = m.operacao === 'REFORCO' ? m.valor : -m.valor
      const novo = r2(saldoSim.get(kf)! + delta)
      if (novo < -0.005) {
        erros.push(`decreto ${dec}: anulação deixa ${m.despesa} fonte ${m.fonte} negativa (${brl(novo)})`)
      }
      saldoSim.set(kf, novo)
      somaDelta = r2(somaDelta + delta)
    }
  }

  // ── 3b. Âncora no estado FINAL do portal: por dotação, o saldoAtualizado do
  // movimento de maior decreto é a verdade. Retificações divergentes (estorno
  // com magnitude ≠ da anulação formal, visto em 2 dotações) geram resíduo —
  // corrigido no ÚLTIMO movimento da dotação, com log.
  let residuosCorrigidos = 0
  for (const [kf, regs] of porDotacao) {
    const vivos = regs.filter((r) => movimentos.get(r.dec)?.includes(r.mov))
    if (!vivos.length) continue
    const ultimo = vivos.reduce((a, b) => ((parseInt(b.dec) || 0) >= (parseInt(a.dec) || 0) ? b : a))
    const finalPortal = ultimo.saldoFinalItem
    const abertura = dotacoesACriar.has(kf)
      ? dotacoesACriar.get(kf)!.abertura
      : porChaveFonte.has(kf)
        ? Number(porChaveFonte.get(kf)!.valorAutorizado)
        : 0
    const somaDeltas = vivos.reduce((s2, r) => s2 + (r.mov.operacao === 'REFORCO' ? r.mov.valor : -r.mov.valor), 0)
    const residuo = r2(finalPortal - (abertura + somaDeltas))
    if (Math.abs(residuo) > 0.01) {
      // corrige o valor do último movimento (retificação divergente no portal)
      const m = ultimo.mov
      const deltaAtual = m.operacao === 'REFORCO' ? m.valor : -m.valor
      const deltaNovo = r2(deltaAtual + residuo)
      m.operacao = deltaNovo >= 0 ? 'REFORCO' : 'ANULACAO'
      m.valor = r2(Math.abs(deltaNovo))
      residuosCorrigidos++
      console.log(`  resíduo ${brl(residuo)} corrigido no decreto ${ultimo.dec} (${kf.split('|')[0]}… fonte ${m.fonte})`)
    }
  }
  if (residuosCorrigidos) console.log(`retificações divergentes corrigidas pela âncora do estado final: ${residuosCorrigidos}`)
  // recomputa a simulação do zero com os movimentos finais
  saldoSim.clear()
  somaDelta = 0
  erros.length = 0
  for (const dec of ordenados) {
    if (jaLancados.has(dec)) continue
    for (const m of movimentos.get(dec)!) {
      if (m.valor === 0) continue
      const kf2 = `${chaveSemFonte(m.dims)}|${m.fonte}`
      if (!saldoSim.has(kf2)) {
        const abre = dotacoesACriar.has(kf2) ? dotacoesACriar.get(kf2)!.abertura : Number(porChaveFonte.get(kf2)?.valorAutorizado ?? 0)
        saldoSim.set(kf2, abre)
        if (dotacoesACriar.has(kf2)) somaDelta = r2(somaDelta + abre)
      }
      const dd = m.operacao === 'REFORCO' ? m.valor : -m.valor
      const novo = r2(saldoSim.get(kf2)! + dd)
      if (novo < -0.005) erros.push(`decreto ${dec}: anulação deixa ${m.despesa} fonte ${m.fonte} negativa (${brl(novo)})`)
      saldoSim.set(kf2, novo)
      somaDelta = r2(somaDelta + dd)
    }
  }

  const somaAtual = dots.reduce((s, d) => s + Number(d.valorAutorizado), 0)
  const esperado = r2(somaAtual + somaDelta)
  console.log(`\ndecretos a lançar: ${decretosNovos} (já lançados antes: ${[...jaLancados].length})`)
  console.log(`fontes a criar: ${fontesACriar.size} | dotações-fonte a criar: ${dotacoesACriar.size}`)
  console.log(`Σ autorizado atual: ${brl(somaAtual)} | Δ dos decretos: ${brl(somaDelta)} | esperado: ${brl(esperado)}`)
  console.log(`(referência: LOA inicial ${brl(LOA_INICIAL)})`)
  if (erros.length) {
    console.log(`\n❌ simulação encontrou ${erros.length} problemas — nada será gravado:`)
    for (const e of erros.slice(0, 15)) console.log('  -', e)
    process.exit(1)
  }
  if (!APPLY) {
    console.log('\nDry-run limpo (nada gravado). Rode com --apply para lançar os decretos.')
    return
  }

  // ── 4. Aplicar: fontes + dotações-fonte novas, depois decretos em ordem ──
  const hoje = new Date().toISOString().slice(0, 10)
  const svc = new CreditosAdicionaisService(prisma)

  if (fontesACriar.size) {
    await prisma.fonteRecursoEntidade.createMany({
      data: [...fontesACriar].map((codigo) => ({
        entidadeId: entidade.id,
        ano: 2026,
        codigo,
        nomenclatura: `Fonte ${codigo} (via decreto)`,
        vinculada: true,
        origem: 'DESDOBRAMENTO' as const,
      })),
    })
    for (const f of await prisma.fonteRecursoEntidade.findMany({
      where: { entidadeId: entidade.id, ano: 2026, codigo: { in: [...fontesACriar] } },
    }))
      fontesDb.set(f.codigo, f.id)
    console.log(`✓ ${fontesACriar.size} fontes criadas`)
  }

  for (const [kf, { fonte, abertura, ids }] of dotacoesACriar) {
    const nova = await prisma.dotacaoDespesa.create({
      data: {
        orcamentoId: orcamento.id,
        unidadeOrcamentariaId: ids.uo!,
        funcaoId: ids.funcao!,
        subfuncaoId: ids.subfuncao!,
        programaId: ids.programa!,
        acaoId: ids.acao!,
        contaDespesaEntidadeId: ids.conta!,
        fonteRecursoEntidadeId: fontesDb.get(fonte)!,
        esfera: 'FISCAL',
        valorAutorizado: abertura, // abertura = antes do 1º movimento (itens sem nº de decreto)
      },
      select: {
        id: true,
        valorAutorizado: true,
        esfera: true,
        unidadeOrcamentariaId: true,
        funcaoId: true,
        subfuncaoId: true,
        programaId: true,
        acaoId: true,
        contaDespesaEntidadeId: true,
        unidadeOrcamentaria: { select: { codigo: true } },
        funcao: { select: { codigo: true } },
        subfuncao: { select: { codigo: true } },
        programa: { select: { codigo: true } },
        acao: { select: { codigo: true } },
        contaDespesa: { select: { codigo: true } },
        fonteRecurso: { select: { codigo: true } },
      },
    })
    porChaveFonte.set(kf, nova)
  }
  if (dotacoesACriar.size) console.log(`✓ ${dotacoesACriar.size} dotações-fonte criadas (abertura = antes do 1º movimento)`)

  let lancados = 0
  for (const dec of ordenados) {
    if (jaLancados.has(dec)) continue
    const itensCredito = movimentos
      .get(dec)!
      .filter((m) => m.valor > 0)
      .map((m) => ({
        dotacaoId: porChaveFonte.get(`${chaveSemFonte(m.dims)}|${m.fonte}`)!.id,
        operacao: m.operacao,
        valor: String(m.valor),
      }))
    if (itensCredito.length === 0) continue
    await svc.criar(orcamento.id, {
      tipo: 'SUPLEMENTAR',
      numero: dec,
      data: hoje,
      atoLegal: dec === 'S/N-2026' ? 'Movimentos sem número de decreto no portal (2026)' : `Decreto nº ${dec}`,
      justificativa:
        'Importado da API do Portal da Transparência (creditosadicionais) em ' +
        hoje +
        '; a data oficial do decreto não é publicada pela API — ordem oficial pelo número.',
      itens: itensCredito,
    })
    lancados++
    if (lancados % 50 === 0) console.log(`  … ${lancados}/${decretosNovos} decretos lançados`)
  }
  console.log(`✓ ${lancados} decretos lançados`)

  // ── 5. Verificação final ──────────────────────────────────────────────────
  const agg = await prisma.dotacaoDespesa.aggregate({ where: { orcamentoId: orcamento.id }, _sum: { valorAutorizado: true } })
  const somaFinal = Number(agg._sum.valorAutorizado ?? 0)
  console.log(`\nΣ autorizado final: ${brl(somaFinal)} | esperado: ${brl(esperado)} | Δ: ${brl(r2(somaFinal - esperado))}`)
  if (Math.abs(somaFinal - esperado) > 0.01) throw new Error('Σ final diverge do simulado — investigar!')
  console.log('✅ import dos decretos concluído e conferido.')
}

main().finally(async () => {
  await prisma.$disconnect()
  await pool.end()
})
