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

export async function materializarRazao(
  prisma: PrismaClient,
  entidadeId: string,
  ano: number,
  usuarioId: string,
): Promise<{ arrecadacoes: number; movimentos: number }> {
  const motorReceita = new MotorEventosReceita(prisma)
  const motorDespesa = new MotorEventosDespesa(prisma)
  const lancamentos = new LancamentosService(prisma)
  const codigoPorId = new Map(
    (await prisma.contaContabilEntidade.findMany({ where: { entidadeId, ano }, select: { id: true, codigo: true } })).map((c) => [c.id, c.codigo]),
  )

  await contabilizarAbertura(prisma, entidadeId, ano, usuarioId)

  // limpa a execução anterior (reverte ResumoMensalConta) — anti-duplicação no re-import.
  for (const o of await prisma.lancamento.findMany({ where: { entidadeId, origemTipo: { in: [...ORIGENS_EXECUCAO] } }, select: { id: true } })) {
    await lancamentos.excluir(o.id)
  }

  const arrecadacoes = await prisma.arrecadacao.findMany({
    where: { previsao: { orcamento: { entidadeId, ano } } },
    select: { id: true, tipo: true, deducaoTipo: true, valor: true, data: true, previsao: { select: { contaReceita: { select: { codigo: true } }, fonteRecurso: { select: { codigo: true, vinculada: true } } } } },
  })
  for (const a of arrecadacoes) {
    await prisma.$transaction(async (tx) => {
      const ctx = { entidadeId, ano, naturezaCodigo: a.previsao.contaReceita.codigo, fonteCodigo: a.previsao.fonteRecurso.codigo, fonteVinculada: a.previsao.fonteRecurso.vinculada, valor: a.valor }
      const eventos = soOrcamentarias(
        a.tipo === 'DEDUCAO'
          ? await motorReceita.resolverDeducao(ctx, EVENTO_DEDUCAO[(a.deducaoTipo ?? 'FUNDEB') as keyof typeof EVENTO_DEDUCAO], {}, tx)
          : await motorReceita.resolver(ctx, { estorno: a.tipo === 'ESTORNO' }, tx),
        codigoPorId,
      )
      for (const ev of eventos) {
        await lancamentos.criar({ entidadeId, data: isoData(a.data), historico: `${ev.descricaoEvento} — materialização`, itens: ev.itens, criadoPorId: 'CONVERSOR', origemTipo: 'ARRECADACAO', origemId: a.id, eventoCodigo: ev.eventoCodigo }, tx)
      }
    })
  }

  const movimentos = await prisma.movimentoEmpenho.findMany({
    where: { entidadeId, data: { gte: new Date(`${ano}-01-01`), lt: new Date(`${ano + 1}-01-01`) } },
    select: { id: true, tipo: true, valor: true, data: true, empenho: { select: { dotacaoDespesaId: true, dotacaoDespesa: { select: { contaDespesa: { select: { codigo: true } } } } } } },
  })
  for (const m of movimentos) {
    const { gatilho, estorno } = mapaEstagio(m.tipo)
    await prisma.$transaction(async (tx) => {
      const ctx = { entidadeId, ano, dotacaoDespesaId: m.empenho.dotacaoDespesaId, naturezaCodigo: m.empenho.dotacaoDespesa.contaDespesa.codigo, valor: m.valor }
      const evs =
        gatilho === 'EMPENHO' ? await motorDespesa.resolverEmpenho(ctx, { estorno }, tx)
        : gatilho === 'LIQUIDACAO' ? await motorDespesa.resolverLiquidacao(ctx, { estorno }, tx)
        : await motorDespesa.resolverPagamento(ctx, { estorno }, tx)
      const origemTipo = gatilho === 'EMPENHO' ? 'EMPENHO' : gatilho === 'LIQUIDACAO' ? 'LIQUIDACAO' : 'PAGAMENTO'
      for (const ev of soOrcamentarias(evs, codigoPorId)) {
        await lancamentos.criar({ entidadeId, data: isoData(m.data), historico: `${ev.descricaoEvento} — materialização`, itens: ev.itens, criadoPorId: 'CONVERSOR', origemTipo, origemId: m.id, eventoCodigo: ev.eventoCodigo }, tx)
      }
    })
  }
  return { arrecadacoes: arrecadacoes.length, movimentos: movimentos.length }
}
