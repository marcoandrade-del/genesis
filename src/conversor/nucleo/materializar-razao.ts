import type { PrismaClient, TipoMovimentoEmpenho } from '@prisma/client'
import { MotorEventosReceita, type LancamentoEvento } from '../../services/motor-eventos-receita.js'
import { MotorEventosDespesa, isoData } from '../../services/motor-eventos-despesa.js'
import { LancamentosService } from '../../services/lancamentos.js'
import { OrcamentosService } from '../../services/orcamentos.js'
import { AberturaContabilService } from '../../services/abertura-contabil.js'

/**
 * Materializa o RAZÃO contábil (partida dobrada) da execução JÁ capturada de uma
 * entidade — o passo que faltava para os memoriais (balancete/MSC/RCL/arrecadação
 * por conta) entregarem. Faz o *replay* de `Arrecadacao` + `MovimentoEmpenho` pela
 * Tabela de Eventos do modelo do estado (nunca chute) e contabiliza a ABERTURA da
 * LOA (fixação), sem a qual o crédito disponível 6.2.2.1.1 fica invertido.
 *
 * SEMPRE limpa antes de recriar (o import deleta+recria Arrecadacao/empenho com IDs
 * novos → a idempotência por origemId não alcança os órfãos; sem limpar, dobraria).
 * Só toca os eventos ORÇAMENTÁRIO/CONTROLE (classes 5-8); o patrimonial (Dim II) é
 * outro ciclo. Espelha `scripts/backfill_contabil_execucao.ts` (a prova/dry-run).
 */
const EVENTO_DEDUCAO = { FUNDEB: '150', RENUNCIA: '151', OUTRAS: '152' } as const
const ORIGENS_EXECUCAO = ['ARRECADACAO', 'EMPENHO', 'LIQUIDACAO', 'PAGAMENTO'] as const

function ehPatrimonial(codigo: string): boolean {
  const c = codigo.charAt(0)
  return c === '1' || c === '2' || c === '3' || c === '4'
}
/** Mantém só os eventos ORÇAMENTÁRIO/CONTROLE (contas classe 5-8), pela CONTA. */
function soOrcamentarias(eventos: LancamentoEvento[], codigoPorId: Map<string, string>): LancamentoEvento[] {
  return eventos.filter((ev) => !ev.itens.some((it) => ehPatrimonial(codigoPorId.get(it.contaId) ?? '')))
}
function mapaEstagio(t: TipoMovimentoEmpenho): { gatilho: 'EMPENHO' | 'LIQUIDACAO' | 'PAGAMENTO'; estorno: boolean } {
  switch (t) {
    case 'EMPENHO': return { gatilho: 'EMPENHO', estorno: false }
    case 'ESTORNO_EMPENHO': return { gatilho: 'EMPENHO', estorno: true }
    case 'LIQUIDACAO': return { gatilho: 'LIQUIDACAO', estorno: false }
    case 'ESTORNO_LIQUIDACAO': return { gatilho: 'LIQUIDACAO', estorno: true }
    case 'PAGAMENTO': return { gatilho: 'PAGAMENTO', estorno: false }
    case 'ESTORNO_PAGAMENTO': return { gatilho: 'PAGAMENTO', estorno: true }
  }
}

/** Publica a LOA (RASCUNHO→…→PUBLICADO) e contabiliza a abertura. Idempotente. */
async function contabilizarAbertura(prisma: PrismaClient, entidadeId: string, ano: number, usuarioId: string): Promise<void> {
  const orc = await prisma.orcamento.findUnique({ where: { entidadeId_ano: { entidadeId, ano } }, select: { id: true, status: true } })
  if (!orc || orc.status === 'EM_EXECUCAO') return
  const orcs = new OrcamentosService(prisma)
  const caminho = ['ENVIADO_AO_LEGISLATIVO', 'APROVADO', 'PUBLICADO'] as const
  const idx = (caminho as ReadonlyArray<string>).indexOf(orc.status)
  for (const alvo of idx === -1 ? caminho : caminho.slice(idx + 1)) {
    await orcs.alterarStatus(orc.id, alvo, usuarioId, 'Publicação p/ abertura contábil (conversor)')
  }
  await new AberturaContabilService(prisma).contabilizar(entidadeId, ano, usuarioId)
}

/** Contexto compartilhado do replay (motores + writer + mapa de contas). */
type CtxReplay = {
  prisma: PrismaClient
  entidadeId: string
  ano: number
  motorReceita: MotorEventosReceita
  motorDespesa: MotorEventosDespesa
  lancamentos: LancamentosService
  codigoPorId: Map<string, string>
}

async function ctxReplay(prisma: PrismaClient, entidadeId: string, ano: number): Promise<CtxReplay> {
  return {
    prisma,
    entidadeId,
    ano,
    motorReceita: new MotorEventosReceita(prisma),
    motorDespesa: new MotorEventosDespesa(prisma),
    lancamentos: new LancamentosService(prisma),
    codigoPorId: new Map(
      (await prisma.contaContabilEntidade.findMany({ where: { entidadeId, ano }, select: { id: true, codigo: true } })).map((c) => [c.id, c.codigo]),
    ),
  }
}

type ArrecadacaoReplay = { id: string; tipo: string; deducaoTipo: string | null; valor: unknown; data: Date; previsao: { contaReceita: { codigo: string }; fonteRecurso: { codigo: string; vinculada: boolean } } }
type MovimentoReplay = { id: string; tipo: TipoMovimentoEmpenho; valor: unknown; data: Date; empenho: { dotacaoDespesaId: string; dotacaoDespesa: { contaDespesa: { codigo: string } } } }

const SELECT_ARRECADACAO = { id: true, tipo: true, deducaoTipo: true, valor: true, data: true, previsao: { select: { contaReceita: { select: { codigo: true } }, fonteRecurso: { select: { codigo: true, vinculada: true } } } } } as const
const SELECT_MOVIMENTO = { id: true, tipo: true, valor: true, data: true, empenho: { select: { dotacaoDespesaId: true, dotacaoDespesa: { select: { contaDespesa: { select: { codigo: true } } } } } } } as const

async function replayArrecadacoes(c: CtxReplay, arrecadacoes: ArrecadacaoReplay[]): Promise<void> {
  for (const a of arrecadacoes) {
    await c.prisma.$transaction(async (tx) => {
      const ctx = { entidadeId: c.entidadeId, ano: c.ano, naturezaCodigo: a.previsao.contaReceita.codigo, fonteCodigo: a.previsao.fonteRecurso.codigo, fonteVinculada: a.previsao.fonteRecurso.vinculada, valor: a.valor as never }
      const eventos = soOrcamentarias(
        a.tipo === 'DEDUCAO'
          ? await c.motorReceita.resolverDeducao(ctx, EVENTO_DEDUCAO[(a.deducaoTipo ?? 'FUNDEB') as keyof typeof EVENTO_DEDUCAO], {}, tx)
          : await c.motorReceita.resolver(ctx, { estorno: a.tipo === 'ESTORNO' }, tx),
        c.codigoPorId,
      )
      for (const ev of eventos) {
        await c.lancamentos.criar({ entidadeId: c.entidadeId, data: isoData(a.data), historico: `${ev.descricaoEvento} — materialização`, itens: ev.itens, criadoPorId: 'CONVERSOR', origemTipo: 'ARRECADACAO', origemId: a.id, eventoCodigo: ev.eventoCodigo }, tx)
      }
    })
  }
}

async function replayMovimentos(c: CtxReplay, movimentos: MovimentoReplay[]): Promise<void> {
  for (const m of movimentos) {
    const { gatilho, estorno } = mapaEstagio(m.tipo)
    await c.prisma.$transaction(async (tx) => {
      const ctx = { entidadeId: c.entidadeId, ano: c.ano, dotacaoDespesaId: m.empenho.dotacaoDespesaId, naturezaCodigo: m.empenho.dotacaoDespesa.contaDespesa.codigo, valor: m.valor as never }
      const evs =
        gatilho === 'EMPENHO' ? await c.motorDespesa.resolverEmpenho(ctx, { estorno }, tx)
        : gatilho === 'LIQUIDACAO' ? await c.motorDespesa.resolverLiquidacao(ctx, { estorno }, tx)
        : await c.motorDespesa.resolverPagamento(ctx, { estorno }, tx)
      const origemTipo = gatilho === 'EMPENHO' ? 'EMPENHO' : gatilho === 'LIQUIDACAO' ? 'LIQUIDACAO' : 'PAGAMENTO'
      for (const ev of soOrcamentarias(evs, c.codigoPorId)) {
        await c.lancamentos.criar({ entidadeId: c.entidadeId, data: isoData(m.data), historico: `${ev.descricaoEvento} — materialização`, itens: ev.itens, criadoPorId: 'CONVERSOR', origemTipo, origemId: m.id, eventoCodigo: ev.eventoCodigo }, tx)
      }
    })
  }
}

export async function materializarRazao(
  prisma: PrismaClient,
  entidadeId: string,
  ano: number,
  usuarioId: string,
): Promise<{ arrecadacoes: number; movimentos: number }> {
  const c = await ctxReplay(prisma, entidadeId, ano)

  await contabilizarAbertura(prisma, entidadeId, ano, usuarioId)

  // limpa a execução anterior (reverte ResumoMensalConta) — anti-duplicação no re-import.
  for (const o of await prisma.lancamento.findMany({ where: { entidadeId, origemTipo: { in: [...ORIGENS_EXECUCAO] } }, select: { id: true } })) {
    await c.lancamentos.excluir(o.id)
  }

  const arrecadacoes = await prisma.arrecadacao.findMany({ where: { previsao: { orcamento: { entidadeId, ano } } }, select: SELECT_ARRECADACAO })
  await replayArrecadacoes(c, arrecadacoes)

  const movimentos = await prisma.movimentoEmpenho.findMany({
    where: { entidadeId, data: { gte: new Date(`${ano}-01-01`), lt: new Date(`${ano + 1}-01-01`) } },
    select: SELECT_MOVIMENTO,
  })
  await replayMovimentos(c, movimentos)
  return { arrecadacoes: arrecadacoes.length, movimentos: movimentos.length }
}

/**
 * Versão INCREMENTAL: mantém o razão em dia com o orçamentário SEM regenerar tudo
 * — pensada para o pós-sync (o sync do portal deleta+recria Arrecadacao/
 * MovimentoEmpenho por mês, churnando IDs):
 *  1. EXCLUI os lançamentos de execução ÓRFÃOS (origemId que não existe mais —
 *     linhas antigas do mês re-sincronizado) — senão o razão infla.
 *  2. REPLAY só das origens SEM lançamento (linhas novas do sync).
 * Barato (toca só o delta) e idempotente. Não mexe em quem está em dia.
 */
export async function materializarRazaoIncremental(
  prisma: PrismaClient,
  entidadeId: string,
  ano: number,
  usuarioId: string,
): Promise<{ orfaosExcluidos: number; arrecadacoes: number; movimentos: number }> {
  const c = await ctxReplay(prisma, entidadeId, ano)
  await contabilizarAbertura(prisma, entidadeId, ano, usuarioId)

  const arrIds = new Set((await prisma.arrecadacao.findMany({ where: { previsao: { orcamento: { entidadeId, ano } } }, select: { id: true } })).map((a) => a.id))
  const movIds = new Set((await prisma.movimentoEmpenho.findMany({ where: { entidadeId }, select: { id: true } })).map((m) => m.id))
  const lancs = await prisma.lancamento.findMany({ where: { entidadeId, origemTipo: { in: [...ORIGENS_EXECUCAO] } }, select: { id: true, origemTipo: true, origemId: true } })

  // 1. órfãos: o origemId sumiu (churn do sync) → excluir (reverte ResumoMensalConta)
  let orfaos = 0
  const lancadosA = new Set<string>()
  const lancadosM = new Set<string>()
  for (const l of lancs) {
    const vivo = l.origemTipo === 'ARRECADACAO' ? arrIds.has(l.origemId ?? '') : movIds.has(l.origemId ?? '')
    if (!vivo) {
      await c.lancamentos.excluir(l.id)
      orfaos++
    } else if (l.origemTipo === 'ARRECADACAO') lancadosA.add(l.origemId!)
    else lancadosM.add(l.origemId!)
  }

  // 2. faltantes: origem viva sem lançamento → replay
  const arrsNovas = await prisma.arrecadacao.findMany({ where: { previsao: { orcamento: { entidadeId, ano } }, id: { notIn: [...lancadosA] } }, select: SELECT_ARRECADACAO })
  await replayArrecadacoes(c, arrsNovas)
  const movsNovos = await prisma.movimentoEmpenho.findMany({
    where: { entidadeId, data: { gte: new Date(`${ano}-01-01`), lt: new Date(`${ano + 1}-01-01`) }, id: { notIn: [...lancadosM] } },
    select: SELECT_MOVIMENTO,
  })
  await replayMovimentos(c, movsNovos)

  return { orfaosExcluidos: orfaos, arrecadacoes: arrsNovas.length, movimentos: movsNovos.length }
}
