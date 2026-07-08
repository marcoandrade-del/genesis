/**
 * Importa os DECRETOS de alteração orçamentária de Maringá 2026 da API do
 * Portal da Transparência e os lança como créditos adicionais — via
 * CreditosAdicionaisService, nunca editando valorAutorizado na mão
 * (ver memória alteracoes-orcamentarias-dinamica).
 *
 * MODELO DA API (decifrado em 2026-07-03, ver decretos-import-aprendizados):
 *   GET /api/creditosadicionais?entidade=1&exercicio=2026&size=5000
 *   - `saldoAtualizado` = valor ATUAL da dotação (constante em todos os
 *     registros da mesma dotação — verificado: 0 inconsistências em 809).
 *   - Cada registro carrega o par {delta do decreto, atual − delta} nos
 *     campos (valorInicial, valor) EM ORDEM AMBÍGUA (a identidade
 *     ini+val=saldo é simétrica). Reduzida = delta negativo.
 *   - Desambiguação: por dotação, Σ deltas = atual − LOA(nossa). Solver
 *     escolhe delta ∈ {ini, val} por registro minimizando desvios do padrão
 *     (Suplementar→val, Reduzida→ini), via enumeração de subconjuntos.
 *   - Itens com decreto "null/null" = movimentos reais sem número → lançados
 *     como "S/N-2026" (aplicado primeiro).
 *
 * Datas: a API não publica a data do decreto → data do import como
 * placeholder + nota na justificativa; ordem oficial pelo número.
 *
 * Segurança: só grava com --apply se TODAS as dotações fecharem a equação e
 * a simulação sequencial não deixar saldo negativo (com reordenação por
 * viabilidade quando a ordem numérica trava). Verificação final: cada
 * dotação == saldoAtualizado do portal, e Σ == alvo global.
 * Idempotente: decretos já lançados (mesmo número) são pulados.
 *
 * RETOMADA INCREMENTAL (aprendizado de 2026-07-08): decretos já lançados saem
 * da EQUAÇÃO — o solver resolve só os pendentes contra o autorizado ATUAL do
 * banco. Re-resolver a história completa podia redistribuir flips entre
 * lançados e pendentes (mesma soma global, deltas individuais diferentes) e
 * atribuir a um pendente o valor errado do par ambíguo. Consequência: cada
 * rodada de conciliação sem número ganha um "S/N-<data>" próprio.
 *
 * Rodar: npx tsx scripts/importar_decretos_2026.ts [--apply]
 */

import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import { CreditosAdicionaisService } from '../src/services/creditos-adicionais.js'
import {
  filtrarPendentes,
  montarMovimentosPorDecreto,
  montarRegistrosPorDotacao,
  ordenarItensDecreto,
  ordenarPorViabilidade,
  resolverDeltasPendentes,
  type ItemPortalDecreto,
  type MovDecreto,
} from '../src/services/decretos-solver.js'

const APPLY = process.argv.includes('--apply')
const API = 'https://transparencia.maringa.pr.gov.br/portaltransparencia-api/api/creditosadicionais?entidade=1&exercicio=2026&size=5000'
const SNAPSHOT = 'data/creditos_portal_snapshot_2026-07-02.json'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

type ItemPortal = ItemPortalDecreto
type Mov = MovDecreto
const cent = (n: number) => Math.round(n * 100)
const brl = (c: number) => (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 })

async function carregarItens(): Promise<ItemPortal[]> {
  try {
    const res = await fetch(API)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const body = (await res.json()) as { content: ItemPortal[] }
    console.log(`API ao vivo: ${body.content.length} itens`)
    return body.content
  } catch (e) {
    const body = JSON.parse(readFileSync(SNAPSHOT, 'utf-8')) as { content: ItemPortal[] }
    console.log(`⚠️ API indisponível (${e instanceof Error ? e.message : e}); usando snapshot ${SNAPSHOT}: ${body.content.length} itens`)
    return body.content
  }
}


async function main() {
  const entidade = await prisma.entidade.findFirstOrThrow({ where: { nome: 'Prefeitura do Município' } })
  const orcamento = await prisma.orcamento.findFirstOrThrow({ where: { entidadeId: entidade.id, ano: 2026 } })

  // ── 1. Registros por dotação-fonte (núcleo compartilhado) ────────────────
  // "null/null" (sem número) entra como S/N-2026 na PRIMEIRA rodada; rodadas
  // seguintes conciliam resíduos num S/N datado próprio (ver montagem abaixo).
  const porDot = montarRegistrosPorDotacao(await carregarItens(), 'S/N-2026')
  // atual/dims de TODAS as dotações movimentadas no portal (antes do filtro
  // de pendentes) — insumo do alvo, da verificação e da conciliação por drift
  const infoPorKf = new Map([...porDot].map(([kf, regs]) => [kf, { atual: regs[0]!.atual, dims: regs[0]!.dims, fonte: regs[0]!.fonte }]))

  // ── 2. Base LOA por dotação ───────────────────────────────────────────────
  const dots = await prisma.dotacaoDespesa.findMany({
    where: { orcamentoId: orcamento.id },
    select: {
      id: true,
      valorAutorizado: true,
      unidadeOrcamentaria: { select: { codigo: true } },
      funcao: { select: { codigo: true } },
      subfuncao: { select: { codigo: true } },
      programa: { select: { codigo: true } },
      acao: { select: { codigo: true } },
      contaDespesa: { select: { codigo: true } },
      fonteRecurso: { select: { codigo: true } },
    },
  })
  const dotPorChave = new Map<string, (typeof dots)[number]>()
  for (const d of dots) {
    const a = d.acao.codigo
    const despesa = `${d.unidadeOrcamentaria.codigo}.${d.funcao.codigo}.${d.subfuncao.codigo}.${d.programa.codigo}.${a[0]}.${a.slice(1)}.${d.contaDespesa.codigo}`
    dotPorChave.set(`${despesa}|${d.fonteRecurso.codigo}`, d)
  }

  // RETOMADA INCREMENTAL: decretos já lançados saem da equação — o solver
  // resolve só os PENDENTES contra o autorizado ATUAL do banco (ver header).
  const jaLancados = new Set(
    (await prisma.creditoAdicional.findMany({ where: { orcamentoId: orcamento.id }, select: { numero: true } })).map((c) => c.numero),
  )
  filtrarPendentes(porDot, jaLancados)
  const baseAtual = (kf: string) => {
    const d = dotPorChave.get(kf)
    return d ? cent(Number(d.valorAutorizado)) : 0
  }

  // ── 3. Solver por dotação (núcleo compartilhado) ─────────────────────────
  const { fechaStd, fechaFlip, ajustes } = resolverDeltasPendentes(porDot, baseAtual)
  // Drift sem pendência numerada (ex.: item null/null NOVO depois do S/N já
  // lançado — os sem-número são filtrados como "lançados"): a diferença
  // banco × atual vira item de conciliação POR DIFERENÇA no S/N datado.
  for (const [kf, info] of infoPorKf) {
    if (porDot.has(kf)) continue
    const residuo = info.atual - baseAtual(kf)
    if (residuo !== 0) ajustes.push({ kf, dims: info.dims, fonte: info.fonte, residuo })
  }
  console.log(`dotações movimentadas: ${porDot.size}`)
  console.log(`equação fecha no padrão: ${fechaStd} | com flips ini↔val: ${fechaFlip} | com item de conciliação no S/N: ${ajustes.length}`)
  if (ajustes.length) {
    const somaAj = ajustes.reduce((s, a) => s + a.residuo, 0)
    console.log(`  Σ dos itens de conciliação: ${brl(somaAj)} (cada um listado no decreto S/N)`)
    for (const a of ajustes.slice(0, 5)) console.log(`   · ${a.kf}: ${brl(a.residuo)}`)
  }

  // ── 4. Montar decretos (núcleo compartilhado; conciliação num S/N datado) ─
  const SN = `S/N-${new Date().toISOString().slice(0, 10)}`
  const movPorDecreto = montarMovimentosPorDecreto(porDot, ajustes, SN)
  const pendentes = [...movPorDecreto.keys()]
    .filter((d) => !jaLancados.has(d))
    .sort((a, b) => (a.startsWith('S/N') ? 1 : b.startsWith('S/N') ? -1 : parseInt(a) - parseInt(b))) // S/N por ÚLTIMO: concilia no estado final

  // ── 5. Simulação sequencial com reordenação por viabilidade (núcleo) ──────
  const abre = (kf: string) => (dotPorChave.has(kf) ? cent(Number(dotPorChave.get(kf)!.valorAutorizado)) : 0) // estado ATUAL (retomada)
  const ordemViavel = ordenarPorViabilidade(pendentes, movPorDecreto, abre)
  if (!ordemViavel) {
    console.log('❌ há decretos que nunca cabem (saldo ficaria negativo) — investigar antes de aplicar.')
    process.exit(1)
  }
  const ordemFinal = ordemViavel
  console.log(`decretos a lançar: ${ordemFinal.length} (já lançados antes: ${jaLancados.size})`)

  // Σ esperado e fontes/dotações novas
  const fontesDb = new Map(
    (await prisma.fonteRecursoEntidade.findMany({ where: { entidadeId: entidade.id, ano: 2026 }, select: { id: true, codigo: true } })).map(
      (f) => [f.codigo, f.id],
    ),
  )
  const novasDot = [...new Set([...porDot.keys(), ...ajustes.map((a) => a.kf)])].filter((kf) => !dotPorChave.has(kf))
  const novasFontes = [...new Set(novasDot.map((kf) => kf.split('|')[1]!))].filter((f) => !fontesDb.has(f))
  const alvoMovimentadas = [...infoPorKf.values()].reduce((s, i) => s + i.atual, 0)
  const loaNaoMov = dots.reduce((s, d) => {
    const a = d.acao.codigo
    const kf = `${d.unidadeOrcamentaria.codigo}.${d.funcao.codigo}.${d.subfuncao.codigo}.${d.programa.codigo}.${a[0]}.${a.slice(1)}.${d.contaDespesa.codigo}|${d.fonteRecurso.codigo}`
    return infoPorKf.has(kf) ? s : s + cent(Number(d.valorAutorizado))
  }, 0)
  const alvoTotal = alvoMovimentadas + loaNaoMov
  console.log(`fontes a criar: ${novasFontes.length} | dotações-fonte a criar: ${novasDot.length}`)
  console.log(`ALVO: Σ autorizado final = ${brl(alvoTotal)} (movimentadas ${brl(alvoMovimentadas)} + LOA intocada ${brl(loaNaoMov)})`)

  if (!APPLY) {
    console.log('\nDry-run limpo (nada gravado). Rode com --apply para lançar.')
    return
  }

  // ── 6. Aplicar ────────────────────────────────────────────────────────────
  const [uosDb, funcoesDb2, subfDb, progsDb, acoesDb, contasDb] = await Promise.all([
    prisma.unidadeOrcamentaria.findMany({ where: { entidadeId: entidade.id }, select: { id: true, codigo: true } }),
    prisma.funcao.findMany({ select: { id: true, codigo: true } }),
    prisma.subfuncao.findMany({ select: { id: true, codigo: true } }),
    prisma.programa.findMany({ where: { entidadeId: entidade.id, ano: 2026 }, select: { id: true, codigo: true } }),
    prisma.acao.findMany({ where: { programa: { entidadeId: entidade.id, ano: 2026 } }, select: { id: true, codigo: true, programa: { select: { codigo: true } } } }),
    prisma.contaDespesaEntidade.findMany({ where: { entidadeId: entidade.id, ano: 2026 }, select: { id: true, codigo: true } }),
  ])
  const uoId = new Map(uosDb.map((x) => [x.codigo, x.id]))
  const funcaoId = new Map(funcoesDb2.map((x) => [x.codigo, x.id]))
  const subfId = new Map(subfDb.map((x) => [x.codigo, x.id]))
  const progId = new Map(progsDb.map((x) => [x.codigo, x.id]))
  const acaoId = new Map(acoesDb.map((a) => [`${a.programa.codigo}|${a.codigo}`, a.id]))
  const contaId = new Map(contasDb.map((x) => [x.codigo, x.id]))

  if (novasFontes.length) {
    await prisma.fonteRecursoEntidade.createMany({
      data: novasFontes.map((codigo) => ({
        entidadeId: entidade.id,
        ano: 2026,
        codigo,
        nomenclatura: `Fonte ${codigo} (via decreto)`,
        vinculada: true,
        origem: 'DESDOBRAMENTO' as const,
      })),
    })
    for (const f of await prisma.fonteRecursoEntidade.findMany({
      where: { entidadeId: entidade.id, ano: 2026, codigo: { in: novasFontes } },
    }))
      fontesDb.set(f.codigo, f.id)
    console.log(`✓ ${novasFontes.length} fontes criadas`)
  }
  const idPorKf = new Map<string, string>()
  for (const [kf, d] of dotPorChave) idPorKf.set(kf, d.id)
  for (const kf of novasDot) {
    const { dims, fonte } = porDot.get(kf)?.[0] ?? infoPorKf.get(kf)!
    const faltas = [
      ['uo', uoId.get(dims.uo)],
      ['funcao', funcaoId.get(dims.funcao)],
      ['subfuncao', subfId.get(dims.subfuncao)],
      ['programa', progId.get(dims.programa)],
      ['acao', acaoId.get(`${dims.programa}|${dims.acao}`)],
      ['conta', contaId.get(dims.conta)],
    ].filter(([, v]) => !v)
    if (faltas.length) throw new Error(`dimensão inexistente (${faltas.map(([n]) => n).join(',')}) em ${kf}`)
    const nova = await prisma.dotacaoDespesa.create({
      data: {
        orcamentoId: orcamento.id,
        unidadeOrcamentariaId: uoId.get(dims.uo)!,
        funcaoId: funcaoId.get(dims.funcao)!,
        subfuncaoId: subfId.get(dims.subfuncao)!,
        programaId: progId.get(dims.programa)!,
        acaoId: acaoId.get(`${dims.programa}|${dims.acao}`)!,
        contaDespesaEntidadeId: contaId.get(dims.conta)!,
        fonteRecursoEntidadeId: fontesDb.get(fonte)!,
        esfera: 'FISCAL',
        valorAutorizado: 0,
      },
      select: { id: true },
    })
    idPorKf.set(kf, nova.id)
  }
  if (novasDot.length) console.log(`✓ ${novasDot.length} dotações-fonte criadas (autorizado 0 — os decretos as dotam)`)

  const hoje = new Date().toISOString().slice(0, 10)
  const svc = new CreditosAdicionaisService(prisma)
  let lancados = 0
  for (const dec of ordemFinal) {
    const itensCredito = ordenarItensDecreto(movPorDecreto.get(dec)!).map((m) => ({
      dotacaoId: idPorKf.get(m.kf)!,
      operacao: m.operacao,
      valor: (m.valor / 100).toFixed(2),
    }))
    await svc.criar(orcamento.id, {
      tipo: 'SUPLEMENTAR',
      numero: dec,
      data: hoje,
      atoLegal: dec.startsWith('S/N') ? `Movimentos sem número de decreto no portal (conciliação de ${dec.slice(4)})` : `Decreto nº ${dec}`,
      justificativa: `Importado da API do Portal da Transparência em ${hoje}; a data oficial não é publicada pela API — ordem oficial pelo número do decreto.`,
      itens: itensCredito,
    })
    lancados++
    if (lancados % 50 === 0) console.log(`  … ${lancados}/${ordemFinal.length}`)
  }
  console.log(`✓ ${lancados} decretos lançados`)

  // ── 7. Verificação: cada dotação == atual do portal; Σ == alvo ────────────
  const finais = await prisma.dotacaoDespesa.findMany({
    where: { orcamentoId: orcamento.id },
    select: {
      valorAutorizado: true,
      unidadeOrcamentaria: { select: { codigo: true } },
      funcao: { select: { codigo: true } },
      subfuncao: { select: { codigo: true } },
      programa: { select: { codigo: true } },
      acao: { select: { codigo: true } },
      contaDespesa: { select: { codigo: true } },
      fonteRecurso: { select: { codigo: true } },
    },
  })
  let divergentes = 0
  let somaFinal = 0
  for (const d of finais) {
    const a = d.acao.codigo
    const kf = `${d.unidadeOrcamentaria.codigo}.${d.funcao.codigo}.${d.subfuncao.codigo}.${d.programa.codigo}.${a[0]}.${a.slice(1)}.${d.contaDespesa.codigo}|${d.fonteRecurso.codigo}`
    const v = cent(Number(d.valorAutorizado))
    somaFinal += v
    const info = infoPorKf.get(kf)
    if (info && v !== info.atual) {
      divergentes++
      if (divergentes <= 5) console.log(`  ✗ ${kf}: banco ${brl(v)} ≠ portal ${brl(info.atual)}`)
    }
  }
  console.log(`\ndotações divergentes do portal: ${divergentes}`)
  console.log(`Σ autorizado final: ${brl(somaFinal)} | alvo: ${brl(alvoTotal)} | Δ: ${brl(somaFinal - alvoTotal)}`)
  if (divergentes > 0 || Math.abs(somaFinal - alvoTotal) > 1) throw new Error('verificação final falhou — investigar!')
  console.log('✅ import dos decretos concluído: banco espelha o portal dotação a dotação.')
}

main().finally(async () => {
  await prisma.$disconnect()
  await pool.end()
})
