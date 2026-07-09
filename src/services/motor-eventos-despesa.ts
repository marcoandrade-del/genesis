import { PrismaClient, Prisma, type OrigemLancamento, type GatilhoEvento } from '@prisma/client'
import { ErroNegocio } from '../errors.js'
import type { ItemDado, LancamentosService } from './lancamentos.js'
import { resolverParametroDespesa } from './parametros-despesa.js'

/**
 * Motor de Eventos da DESPESA — **table-driven**: lê a matriz de contabilização
 * de `EventoContabil`/`EventoLancamento` (configurável por modelo, no admin da
 * Tabela de Eventos) e transforma cada estágio da execução em lançamentos
 * automáticos (partida dobrada). O estágio é o prefixo do código do evento:
 * empenho = 6xx, liquidação = 7xx, pagamento = 8xx.
 *
 * As pernas D/C de cada evento vêm das máscaras do evento. Máscaras literais são
 * códigos do PCASP (resolvidos para a folha da entidade); **tokens** resolvem no
 * disparo a contas que dependem da classificação do documento:
 *  - `@VPD` / `@PASSIVO` → `ParametroDespesa` (de/para por natureza) — patrimonial.
 *  - `@CAIXA` → folha de caixa da conta bancária do pagamento.
 *
 * Token sem resolução (sem de/para, sem caixa) **pula o evento** (a perna é
 * opcional — ex.: liquidação sem de/para gera só orçamentário+DDR). Código literal
 * que não é folha no plano da entidade **derruba a transação** (erro de config).
 *
 * Conta-corrente = **dotação** (carrega a funcional-programática completa). O
 * estorno inverte cada par D↔C mantendo as contas.
 */

/**
 * Folhas canônicas do PCASP da despesa — fonte única usada pelo SEED da matriz
 * (`scripts/seed_parametros_despesa.ts`). O motor lê a tabela, não estas constantes.
 */
export const CONTAS_DESPESA = {
  creditoDisponivel: '6.2.2.1.1.00.00.00.00.00.00.00',
  empenhadoALiquidar: '6.2.2.1.3.01.00.00.00.00.00.00',
  liquidadoAPagar: '6.2.2.1.3.03.00.00.00.00.00.00',
  pago: '6.2.2.1.3.04.00.00.00.00.00.00',
  ddrDisponivel: '8.2.1.1.1.01.00.00.00.00.00.00',
  ddrComprEmpenho: '8.2.1.1.2.01.00.00.00.00.00.00',
  ddrComprLiquidacao: '8.2.1.1.3.01.00.00.00.00.00.00',
  ddrUtilizada: '8.2.1.1.4.01.00.00.00.00.00.00',
} as const

/** Tokens de máscara resolvidos no disparo (contas que dependem do documento). */
export const TOKENS = { VPD: '@VPD', PASSIVO: '@PASSIVO', CAIXA: '@CAIXA' } as const

export type ContextoDespesa = {
  entidadeId: string
  ano: number
  dotacaoDespesaId: string
  /** Código da natureza da despesa (ContaDespesaEntidade.codigo) — chave do de/para. */
  naturezaCodigo: string
  valor: Prisma.Decimal | string | number
  /** Folha de caixa a creditar no pagamento — vinda da ContaBancaria (token @CAIXA). */
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

type ParametroPatrimonial = { contaVpdCodigo: string; contaPassivoCodigo: string }

export class MotorEventosDespesa {
  constructor(private prisma: PrismaClient) {}

  /** Empenho — eventos com gatilho EMPENHO na Tabela de Eventos do modelo. */
  resolverEmpenho(ctx: ContextoDespesa, opts: { estorno?: boolean } = {}, tx?: Prisma.TransactionClient): Promise<LancamentoEvento[]> {
    return this.resolverEstagio(ctx, 'EMPENHO', opts, tx)
  }

  /** Liquidação — gatilho LIQUIDACAO (orçamentário + DDR + patrimonial via de/para). */
  resolverLiquidacao(ctx: ContextoDespesa, opts: { estorno?: boolean } = {}, tx?: Prisma.TransactionClient): Promise<LancamentoEvento[]> {
    return this.resolverEstagio(ctx, 'LIQUIDACAO', opts, tx)
  }

  /** Pagamento — gatilho PAGAMENTO (orçamentário + DDR + financeiro passivo/caixa). */
  resolverPagamento(ctx: ContextoDespesa, opts: { estorno?: boolean } = {}, tx?: Prisma.TransactionClient): Promise<LancamentoEvento[]> {
    return this.resolverEstagio(ctx, 'PAGAMENTO', opts, tx)
  }

  /**
   * Resolve os eventos de um estágio (pelo gatilho) lendo a matriz do modelo: para
   * cada evento, resolve as máscaras D/C (literal ou token); pula o evento se algum
   * token não resolver; monta os pares com cc=dotação. Estorno inverte D↔C.
   */
  private async resolverEstagio(ctx: ContextoDespesa, gatilho: GatilhoEvento, opts: { estorno?: boolean }, tx?: Prisma.TransactionClient): Promise<LancamentoEvento[]> {
    const db = tx ?? this.prisma
    const modeloId = await this.modeloDaEntidade(ctx.entidadeId, db)
    const eventos = await db.eventoContabil.findMany({
      where: { modeloContabilId: modeloId, ativo: true, gatilho },
      orderBy: { codigo: 'asc' },
      include: { lancamentos: { orderBy: { ordem: 'asc' } } },
    })
    if (!eventos.length) return []

    // De/para só é consultado se a matriz usa tokens patrimoniais (evita query no empenho).
    const usaDePara = eventos.some((e) => e.lancamentos.some((l) => ehTokenDePara(l.contaDebitoMascara) || ehTokenDePara(l.contaCreditoMascara)))
    const param = usaDePara ? await this.parametroPatrimonial(ctx, modeloId, db) : null
    const caixa = ctx.caixaCodigo || null

    const resolverMascara = (m: string): { codigo: string | null; token: boolean } => {
      const t = m.trim()
      if (t === TOKENS.VPD) return { codigo: param?.contaVpdCodigo ?? null, token: true }
      if (t === TOKENS.PASSIVO) return { codigo: param?.contaPassivoCodigo ?? null, token: true }
      if (t === TOKENS.CAIXA) return { codigo: caixa, token: true }
      return { codigo: t, token: false }
    }

    // Resolve cada evento; token indisponível → pula o evento inteiro (perna opcional).
    type Resolvido = { codigo: string; descricao: string; pares: Array<{ debito: string; credito: string }> }
    const resolvidos: Resolvido[] = []
    for (const ev of eventos) {
      const pares: Array<{ debito: string; credito: string }> = []
      let pular = false
      for (const l of ev.lancamentos) {
        const d = resolverMascara(l.contaDebitoMascara)
        const c = resolverMascara(l.contaCreditoMascara)
        if ((d.token && !d.codigo) || (c.token && !c.codigo)) { pular = true; break }
        pares.push({ debito: d.codigo as string, credito: c.codigo as string })
      }
      if (!pular && pares.length) resolvidos.push({ codigo: ev.codigo, descricao: ev.descricao, pares })
    }
    if (!resolvidos.length) return []

    // Resolve todos os códigos → id da folha da entidade (uma query).
    const codigos = [...new Set(resolvidos.flatMap((r) => r.pares.flatMap((p) => [p.debito, p.credito])))]
    const idPorCodigo = await this.resolverContas(ctx, codigos, db)

    // Fonte da dotação carimbada em cada perna (dimensão da MSC/RGF): sem ela, a
    // fonte da despesa só sairia por join na dotação. O motor da receita já faz o
    // análogo. Null-safe: dotação sem fonte resolvível ⇒ fonteCodigo null (comportamento anterior).
    const fonteCodigo = await this.fonteDaDotacao(ctx.dotacaoDespesaId, db)

    const valor = new Prisma.Decimal(ctx.valor).toFixed(2)
    const dDeb: 'DEBITO' | 'CREDITO' = opts.estorno ? 'CREDITO' : 'DEBITO'
    const dCred: 'DEBITO' | 'CREDITO' = opts.estorno ? 'DEBITO' : 'CREDITO'
    const leg = (codigo: string, tipo: 'DEBITO' | 'CREDITO'): ItemDado => {
      const id = idPorCodigo.get(codigo)
      if (!id) throw new ErroNegocio('ENTIDADE_NAO_PROCESSAVEL', `Integração contábil indisponível: conta "${codigo}" não é folha no plano da entidade (exercício ${ctx.ano}).`)
      return { contaId: id, tipo, valor, dotacaoDespesaId: ctx.dotacaoDespesaId, fonteCodigo }
    }
    return resolvidos.map((r) => ({
      eventoCodigo: r.codigo,
      descricaoEvento: r.descricao,
      itens: r.pares.flatMap((p) => [leg(p.debito, dDeb), leg(p.credito, dCred)]),
    }))
  }

  /** Fonte (código) da dotação, para carimbar o razão da despesa. Null-safe (dotação/fonte ausente ⇒ null). */
  private async fonteDaDotacao(dotacaoDespesaId: string, db: Db): Promise<string | null> {
    const dot = await db.dotacaoDespesa.findUnique({
      where: { id: dotacaoDespesaId },
      select: { fonteRecurso: { select: { codigo: true } } },
    })
    return dot?.fonteRecurso?.codigo ?? null
  }

  /** Resolve o de/para patrimonial (VPD/passivo) da natureza, por modelo. Null se não houver. */
  private async parametroPatrimonial(ctx: ContextoDespesa, modeloId: string, db: Db): Promise<ParametroPatrimonial | null> {
    const params = await db.parametroDespesa.findMany({ where: { modeloContabilId: modeloId } })
    return resolverParametroDespesa(params, ctx.naturezaCodigo)
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

/** Token de de/para patrimonial (resolve via ParametroDespesa). */
function ehTokenDePara(mascara: string): boolean {
  const t = mascara.trim()
  return t === TOKENS.VPD || t === TOKENS.PASSIVO
}
