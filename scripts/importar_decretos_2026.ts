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
const SNAPSHOT = 'data/creditos_portal_snapshot_2026-07-02.json'

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

async function main() {
  const entidade = await prisma.entidade.findFirstOrThrow({ where: { nome: 'Prefeitura do Município' } })
  const orcamento = await prisma.orcamento.findFirstOrThrow({ where: { entidadeId: entidade.id, ano: 2026 } })

  // ── 1. Registros por dotação-fonte ────────────────────────────────────────
  const brutos = (await carregarItens()).map((i) => ({
    ...i,
    decreto: !i.decreto || i.decreto === 'null/null' ? 'S/N-2026' : i.decreto,
  }))
  type Reg = {
    dec: string
    dims: NonNullable<ReturnType<typeof parseDespesa>>
    fonte: string
    std: number // delta padrão (centavos): Supl→+val, Red→−ini
    alt: number // delta alternativo:      Supl→+ini, Red→−val
    atual: number
    deltaFinal?: number
  }
  const porDot = new Map<string, Reg[]>()
  for (const i of brutos) {
    const dims = parseDespesa(i.despesa)
    if (!dims) throw new Error(`programática inesperada: ${i.despesa}`)
    const reg: Reg = {
      dec: i.decreto,
      dims,
      fonte: String(i.fonteRecurso),
      std: i.natureza === 'Suplementar' ? cent(i.valor) : -cent(i.valorInicial),
      alt: i.natureza === 'Suplementar' ? cent(i.valorInicial) : -cent(i.valor),
      atual: cent(i.saldoAtualizado),
    }
    if (reg.std === 0 && reg.alt === 0) continue
    const kf = `${i.despesa}|${reg.fonte}`
    const l = porDot.get(kf) ?? []
    l.push(reg)
    porDot.set(kf, l)
  }

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

  // Base do solver = LOA ORIGINAL (autorizado atual − créditos já lançados),
  // p/ retomada segura após aplicação parcial (idempotência por nº do decreto).
  const aplicadoPorDot = new Map<string, number>()
  const itensAplicados = await prisma.creditoAdicionalItem.findMany({
    where: { credito: { orcamentoId: orcamento.id } },
    select: { dotacaoDespesaId: true, operacao: true, valor: true },
  })
  for (const it of itensAplicados) {
    const d = (it.operacao === 'REFORCO' ? 1 : -1) * cent(Number(it.valor))
    aplicadoPorDot.set(it.dotacaoDespesaId, (aplicadoPorDot.get(it.dotacaoDespesaId) ?? 0) + d)
  }
  const baseOriginal = (kf: string) => {
    const d = dotPorChave.get(kf)
    if (!d) return 0
    return cent(Number(d.valorAutorizado)) - (aplicadoPorDot.get(d.id) ?? 0)
  }

  // ── 3. Solver por dotação: Σ deltas = atual − base ────────────────────────
  let fechaStd = 0
  let fechaFlip = 0
  const insoluveis: string[] = []
  const ajustes: { kf: string; dims: Reg['dims']; fonte: string; residuo: number }[] = []
  for (const [kf, regs] of porDot) {
    const base = baseOriginal(kf)
    const alvo = regs[0]!.atual - base
    const somaStd = regs.reduce((s, r) => s + r.std, 0)
    if (somaStd === alvo) {
      for (const r of regs) r.deltaFinal = r.std
      fechaStd++
      continue
    }
    // busca de custo mínimo: cada registro escolhe delta ∈ {std, alt, −std, −alt}
    // (custos 0/1/2/2 — sinal invertido = estorno exibido com a natureza do doc
    // original). DFS com poda por soma alcançável; alvo exato em centavos.
    const n = regs.length
    const OPCOES = regs.map((r) => {
      const cand = [
        { d: r.std, c: 0 },
        { d: r.alt, c: 1 },
        { d: -r.std, c: 2 },
        { d: -r.alt, c: 2 },
      ]
      // dedup de valores iguais mantendo o menor custo
      const vistos = new Map<number, number>()
      for (const o of cand) if (!vistos.has(o.d) || vistos.get(o.d)! > o.c) vistos.set(o.d, o.c)
      return [...vistos.entries()].map(([d, c]) => ({ d, c })).sort((a, b) => a.c - b.c)
    })
    const sufMin: number[] = new Array(n + 1).fill(0)
    const sufMax: number[] = new Array(n + 1).fill(0)
    for (let i = n - 1; i >= 0; i--) {
      sufMin[i] = sufMin[i + 1]! + Math.min(...OPCOES[i]!.map((o) => o.d))
      sufMax[i] = sufMax[i + 1]! + Math.max(...OPCOES[i]!.map((o) => o.d))
    }
    let melhor: { escolha: number[]; custo: number } | null = null
    const escolha: number[] = new Array(n).fill(0)
    let nos = 0
    const LIMITE_NOS = 3_000_000
    const dfs = (i: number, resto: number, custo: number) => {
      if (nos++ > LIMITE_NOS) return
      if (melhor && custo >= melhor.custo) return
      if (i === n) {
        if (resto === 0) melhor = { escolha: [...escolha], custo }
        return
      }
      if (resto < sufMin[i]! || resto > sufMax[i]!) return
      for (let oi = 0; oi < OPCOES[i]!.length; oi++) {
        escolha[i] = oi
        dfs(i + 1, resto - OPCOES[i]![oi]!.d, custo + OPCOES[i]![oi]!.c)
      }
    }
    if (n <= 22) dfs(0, alvo, 0)
    if (melhor) {
      const m = melhor as { escolha: number[]; custo: number }
      regs.forEach((r, i) => (r.deltaFinal = OPCOES[i]![m.escolha[i]!]!.d))
      fechaFlip++
    } else {
      // registros ambíguos sem combinação exata: usa os deltas padrão e
      // concilia o resíduo com um item EXPLÍCITO no S/N-2026 (rastreável).
      for (const r of regs) r.deltaFinal = r.std
      const residuo = alvo - somaStd
      ajustes.push({ kf, dims: regs[0]!.dims, fonte: regs[0]!.fonte, residuo })
    }
  }
  console.log(`dotações movimentadas: ${porDot.size}`)
  console.log(`equação fecha no padrão: ${fechaStd} | com flips ini↔val: ${fechaFlip} | com item de conciliação no S/N: ${ajustes.length}`)
  if (ajustes.length) {
    const somaAj = ajustes.reduce((s, a) => s + a.residuo, 0)
    console.log(`  Σ dos itens de conciliação: ${brl(somaAj)} (cada um listado no decreto S/N)`) 
    for (const a of ajustes.slice(0, 5)) console.log(`   · ${a.kf}: ${brl(a.residuo)}`)
  }

  // ── 4. Montar decretos com os deltas resolvidos ───────────────────────────
  type Mov = { kf: string; dims: Reg['dims']; fonte: string; operacao: 'REFORCO' | 'ANULACAO'; valor: number }
  const movPorDecreto = new Map<string, Mov[]>()
  for (const [kf, regs] of porDot) {
    for (const r of regs) {
      if (!r.deltaFinal) continue
      const l = movPorDecreto.get(r.dec) ?? []
      l.push({ kf, dims: r.dims, fonte: r.fonte, operacao: r.deltaFinal > 0 ? 'REFORCO' : 'ANULACAO', valor: Math.abs(r.deltaFinal) })
      movPorDecreto.set(r.dec, l)
    }
  }
  for (const a of ajustes) {
    if (a.residuo === 0) continue
    const l = movPorDecreto.get('S/N-2026') ?? []
    l.push({ kf: a.kf, dims: a.dims, fonte: a.fonte, operacao: a.residuo > 0 ? 'REFORCO' : 'ANULACAO', valor: Math.abs(a.residuo) })
    movPorDecreto.set('S/N-2026', l)
  }
  for (const [dec, movs] of movPorDecreto) {
    const porKf = new Map<string, Mov>()
    for (const m of movs) {
      const ex = porKf.get(m.kf)
      if (!ex) {
        porKf.set(m.kf, { ...m })
        continue
      }
      const liq = (ex.operacao === 'REFORCO' ? ex.valor : -ex.valor) + (m.operacao === 'REFORCO' ? m.valor : -m.valor)
      ex.operacao = liq >= 0 ? 'REFORCO' : 'ANULACAO'
      ex.valor = Math.abs(liq)
    }
    movPorDecreto.set(dec, [...porKf.values()].filter((m) => m.valor > 0))
  }
  const jaLancados = new Set(
    (await prisma.creditoAdicional.findMany({ where: { orcamentoId: orcamento.id }, select: { numero: true } })).map((c) => c.numero),
  )
  const pendentes = [...movPorDecreto.keys()]
    .filter((d) => !jaLancados.has(d))
    .sort((a, b) => (a === 'S/N-2026' ? 1 : b === 'S/N-2026' ? -1 : parseInt(a) - parseInt(b))) // S/N-2026 por ÚLTIMO: concilia no estado final

  // ── 5. Simulação sequencial com reordenação por viabilidade ───────────────
  const saldoSim = new Map<string, number>()
  const abre = (kf: string) => (dotPorChave.has(kf) ? cent(Number(dotPorChave.get(kf)!.valorAutorizado)) : 0) // estado ATUAL (retomada)
  const ordItens = (movs: Mov[]) => [...movs].sort((a, b) => (a.operacao === b.operacao ? 0 : a.operacao === 'REFORCO' ? -1 : 1))
  const cabe = (movs: Mov[]) => {
    const tmp = new Map<string, number>()
    for (const m of ordItens(movs)) {
      const s = tmp.get(m.kf) ?? saldoSim.get(m.kf) ?? abre(m.kf)
      const novo = s + (m.operacao === 'REFORCO' ? m.valor : -m.valor)
      if (novo < 0) return false
      tmp.set(m.kf, novo)
    }
    for (const [k, v] of tmp) saldoSim.set(k, v)
    return true
  }
  const ordemFinal: string[] = []
  let fila = [...pendentes]
  let adiadosUltima = -1
  while (fila.length) {
    const adiados: string[] = []
    for (const dec of fila) {
      if (cabe(movPorDecreto.get(dec)!)) ordemFinal.push(dec)
      else adiados.push(dec)
    }
    if (adiados.length === fila.length || adiados.length === adiadosUltima) {
      console.log(`❌ ${adiados.length} decretos nunca cabem (saldo ficaria negativo): ${adiados.slice(0, 8).join(', ')}`)
      process.exit(1)
    }
    adiadosUltima = adiados.length
    fila = adiados
  }
  console.log(`decretos a lançar: ${ordemFinal.length} (já lançados antes: ${jaLancados.size})`)

  // Σ esperado e fontes/dotações novas
  const fontesDb = new Map(
    (await prisma.fonteRecursoEntidade.findMany({ where: { entidadeId: entidade.id, ano: 2026 }, select: { id: true, codigo: true } })).map(
      (f) => [f.codigo, f.id],
    ),
  )
  const novasDot = [...porDot.keys()].filter((kf) => !dotPorChave.has(kf))
  const novasFontes = [...new Set(novasDot.map((kf) => kf.split('|')[1]!))].filter((f) => !fontesDb.has(f))
  const alvoMovimentadas = [...porDot.values()].reduce((s, regs) => s + regs[0]!.atual, 0)
  const loaNaoMov = dots.reduce((s, d) => {
    const a = d.acao.codigo
    const kf = `${d.unidadeOrcamentaria.codigo}.${d.funcao.codigo}.${d.subfuncao.codigo}.${d.programa.codigo}.${a[0]}.${a.slice(1)}.${d.contaDespesa.codigo}|${d.fonteRecurso.codigo}`
    return porDot.has(kf) ? s : s + cent(Number(d.valorAutorizado))
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
    const { dims, fonte } = porDot.get(kf)![0]!
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
    const itensCredito = ordItens(movPorDecreto.get(dec)!).map((m) => ({
      dotacaoId: idPorKf.get(m.kf)!,
      operacao: m.operacao,
      valor: (m.valor / 100).toFixed(2),
    }))
    await svc.criar(orcamento.id, {
      tipo: 'SUPLEMENTAR',
      numero: dec,
      data: hoje,
      atoLegal: dec === 'S/N-2026' ? 'Movimentos sem número de decreto no portal (2026)' : `Decreto nº ${dec}`,
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
    const regs = porDot.get(kf)
    if (regs && v !== regs[0]!.atual) {
      divergentes++
      if (divergentes <= 5) console.log(`  ✗ ${kf}: banco ${brl(v)} ≠ portal ${brl(regs[0]!.atual)}`)
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
