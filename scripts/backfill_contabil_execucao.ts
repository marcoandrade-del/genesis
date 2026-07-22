/**
 * Backfill CONTÁBIL da EXECUÇÃO (razão único) — Etapa 3 do ICF (Dimensão IV).
 *
 * Por que existe: a captura do portal grava a execução DIRETO no orçamentário
 * (`Arrecadacao` / `MovimentoEmpenho` + materializações), PULANDO o motor de
 * eventos que gera os lançamentos contábeis (partida dobrada). Sem lançamentos, a
 * MSC não carrega a execução e a Dim IV (cruzamentos MSC↔RREO↔RGF↔DCA) não pode
 * ser exercitada. Este script faz o *replay* da execução já capturada pelo motor
 * (Tabela de Eventos do modelo do estado) para popular o razão — como a MSC sai do
 * MESMO razão que gera RREO/RGF, os cruzamentos fecham por construção.
 *
 * DRY-RUN (padrão): resolve cada Arrecadacao + MovimentoEmpenho pelo motor e
 * AGREGA em memória — NÃO grava nada. Prova (a) o motor roda limpo sobre 100% da
 * execução e (b) os movimentos orçamentários reconciliam com os totais capturados
 * (que são a MESMA origem do RREO/RGF).
 *
 * A resolução do motor depende só de (natureza, fonte, estorno) na receita e de
 * (dotação, estágio, estorno) na despesa — NUNCA do valor. Então o dry-run resolve
 * um TEMPLATE por chave distinta (poucas centenas de chamadas em vez de ~23 mil) e
 * escala pelo valor de cada linha: fiel (exercita a resolução de toda dotação/
 * natureza em uso) e rápido.
 *
 * --apply (GATED): persiste via LancamentosService, idempotente por
 *   origemTipo+origemId. NÃO rodar sem OK do Marco — muta o dev COMPARTILHADO.
 *
 * Rodar (do dir do projeto):
 *   npx tsx scripts/backfill_contabil_execucao.ts             # dry-run (não grava)
 *   npx tsx scripts/backfill_contabil_execucao.ts --apply     # grava (gated)
 *   flags: --ano=2026
 */
import 'dotenv/config'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient, Prisma, type TipoMovimentoEmpenho } from '@prisma/client'
import { MotorEventosReceita, CONTAS_EVENTO, type LancamentoEvento } from '../src/services/motor-eventos-receita.js'
import { MotorEventosDespesa, CONTAS_DESPESA, isoData } from '../src/services/motor-eventos-despesa.js'
import { LancamentosService, type TipoLancamento } from '../src/services/lancamentos.js'

const APPLY = process.argv.includes('--apply')
// --limpar: apaga os lançamentos de execução da entidade (via excluir, revertendo
// ResumoMensalConta) ANTES de recriar. Necessário quando o município foi
// RE-IMPORTADO (o conversor deleta+recria Arrecadacao/empenho com IDs NOVOS, então
// a idempotência por origemId não alcança os lançamentos órfãos → dobraria).
const LIMPAR = process.argv.includes('--limpar')
// --sem-prefeitura: pula entidades tipo PREFEITURA (ex.: Maringá, cujo razão da
// Prefeitura já existe #236 e não deve ser mexido — só as demais entidades).
const SEM_PREFEITURA = process.argv.includes('--sem-prefeitura')
// evento de dedução por tipo (espelha ArrecadacoesService): 150 FUNDEB · 151 renúncia · 152 outras.
const EVENTO_DEDUCAO = { FUNDEB: '150', RENUNCIA: '151', OUTRAS: '152' } as const
const anoArg = process.argv.find((a) => a.startsWith('--ano='))
const ANO = anoArg ? Number(anoArg.split('=')[1]) : 2026
const CRIADO_POR = 'BACKFILL_EXEC' // marcador (Lancamento.criadoPorId é String livre, sem FK)

const pool = new Pool({ connectionString: process.env['DATABASE_URL'] })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })
const motorReceita = new MotorEventosReceita(prisma)
const motorDespesa = new MotorEventosDespesa(prisma)
const lancamentos = new LancamentosService(prisma)

const ZERO = new Prisma.Decimal(0)
const dec = (v: Prisma.Decimal | string | number) => new Prisma.Decimal(v)

/** R$ 1.234.567,89 (com sinal). */
function brl(d: Prisma.Decimal): string {
  const neg = d.isNegative()
  const [int = '0', frac = '00'] = d.abs().toFixed(2).split('.')
  const comPontos = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `${neg ? '-' : ''}${comPontos},${frac}`
}
const pad = (s: string, n: number) => s.padStart(n)

// ---------------------------------------------------------------------------
// Agregação: um "bucket" por estágio (receita/empenho/liquidação/pagamento),
// somando o valor de cada linha nas contas D/C do template do motor.
// ---------------------------------------------------------------------------
type Bucket = Map<string, Prisma.Decimal> // `${codigo}|${DEBITO|CREDITO}` -> soma
type Template = { entries: Array<{ codigo: string; tipo: TipoLancamento }> } | { erro: string }

function somar(bucket: Bucket, tpl: { entries: Array<{ codigo: string; tipo: TipoLancamento }> }, valor: Prisma.Decimal) {
  for (const e of tpl.entries) {
    const k = `${e.codigo}|${e.tipo}`
    bucket.set(k, (bucket.get(k) ?? ZERO).plus(valor))
  }
}
const mov = (b: Bucket, codigo: string, tipo: TipoLancamento) => b.get(`${codigo}|${tipo}`) ?? ZERO

/** Cobertura por estágio: linhas resolvidas × bloqueadas (com motivos agrupados). */
type Cobertura = { linhas: number; resolvidas: number; bloqueadas: number; motivos: Map<string, { n: number; soma: Prisma.Decimal }> }
const novaCobertura = (): Cobertura => ({ linhas: 0, resolvidas: 0, bloqueadas: 0, motivos: new Map() })
function registrarBloqueio(cob: Cobertura, msg: string, valor: Prisma.Decimal) {
  cob.bloqueadas++
  const m = cob.motivos.get(msg) ?? { n: 0, soma: ZERO }
  m.n++
  m.soma = m.soma.plus(valor)
  cob.motivos.set(msg, m)
}
const msgErro = (e: unknown) => (e instanceof Error ? e.message : String(e))

function templateDeEventos(eventos: LancamentoEvento[], codigoPorId: Map<string, string>): Template {
  return {
    entries: eventos.flatMap((ev) => ev.itens.map((it) => ({ codigo: codigoPorId.get(it.contaId) ?? it.contaId, tipo: it.tipo }))),
  }
}

/**
 * Mantém só os eventos ORÇAMENTÁRIO/CONTROLE (contas de classe 5-8). O patrimonial
 * (classes 1-4) é da Dim II — depende do ciclo de competência completo (de/para +
 * constituição), fora do escopo deste backfill (Dim IV). Incluí-lo plantaria baixas
 * sem constituição (ex.: E560 credita um crédito a receber nunca lançado → recebível
 * negativo). Classifica pela CONTA (robusto), não por código de evento.
 */
function soOrcamentarias(eventos: LancamentoEvento[], codigoPorId: Map<string, string>): LancamentoEvento[] {
  const ehPatrimonial = (contaId: string) => {
    const c = (codigoPorId.get(contaId) ?? '').charAt(0)
    return c === '1' || c === '2' || c === '3' || c === '4'
  }
  return eventos.filter((ev) => !ev.itens.some((it) => ehPatrimonial(it.contaId)))
}

async function processar(entidade: { id: string; nome: string; municipio: { nome: string } | null }) {
  console.log(`\n${'═'.repeat(78)}\nEntidade: ${entidade.nome} (${entidade.municipio?.nome}) — ${entidade.id}\n`)

  // contaId -> código (uma query; usado para nomear as contas do template).
  const contas = await prisma.contaContabilEntidade.findMany({
    where: { entidadeId: entidade.id, ano: ANO },
    select: { id: true, codigo: true },
  })
  const codigoPorId = new Map(contas.map((c) => [c.id, c.codigo]))

  const bReceita: Bucket = new Map()
  const bEmpenho: Bucket = new Map()
  const bLiquidacao: Bucket = new Map()
  const bPagamento: Bucket = new Map()
  const cobReceita = novaCobertura()
  const cobDespesa = novaCobertura()
  // Totais capturados (net = normal − estorno) direto das linhas de origem.
  let capReceita = ZERO
  let capEmpenho = ZERO
  let capLiquidacao = ZERO
  let capPagamento = ZERO

  const templates = new Map<string, Template>()

  // ---------------------- RECEITA ----------------------
  const arrecadacoes = await carregarArrecadacoes(entidade.id)
  console.log(`Arrecadações: ${arrecadacoes.length}`)
  for (const a of arrecadacoes) {
    cobReceita.linhas++
    const valor = dec(a.valor)
    const estorno = a.tipo === 'ESTORNO'
    const deducao = a.tipo === 'DEDUCAO'
    // estorno e dedução REDUZEM a realizada líquida capturada.
    capReceita = estorno || deducao ? capReceita.minus(valor) : capReceita.plus(valor)
    const natureza = a.previsao.contaReceita.codigo
    const fonte = a.previsao.fonteRecurso.codigo
    const vinculada = a.previsao.fonteRecurso.vinculada
    const dedTipo = (a.deducaoTipo ?? 'FUNDEB') as keyof typeof EVENTO_DEDUCAO
    const chave = `R|${natureza}|${fonte}|${vinculada ? 1 : 0}|${a.tipo}|${deducao ? dedTipo : ''}`
    let tpl = templates.get(chave)
    if (!tpl) {
      try {
        const ctx = { entidadeId: entidade.id, ano: ANO, naturezaCodigo: natureza, fonteCodigo: fonte, fonteVinculada: vinculada, valor: 1 }
        const eventos = deducao ? await motorReceita.resolverDeducao(ctx, EVENTO_DEDUCAO[dedTipo]) : await motorReceita.resolver(ctx, { estorno })
        tpl = templateDeEventos(soOrcamentarias(eventos, codigoPorId), codigoPorId)
      } catch (e) {
        tpl = { erro: msgErro(e) }
      }
      templates.set(chave, tpl)
    }
    if ('erro' in tpl) registrarBloqueio(cobReceita, tpl.erro, valor)
    else {
      cobReceita.resolvidas++
      somar(bReceita, tpl, valor)
    }
  }

  // ---------------------- DESPESA ----------------------
  const movimentos = await carregarMovimentos(entidade.id)
  console.log(`Movimentos de empenho: ${movimentos.length}\n`)
  for (const m of movimentos) {
    cobDespesa.linhas++
    const valor = dec(m.valor)
    const { gatilho, estorno, bucket } = mapaEstagio(m.tipo)
    if (bucket === 'empenho') capEmpenho = estorno ? capEmpenho.minus(valor) : capEmpenho.plus(valor)
    else if (bucket === 'liquidacao') capLiquidacao = estorno ? capLiquidacao.minus(valor) : capLiquidacao.plus(valor)
    else capPagamento = estorno ? capPagamento.minus(valor) : capPagamento.plus(valor)

    const dotacaoId = m.empenho.dotacaoDespesaId
    const natureza = m.empenho.dotacaoDespesa.contaDespesa.codigo
    const chave = `D|${dotacaoId}|${gatilho}|${estorno ? 'E' : 'N'}`
    let tpl = templates.get(chave)
    if (!tpl) {
      try {
        const ctx = { entidadeId: entidade.id, ano: ANO, dotacaoDespesaId: dotacaoId, naturezaCodigo: natureza, valor: 1 }
        const eventos =
          gatilho === 'EMPENHO' ? await motorDespesa.resolverEmpenho(ctx, { estorno })
          : gatilho === 'LIQUIDACAO' ? await motorDespesa.resolverLiquidacao(ctx, { estorno })
          : await motorDespesa.resolverPagamento(ctx, { estorno })
        tpl = templateDeEventos(soOrcamentarias(eventos, codigoPorId), codigoPorId)
      } catch (e) {
        tpl = { erro: msgErro(e) }
      }
      templates.set(chave, tpl)
    }
    const alvo = bucket === 'empenho' ? bEmpenho : bucket === 'liquidacao' ? bLiquidacao : bPagamento
    if ('erro' in tpl) registrarBloqueio(cobDespesa, tpl.erro, valor)
    else {
      cobDespesa.resolvidas++
      somar(alvo, tpl, valor)
    }
  }

  if (APPLY) {
    await aplicar(entidade.id, arrecadacoes, movimentos, codigoPorId)
    return
  }

  relatorio({ bReceita, bEmpenho, bLiquidacao, bPagamento, cobReceita, cobDespesa, capReceita, capEmpenho, capLiquidacao, capPagamento, templates })
}

async function main() {
  console.log(`\nBackfill contábil da execução — modo: ${APPLY ? 'APPLY (VAI GRAVAR)' : 'DRY-RUN (não grava)'} · ano ${ANO}`)
  // Seleção de entidades: --municipio=<nome> processa TODAS as entidades do
  // município (turn-key); sem flag = Prefeitura de Maringá (compat. #236).
  const munArg = process.argv.find((a) => a.startsWith('--municipio='))?.split('=')[1]
  let entidades: { id: string; nome: string; municipio: { nome: string } | null }[]
  if (munArg) {
    entidades = await prisma.entidade.findMany({
      where: { municipio: { nome: munArg }, ...(SEM_PREFEITURA ? { tipo: { not: 'PREFEITURA' } } : {}) },
      select: { id: true, nome: true, municipio: { select: { nome: true } } },
      orderBy: { nome: 'asc' },
    })
    if (!entidades.length) throw new Error(`Nenhuma entidade no município '${munArg}'`)
  } else {
    const e = await prisma.entidade.findFirst({
      where: { tipo: 'PREFEITURA', municipio: { nome: { contains: 'Maring' } } },
      select: { id: true, nome: true, municipio: { select: { nome: true } } },
    })
    if (!e) throw new Error('Prefeitura de Maringá não encontrada')
    entidades = [e]
  }
  console.log(`Entidades a processar: ${entidades.length}`)
  for (const entidade of entidades) await processar(entidade)
}

function mapaEstagio(t: TipoMovimentoEmpenho): { gatilho: 'EMPENHO' | 'LIQUIDACAO' | 'PAGAMENTO'; estorno: boolean; bucket: 'empenho' | 'liquidacao' | 'pagamento' } {
  switch (t) {
    case 'EMPENHO': return { gatilho: 'EMPENHO', estorno: false, bucket: 'empenho' }
    case 'ESTORNO_EMPENHO': return { gatilho: 'EMPENHO', estorno: true, bucket: 'empenho' }
    case 'LIQUIDACAO': return { gatilho: 'LIQUIDACAO', estorno: false, bucket: 'liquidacao' }
    case 'ESTORNO_LIQUIDACAO': return { gatilho: 'LIQUIDACAO', estorno: true, bucket: 'liquidacao' }
    case 'PAGAMENTO': return { gatilho: 'PAGAMENTO', estorno: false, bucket: 'pagamento' }
    case 'ESTORNO_PAGAMENTO': return { gatilho: 'PAGAMENTO', estorno: true, bucket: 'pagamento' }
  }
}

// ---------------------------------------------------------------------------
// Relatório do dry-run
// ---------------------------------------------------------------------------
function relatorio(x: {
  bReceita: Bucket; bEmpenho: Bucket; bLiquidacao: Bucket; bPagamento: Bucket
  cobReceita: Cobertura; cobDespesa: Cobertura
  capReceita: Prisma.Decimal; capEmpenho: Prisma.Decimal; capLiquidacao: Prisma.Decimal; capPagamento: Prisma.Decimal
  templates: Map<string, Template>
}) {
  const linha = '─'.repeat(78)

  // 1) Cobertura
  console.log(linha)
  console.log('1) COBERTURA (o motor resolve cada linha da execução?)')
  console.log(linha)
  for (const [nome, cob] of [['Receita', x.cobReceita], ['Despesa', x.cobDespesa]] as const) {
    const pct = cob.linhas ? ((cob.resolvidas / cob.linhas) * 100).toFixed(2) : '0'
    console.log(`  ${nome}: ${cob.resolvidas}/${cob.linhas} resolvidas (${pct}%) · ${cob.bloqueadas} bloqueadas`)
    for (const [msg, m] of cob.motivos) console.log(`     ✗ ${m.n}× (Σ ${brl(m.soma)}): ${msg}`)
  }
  const chavesResolvidas = [...x.templates.values()].filter((t) => !('erro' in t)).length
  const chavesBloqueadas = [...x.templates.values()].filter((t) => 'erro' in t).length
  console.log(`  Chaves distintas de resolução: ${chavesResolvidas} ok · ${chavesBloqueadas} bloqueadas`)

  // 2) Partida dobrada (Σ débitos = Σ créditos em cada estágio e no total)
  console.log(`\n${linha}`)
  console.log('2) PARTIDA DOBRADA (Σ débito = Σ crédito)')
  console.log(linha)
  let totD = ZERO
  let totC = ZERO
  for (const [nome, b] of [['Receita', x.bReceita], ['Empenho', x.bEmpenho], ['Liquidação', x.bLiquidacao], ['Pagamento', x.bPagamento]] as const) {
    let d = ZERO
    let c = ZERO
    for (const [k, v] of b) (k.endsWith('|DEBITO') ? (d = d.plus(v)) : (c = c.plus(v)))
    totD = totD.plus(d)
    totC = totC.plus(c)
    const ok = d.minus(c).abs().lessThanOrEqualTo(dec('0.01')) ? 'OK' : 'DIVERGENTE'
    console.log(`  ${nome.padEnd(11)} D ${pad(brl(d), 20)}  C ${pad(brl(c), 20)}  Δ ${pad(brl(d.minus(c)), 8)}  ${ok}`)
  }
  console.log(`  ${'TOTAL'.padEnd(11)} D ${pad(brl(totD), 20)}  C ${pad(brl(totC), 20)}  Δ ${pad(brl(totD.minus(totC)), 8)}`)

  // 3) Reconciliação orçamentária: movimento nas contas de execução × capturado
  console.log(`\n${linha}`)
  console.log('3) RECONCILIAÇÃO ORÇAMENTÁRIA (motor × execução capturada = origem do RREO/RGF)')
  console.log(linha)
  // 6.2.1.2 (receita realizada) é CREDORA — o E100 a CREDITA na arrecadação (fix de
  // sinal #250). Logo o saldo do razão = CRÉDITO − DÉBITO (igual às contas de despesa).
  const receitaReal = mov(x.bReceita, CONTAS_EVENTO.receitaRealizada, 'CREDITO').minus(mov(x.bReceita, CONTAS_EVENTO.receitaRealizada, 'DEBITO'))
  const empenhado = mov(x.bEmpenho, CONTAS_DESPESA.empenhadoALiquidar, 'CREDITO').minus(mov(x.bEmpenho, CONTAS_DESPESA.empenhadoALiquidar, 'DEBITO'))
  const liquidado = mov(x.bLiquidacao, CONTAS_DESPESA.liquidadoAPagar, 'CREDITO').minus(mov(x.bLiquidacao, CONTAS_DESPESA.liquidadoAPagar, 'DEBITO'))
  const pago = mov(x.bPagamento, CONTAS_DESPESA.pago, 'CREDITO').minus(mov(x.bPagamento, CONTAS_DESPESA.pago, 'DEBITO'))
  console.log(`  ${'linha'.padEnd(24)} ${pad('MOTOR (razão)', 20)} ${pad('CAPTURADO', 20)} ${pad('Δ', 10)}`)
  const recon = (nome: string, conta: string, motorV: Prisma.Decimal, cap: Prisma.Decimal) => {
    const delta = motorV.minus(cap)
    const marca = delta.abs().lessThanOrEqualTo(dec('0.01')) ? '✓' : '✗'
    console.log(`  ${nome.padEnd(24)} ${pad(brl(motorV), 20)} ${pad(brl(cap), 20)} ${pad(brl(delta), 10)} ${marca}   [${conta}]`)
  }
  recon('Receita realizada', CONTAS_EVENTO.receitaRealizada, receitaReal, x.capReceita)
  recon('Despesa empenhada', CONTAS_DESPESA.empenhadoALiquidar, empenhado, x.capEmpenho)
  recon('Despesa liquidada', CONTAS_DESPESA.liquidadoAPagar, liquidado, x.capLiquidacao)
  recon('Despesa paga', CONTAS_DESPESA.pago, pago, x.capPagamento)
  console.log('\n  (Δ residual = valor das linhas bloqueadas; RREO/RGF derivam da MESMA execução capturada.)')

  console.log(`\n${linha}`)
  console.log('DRY-RUN — nada gravado. Para persistir o razão: --apply (muta o dev COMPARTILHADO; exige OK).')
  console.log(linha + '\n')
}

// ---------------------------------------------------------------------------
// --apply (GATED): persiste por linha, idempotente por origemTipo+origemId.
// ---------------------------------------------------------------------------
type ArrecadacaoRow = Awaited<ReturnType<typeof carregarArrecadacoes>>[number]
type MovimentoRow = Awaited<ReturnType<typeof carregarMovimentos>>[number]
function carregarArrecadacoes(entidadeId: string) {
  return prisma.arrecadacao.findMany({
    where: { previsao: { orcamento: { entidadeId, ano: ANO } } },
    select: { id: true, tipo: true, deducaoTipo: true, valor: true, data: true, previsao: { select: { contaReceita: { select: { codigo: true } }, fonteRecurso: { select: { codigo: true, vinculada: true } } } } },
  })
}
function carregarMovimentos(entidadeId: string) {
  return prisma.movimentoEmpenho.findMany({
    where: { entidadeId, data: { gte: new Date(`${ANO}-01-01`), lt: new Date(`${ANO + 1}-01-01`) } },
    select: { id: true, tipo: true, valor: true, data: true, empenho: { select: { dotacaoDespesaId: true, dotacaoDespesa: { select: { contaDespesa: { select: { codigo: true } } } } } } },
  })
}

async function aplicar(entidadeId: string, arrecadacoes: ArrecadacaoRow[], movimentos: MovimentoRow[], codigoPorId: Map<string, string>) {
  console.log('APPLY — persistindo o razão (idempotente por origemTipo+origemId)...\n')
  if (LIMPAR) {
    const olds = await prisma.lancamento.findMany({ where: { entidadeId, origemTipo: { in: ['ARRECADACAO', 'EMPENHO', 'LIQUIDACAO', 'PAGAMENTO'] } }, select: { id: true } })
    console.log(`  --limpar: removendo ${olds.length} lançamentos de execução (reverte ResumoMensalConta)...`)
    for (const o of olds) await lancamentos.excluir(o.id)
  }
  // Pré-carrega os pares origem já lançados (uma query) — evita um count por linha.
  const jaFeitos = new Set<string>()
  const existentes = await prisma.lancamento.findMany({
    where: { entidadeId, origemTipo: { in: ['ARRECADACAO', 'EMPENHO', 'LIQUIDACAO', 'PAGAMENTO'] } },
    select: { origemTipo: true, origemId: true },
  })
  for (const e of existentes) jaFeitos.add(`${e.origemTipo}|${e.origemId}`)

  let recCriados = 0
  let recPulados = 0
  for (const a of arrecadacoes) {
    if (jaFeitos.has(`ARRECADACAO|${a.id}`)) { recPulados++; continue }
    await prisma.$transaction(async (tx) => {
      const ctx = { entidadeId, ano: ANO, naturezaCodigo: a.previsao.contaReceita.codigo, fonteCodigo: a.previsao.fonteRecurso.codigo, fonteVinculada: a.previsao.fonteRecurso.vinculada, valor: a.valor }
      const eventos = soOrcamentarias(
        a.tipo === 'DEDUCAO'
          ? await motorReceita.resolverDeducao(ctx, EVENTO_DEDUCAO[(a.deducaoTipo ?? 'FUNDEB') as keyof typeof EVENTO_DEDUCAO], {}, tx)
          : await motorReceita.resolver(ctx, { estorno: a.tipo === 'ESTORNO' }, tx),
        codigoPorId,
      )
      for (const ev of eventos) {
        await lancamentos.criar({ entidadeId, data: isoData(a.data), historico: `${ev.descricaoEvento} — backfill execução`, itens: ev.itens, criadoPorId: CRIADO_POR, origemTipo: 'ARRECADACAO', origemId: a.id, eventoCodigo: ev.eventoCodigo }, tx)
      }
    })
    recCriados++
    if (recCriados % 500 === 0) console.log(`  receita: ${recCriados} lançados...`)
  }
  console.log(`  receita: ${recCriados} lançados, ${recPulados} já existentes.\n`)

  let despCriados = 0
  let despPulados = 0
  for (const m of movimentos) {
    const { gatilho, estorno } = mapaEstagio(m.tipo)
    const origemTipo = gatilho // EMPENHO | LIQUIDACAO | PAGAMENTO
    if (jaFeitos.has(`${origemTipo}|${m.id}`)) { despPulados++; continue }
    await prisma.$transaction(async (tx) => {
      const ctx = { entidadeId, ano: ANO, dotacaoDespesaId: m.empenho.dotacaoDespesaId, naturezaCodigo: m.empenho.dotacaoDespesa.contaDespesa.codigo, valor: m.valor }
      const eventos = soOrcamentarias(
        gatilho === 'EMPENHO' ? await motorDespesa.resolverEmpenho(ctx, { estorno }, tx)
        : gatilho === 'LIQUIDACAO' ? await motorDespesa.resolverLiquidacao(ctx, { estorno }, tx)
        : await motorDespesa.resolverPagamento(ctx, { estorno }, tx),
        codigoPorId,
      )
      for (const ev of eventos) {
        await lancamentos.criar({ entidadeId, data: isoData(m.data), historico: `${ev.descricaoEvento} — backfill execução`, itens: ev.itens, criadoPorId: CRIADO_POR, origemTipo, origemId: m.id, eventoCodigo: ev.eventoCodigo }, tx)
      }
    })
    despCriados++
    if (despCriados % 1000 === 0) console.log(`  despesa: ${despCriados} lançados...`)
  }
  console.log(`  despesa: ${despCriados} lançados, ${despPulados} já existentes.\n`)
  console.log('APPLY concluído. Reconfira MSC/RREO/RGF do ente e o validador Dim I.\n')
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => pool.end())
