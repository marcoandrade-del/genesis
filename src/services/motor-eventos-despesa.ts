import { PrismaClient, Prisma, type OrigemLancamento } from '@prisma/client'
import { ErroNegocio } from '../errors.js'
import type { ItemDado, LancamentosService } from './lancamentos.js'
import { resolverParametroDespesa } from './parametros-despesa.js'

/**
 * Motor de Eventos da DESPESA (cut 1 = custeio): transforma cada estágio da
 * execução (empenho/liquidação/pagamento) em lançamentos contábeis automáticos
 * (partida dobrada), espelhando o MotorEventosReceita. Três aspectos por estágio:
 *
 *  - **Orçamentário** (classe 6.2.2.1): movimenta o crédito (Disponível →
 *    Empenhado a Liquidar → Liquidado a Pagar → Pago).
 *  - **Controle DDR** (classe 8.2.1.1): Disponível → Compr. Empenho → Compr.
 *    Liquidação → Utilizada.
 *  - **Patrimonial** (liquidação, fato gerador da VPD): D VPD (classe 3) / C
 *    Passivo a pagar (2.1.x) — via `ParametroDespesa` (de/para por natureza).
 *  - **Financeiro** (pagamento): D Passivo (2.1.x) / C Caixa (1.1.1.x da conta
 *    bancária) — baixa o passivo e sai o numerário.
 *
 * Conta-corrente = **dotação** (carrega a funcional-programática completa). O
 * estorno inverte cada par D↔C mantendo as contas.
 */

/** Folhas fixas do PCASP usadas pelos eventos da despesa (verificadas no plano). */
export const CONTAS_DESPESA = {
  creditoDisponivel: '6.2.2.1.1.00.00.00.00.00.00.00',
  empenhadoALiquidar: '6.2.2.1.3.01.00.00.00.00.00.00',
  liquidadoAPagar: '6.2.2.1.3.03.00.00.00.00.00.00',
  pago: '6.2.2.1.3.04.00.00.00.00.00.00',
  ddrDisponivel: '8.2.1.1.1.01.00.00.00.00.00.00',
  ddrComprEmpenho: '8.2.1.1.2.01.00.00.00.00.00.00',
  ddrComprLiquidacao: '8.2.1.1.3.01.00.00.00.00.00.00',
  ddrUtilizada: '8.2.1.1.4.01.00.00.00.00.00.00',
  /** Caixa de pagamento default (MVP; futuro: derivar da ContaBancaria como na receita). */
  caixaPagamento: '1.1.1.1.1.00.00.00.00.00.00.00',
} as const

export type ContextoDespesa = {
  entidadeId: string
  ano: number
  dotacaoDespesaId: string
  /** Código da natureza da despesa (ContaDespesaEntidade.codigo) — chave do de/para. */
  naturezaCodigo: string
  valor: Prisma.Decimal | string | number
  /** Folha de caixa a creditar no pagamento — vinda da ContaBancaria; default se ausente. */
  caixaCodigo?: string | null
}

export type LancamentoEvento = {
  eventoCodigo: string
  descricaoEvento: string
  itens: ItemDado[] // pares D-C balanceados
}

type Db = PrismaClient | Prisma.TransactionClient

/** Date (coluna @db.Date / DateTime) → 'YYYY-MM-DD' para o disparo contábil. */
export function isoData(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/**
 * Grava os lançamentos contábeis de uma lista de eventos (saída do motor) dentro
 * de uma transação, com rastreabilidade mão-dupla (origem*). Compartilhado pelos
 * três estágios da execução (empenho/liquidação/pagamento).
 */
export async function gravarEventos(
  lancamentos: LancamentosService,
  eventos: LancamentoEvento[],
  meta: { entidadeId: string; data: string; histBase: string; origemTipo: OrigemLancamento; origemId: string; criadoPorId: string },
  tx: Prisma.TransactionClient,
): Promise<void> {
  for (const ev of eventos) {
    await lancamentos.criar(
      {
        entidadeId: meta.entidadeId,
        data: meta.data,
        historico: `${ev.descricaoEvento} — ${meta.histBase}`,
        itens: ev.itens,
        criadoPorId: meta.criadoPorId,
        origemTipo: meta.origemTipo,
        origemId: meta.origemId,
        eventoCodigo: ev.eventoCodigo,
      },
      tx,
    )
  }
}

export class MotorEventosDespesa {
  constructor(private prisma: PrismaClient) {}

  /** E600 — Empenho: orçamentário + controle DDR. */
  async resolverEmpenho(ctx: ContextoDespesa, opts: { estorno?: boolean } = {}, tx?: Prisma.TransactionClient): Promise<LancamentoEvento[]> {
    const db = tx ?? this.prisma
    const C = CONTAS_DESPESA
    const ids = await this.resolverContas(ctx, [C.creditoDisponivel, C.empenhadoALiquidar, C.ddrDisponivel, C.ddrComprEmpenho], db)
    const par = this.parBuilder(ctx, ids, opts.estorno)
    return [
      par('600', 'Empenho — orçamentário', C.creditoDisponivel, C.empenhadoALiquidar),
      par('601', 'Empenho — controle DDR', C.ddrDisponivel, C.ddrComprEmpenho),
    ]
  }

  /** E700 — Liquidação: orçamentário + DDR + patrimonial (VPD/passivo, via de/para). */
  async resolverLiquidacao(ctx: ContextoDespesa, opts: { estorno?: boolean } = {}, tx?: Prisma.TransactionClient): Promise<LancamentoEvento[]> {
    const db = tx ?? this.prisma
    const C = CONTAS_DESPESA
    const param = await this.parametroPatrimonial(ctx, db)
    const codigos = [C.empenhadoALiquidar, C.liquidadoAPagar, C.ddrComprEmpenho, C.ddrComprLiquidacao]
    if (param) codigos.push(param.contaVpdCodigo, param.contaPassivoCodigo)
    const ids = await this.resolverContas(ctx, codigos, db)
    const par = this.parBuilder(ctx, ids, opts.estorno)
    const eventos = [
      par('700', 'Liquidação — orçamentário', C.empenhadoALiquidar, C.liquidadoAPagar),
      par('701', 'Liquidação — controle DDR', C.ddrComprEmpenho, C.ddrComprLiquidacao),
    ]
    if (param) eventos.push(par('702', 'Liquidação — patrimonial (VPD / passivo)', param.contaVpdCodigo, param.contaPassivoCodigo))
    return eventos
  }

  /** E800 — Pagamento: orçamentário + DDR + financeiro (passivo/caixa). */
  async resolverPagamento(ctx: ContextoDespesa, opts: { estorno?: boolean } = {}, tx?: Prisma.TransactionClient): Promise<LancamentoEvento[]> {
    const db = tx ?? this.prisma
    const C = CONTAS_DESPESA
    const param = await this.parametroPatrimonial(ctx, db)
    const caixa = ctx.caixaCodigo || C.caixaPagamento
    const codigos = [C.liquidadoAPagar, C.pago, C.ddrComprLiquidacao, C.ddrUtilizada, caixa]
    if (param) codigos.push(param.contaPassivoCodigo)
    const ids = await this.resolverContas(ctx, codigos, db)
    const par = this.parBuilder(ctx, ids, opts.estorno)
    const eventos = [
      par('800', 'Pagamento — orçamentário', C.liquidadoAPagar, C.pago),
      par('801', 'Pagamento — controle DDR', C.ddrComprLiquidacao, C.ddrUtilizada),
    ]
    if (param) eventos.push(par('802', 'Pagamento — financeiro (passivo / caixa)', param.contaPassivoCodigo, caixa))
    return eventos
  }

  /** Resolve o de/para patrimonial (VPD/passivo) da natureza, por modelo. Null se não houver. */
  private async parametroPatrimonial(ctx: ContextoDespesa, db: Db) {
    const modeloId = await this.modeloDaEntidade(ctx.entidadeId, db)
    const params = await db.parametroDespesa.findMany({ where: { modeloContabilId: modeloId } })
    return resolverParametroDespesa(params, ctx.naturezaCodigo)
  }

  /**
   * Builder de um par D-C (eventoCodigo, descrição, conta débito, conta crédito).
   * No estorno, inverte o lado. Conta-corrente = dotação em todas as pernas.
   */
  private parBuilder(ctx: ContextoDespesa, idPorCodigo: Map<string, string>, estorno?: boolean) {
    const valor = new Prisma.Decimal(ctx.valor).toFixed(2)
    const dDeb: 'DEBITO' | 'CREDITO' = estorno ? 'CREDITO' : 'DEBITO'
    const dCred: 'DEBITO' | 'CREDITO' = estorno ? 'DEBITO' : 'CREDITO'
    const leg = (codigo: string, tipo: 'DEBITO' | 'CREDITO'): ItemDado => {
      const id = idPorCodigo.get(codigo)
      if (!id) throw new ErroNegocio('ENTIDADE_NAO_PROCESSAVEL', `Integração contábil indisponível: conta "${codigo}" não é folha no plano da entidade (exercício ${ctx.ano}).`)
      return { contaId: id, tipo, valor, dotacaoDespesaId: ctx.dotacaoDespesaId }
    }
    return (eventoCodigo: string, descricaoEvento: string, contaDebito: string, contaCredito: string): LancamentoEvento => ({
      eventoCodigo,
      descricaoEvento,
      itens: [leg(contaDebito, dDeb), leg(contaCredito, dCred)],
    })
  }

  /** Mapeia código→id das folhas necessárias (valida existência e que admitem movimento). */
  private async resolverContas(ctx: ContextoDespesa, codigos: string[], db: Db): Promise<Map<string, string>> {
    const unicos = [...new Set(codigos)]
    const contas = await db.contaContabilEntidade.findMany({
      where: { entidadeId: ctx.entidadeId, ano: ctx.ano, codigo: { in: unicos } },
      select: { id: true, codigo: true, admiteMovimento: true },
    })
    const map = new Map<string, string>()
    for (const c of contas) if (c.admiteMovimento) map.set(c.codigo, c.id)
    return map
  }

  /** Resolve o modelo contábil que a entidade usa (município ⟶ estado). */
  private async modeloDaEntidade(entidadeId: string, db: Db): Promise<string> {
    const entidade = await db.entidade.findUnique({
      where: { id: entidadeId },
      include: { municipio: { include: { estado: { select: { modeloContabilId: true } } } } },
    })
    if (!entidade) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Entidade não encontrada.')
    const modeloId = entidade.municipio.modeloContabilId ?? entidade.municipio.estado.modeloContabilId
    if (!modeloId) throw new ErroNegocio('ENTIDADE_NAO_PROCESSAVEL', 'A entidade não está vinculada a um modelo contábil.')
    return modeloId
  }
}
