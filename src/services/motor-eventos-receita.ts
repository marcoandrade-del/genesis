import { PrismaClient, Prisma, type TipoMutacao, type IndicadorReconhecimento, type GatilhoEvento } from '@prisma/client'
import { ErroNegocio } from '../errors.js'
import type { ItemDado } from './lancamentos.js'

type ParametroRow = {
  tipoMutacao: TipoMutacao
  indicadorReconhecimento: IndicadorReconhecimento
  contaContrapartidaCodigo: string
  contaAtivoCodigo: string | null
  contaDividaAtivaCodigo?: string | null
}

/**
 * Escolhe o evento patrimonial NÃO-tributário da arrecadação (regime de caixa) a
 * partir do indicador de mutação e da natureza (mesma estrutura: D Caixa / C contrapartida):
 *  - EFETIVA                          → E300 (VPA classe 4)
 *  - NÃO-EFETIVA, capital op. crédito → E400 (passivo classe 2)   [natureza 2.1.x]
 *  - NÃO-EFETIVA, capital alienação   → E500 (baixa de ativo cl.1) [natureza 2.2.x]
 *  - demais não-efetivas (ex.: amortização 2.3) → sem evento patrimonial (só E100/E200)
 */
function eventoPatrimonial(tipo: TipoMutacao, naturezaCodigo: string): { codigo: string; descricao: string } | null {
  if (tipo === 'EFETIVA') return { codigo: '300', descricao: 'Variação patrimonial aumentativa (receita efetiva)' }
  const [categoria, origem] = naturezaCodigo.split('.')
  if (categoria === '2' && origem === '1') return { codigo: '400', descricao: 'Mutação por operação de crédito (passivo)' }
  if (categoria === '2' && origem === '2') return { codigo: '500', descricao: 'Mutação por alienação de bens (baixa de ativo)' }
  return null
}

/**
 * Evento patrimonial da ARRECADAÇÃO (D Caixa / C contrapartida). Para a tributária
 * (COMPETENCIA) a contrapartida é a BAIXA do crédito a receber (E560 — a VPA já foi
 * reconhecida no lançamento); para a não-tributária (CAIXA) é VPA/passivo/ativo (E300/400/500).
 */
function patrimonialArrecadacao(parametro: ParametroRow | null, naturezaCodigo: string): { codigo: string; descricao: string; contrapartida: string } | null {
  if (!parametro) return null
  if (parametro.indicadorReconhecimento === 'COMPETENCIA') {
    if (!parametro.contaAtivoCodigo) return null
    return { codigo: '560', descricao: 'Arrecadação de receita lançada (baixa do crédito a receber)', contrapartida: parametro.contaAtivoCodigo }
  }
  const ev = eventoPatrimonial(parametro.tipoMutacao, naturezaCodigo)
  return ev ? { ...ev, contrapartida: parametro.contaContrapartidaCodigo } : null
}

/**
 * Motor de Eventos da Receita — a "Tabela de Integração" que transforma a
 * arrecadação orçamentária (natureza × fonte × valor) nos lançamentos contábeis
 * automáticos (partida dobrada), nos três aspectos da CASP:
 *
 *  - E100 Orçamentário (sempre): D Receita Realizada / C Receita a Realizar
 *    (reduz o "a realizar" que a previsão creditou). conta-corrente = natureza.
 *  - E200 Controle DDR (sempre): D Controle da Disponibilidade / C Disponibilidade
 *    por Destinação. conta-corrente = fonte (classe 8). O débito é Recursos
 *    Ordinários ou Vinculados conforme a fonte.
 *  - E300 Patrimonial (só se a natureza for EFETIVA, via ParametroReceita):
 *    D Caixa (folha de arrecadação) / C VPA (de/para NR→VPA). cc: fonte no caixa,
 *    natureza na VPA.
 *
 * A "conta corrente" (natureza/fonte) é uma DIMENSÃO carregada no LancamentoItem —
 * a conta resolve para a folha fixa do PCASP, e natureza/fonte viajam como sub-razão.
 *
 * O estorno inverte cada par (D↔C) mantendo as mesmas contas. A checagem de saldo
 * a estornar é feita a montante (ArrecadacoesService), não aqui.
 */

/** Folhas fixas do PCASP usadas pelos eventos (código de 12 segmentos, como na entidade). */
export const CONTAS_EVENTO = {
  /** Caixa de arrecadação default da entidade (MVP; futuro: derivar da ContaBancaria #75). */
  caixaArrecadacao: '1.1.1.1.1.30.00.00.00.00.00.00', // REDE BANCÁRIA - ARRECADAÇÃO
  receitaARealizar: '6.2.1.1.0.00.00.00.00.00.00.00',
  receitaRealizada: '6.2.1.2.0.00.00.00.00.00.00.00',
  ddrControleOrdinario: '7.2.1.1.1.00.00.00.00.00.00.00', // RECURSOS ORDINÁRIOS
  ddrControleVinculado: '7.2.1.1.2.00.00.00.00.00.00.00', // RECURSOS VINCULADOS
  ddrDisponibilidade: '8.2.1.1.1.01.00.00.00.00.00.00', // RECURSOS DISPONÍVEIS PARA O EXERCÍCIO
} as const

/**
 * Tokens de máscara resolvidos no disparo da arrecadação (contas que dependem do
 * documento): `@CAIXA` (folha de caixa da conta bancária), `@DDR_CONTROLE`
 * (ordinário/vinculado conforme a fonte) e `@CONTRAPARTIDA` (VPA/passivo/ativo da
 * de/para — `ParametroReceita`).
 */
export const TOKENS = {
  CAIXA: '@CAIXA',
  DDR_CONTROLE: '@DDR_CONTROLE',
  CONTRAPARTIDA: '@CONTRAPARTIDA',
  ATIVO: '@ATIVO', // créditos a receber (1.1.2.x) — lançamento tributário / dívida ativa
  DIVIDA_ATIVA: '@DIVIDA_ATIVA', // dívida ativa (1.2.1.x) — inscrição
} as const

/** Resolve uma máscara para conta-corrente, dado o resolvedor de tokens do estágio. */
type CcResolvido = { codigo: string; cc: 'natureza' | 'fonte' }
type ResolverToken = (token: string) => CcResolvido | null

export type ContextoArrecadacao = {
  entidadeId: string
  ano: number
  /** Código da natureza da receita (ContaReceitaEntidade.codigo). */
  naturezaCodigo: string
  /** Código da fonte de recursos (FonteRecursoEntidade.codigo). */
  fonteCodigo: string
  fonteVinculada: boolean
  valor: Prisma.Decimal | string | number
  /**
   * Folha contábil de caixa a debitar no E300 — vinda da conta bancária por onde
   * a receita entrou. Se ausente, usa o caixa de arrecadação default da entidade.
   */
  caixaCodigo?: string | null
}

export type LancamentoEvento = {
  eventoCodigo: string // "100" | "200" | "300"
  descricaoEvento: string
  itens: ItemDado[] // 1 débito + 1 crédito, já balanceados
}

type Db = PrismaClient | Prisma.TransactionClient

export class MotorEventosReceita {
  constructor(private prisma: PrismaClient) {}

  /**
   * Resolve a arrecadação na lista de lançamentos contábeis a gerar (um por
   * evento). Se a natureza não tiver parâmetro EFETIVO, gera só E100+E200
   * (orçamentário + controle são sempre obrigatórios); o patrimonial (E300)
   * exige a parametrização da natureza.
   */
  async resolver(
    ctx: ContextoArrecadacao,
    opts: { estorno?: boolean } = {},
    tx?: Prisma.TransactionClient,
  ): Promise<LancamentoEvento[]> {
    const db = tx ?? this.prisma
    const modeloId = await this.modeloDaEntidade(ctx.entidadeId, db)
    const parametro = await this.parametroPara(modeloId, ctx.naturezaCodigo, db)
    // SELEÇÃO (regra de negócio, fica em código): orçamentário + DDR sempre; o
    // patrimonial só se a parametrização da natureza indicar (E300/400/500/560).
    const patrimonial = patrimonialArrecadacao(parametro, ctx.naturezaCodigo)
    // SELEÇÃO em código; as CONTAS D/C vêm da Tabela de Eventos (gatilho ARRECADACAO).
    const codigos = ['100', '200', ...(patrimonial ? [patrimonial.codigo] : [])]
    const ddrControle = ctx.fonteVinculada ? CONTAS_EVENTO.ddrControleVinculado : CONTAS_EVENTO.ddrControleOrdinario
    const caixa = ctx.caixaCodigo || CONTAS_EVENTO.caixaArrecadacao
    const resolverToken: ResolverToken = (t) => {
      if (t === TOKENS.CAIXA) return { codigo: caixa, cc: 'fonte' }
      if (t === TOKENS.DDR_CONTROLE) return { codigo: ddrControle, cc: 'fonte' }
      if (t === TOKENS.CONTRAPARTIDA) return patrimonial ? { codigo: patrimonial.contrapartida, cc: 'natureza' } : null
      return null
    }
    return this.montarEventos(ctx, modeloId, 'ARRECADACAO', codigos, resolverToken, opts, db)
  }

  /**
   * Núcleo table-driven: carrega os eventos do `gatilho` (na ordem de `codigos`, ou
   * todos do gatilho), resolve cada máscara D/C (literal ou token via `resolverToken`)
   * e monta os pares com cc derivada (DDR/caixa → fonte, demais → natureza). Estorno
   * inverte D↔C. Evento ausente na tabela é pulado; conta literal não-folha derruba.
   */
  private async montarEventos(
    ctx: { entidadeId: string; ano: number; naturezaCodigo: string; fonteCodigo?: string | null; valor: Prisma.Decimal | string | number },
    modeloId: string,
    gatilho: GatilhoEvento,
    codigos: string[] | null,
    resolverToken: ResolverToken,
    opts: { estorno?: boolean },
    db: Db,
  ): Promise<LancamentoEvento[]> {
    const eventos = await db.eventoContabil.findMany({
      where: { modeloContabilId: modeloId, ativo: true, gatilho, ...(codigos ? { codigo: { in: codigos } } : {}) },
      orderBy: { codigo: 'asc' },
      include: { lancamentos: { orderBy: { ordem: 'asc' } } },
    })
    const porCodigo = new Map(eventos.map((e) => [e.codigo, e]))

    const resolverMascara = (m: string): CcResolvido => {
      const t = m.trim()
      if (t.startsWith('@')) {
        const r = resolverToken(t)
        if (r) return r
      }
      const classe = t.charAt(0)
      return { codigo: t, cc: classe === '7' || classe === '8' ? 'fonte' : 'natureza' }
    }

    const resolvidos = (codigos ?? eventos.map((e) => e.codigo))
      .map((c) => porCodigo.get(c))
      .filter((e): e is NonNullable<typeof e> => !!e)
      .map((ev) => ({
        codigo: ev.codigo,
        descricao: ev.descricao,
        pares: ev.lancamentos.map((l) => ({ d: resolverMascara(l.contaDebitoMascara), c: resolverMascara(l.contaCreditoMascara) })),
      }))

    const todos = [...new Set(resolvidos.flatMap((e) => e.pares.flatMap((p) => [p.d.codigo, p.c.codigo])))]
    const idPorCodigo = await this.resolverContas(ctx.entidadeId, ctx.ano, todos, db)
    const valor = new Prisma.Decimal(ctx.valor).toFixed(2)
    const fonte = ctx.fonteCodigo ?? null

    const dDeb: 'DEBITO' | 'CREDITO' = opts.estorno ? 'CREDITO' : 'DEBITO'
    const dCred: 'DEBITO' | 'CREDITO' = opts.estorno ? 'DEBITO' : 'CREDITO'
    const leg = (r: CcResolvido, tipo: 'DEBITO' | 'CREDITO'): ItemDado => {
      const id = idPorCodigo.get(r.codigo)
      if (!id) {
        throw new ErroNegocio(
          'ENTIDADE_NAO_PROCESSAVEL',
          `Integração contábil indisponível: conta "${r.codigo}" não existe como folha no plano da entidade (exercício ${ctx.ano}).`,
        )
      }
      return { contaId: id, tipo, valor, naturezaReceitaCodigo: r.cc === 'natureza' ? ctx.naturezaCodigo : null, fonteCodigo: r.cc === 'fonte' ? fonte : null }
    }

    return resolvidos.map((e) => ({
      eventoCodigo: e.codigo,
      descricaoEvento: e.descricao,
      itens: e.pares.flatMap((p) => [leg(p.d, dDeb), leg(p.c, dCred)]),
    }))
  }

  /**
   * Resolve o LANÇAMENTO (constituição) do crédito tributário — estágio de
   * COMPETÊNCIA: E550 D Créditos a Receber (ativo 1.1.2.x) / C VPA (classe 4),
   * conta-corrente = natureza. O estorno inverte. (O orçamentário/DDR só ocorre
   * na arrecadação posterior.)
   */
  async resolverLancamentoTributario(
    ctx: { entidadeId: string; ano: number; naturezaCodigo: string; valor: Prisma.Decimal | string | number },
    opts: { estorno?: boolean } = {},
    tx?: Prisma.TransactionClient,
  ): Promise<LancamentoEvento[]> {
    const db = tx ?? this.prisma
    const modeloId = await this.modeloDaEntidade(ctx.entidadeId, db)
    const parametro = await this.parametroPara(modeloId, ctx.naturezaCodigo, db)
    if (!parametro || parametro.indicadorReconhecimento !== 'COMPETENCIA' || !parametro.contaAtivoCodigo) {
      throw new ErroNegocio(
        'ENTIDADE_NAO_PROCESSAVEL',
        `A natureza ${ctx.naturezaCodigo} não está configurada como tributária (competência) com conta de ativo — não há crédito a constituir.`,
      )
    }
    const ativo = parametro.contaAtivoCodigo
    const resolverToken: ResolverToken = (t) => {
      if (t === TOKENS.ATIVO) return { codigo: ativo, cc: 'natureza' }
      if (t === TOKENS.CONTRAPARTIDA) return { codigo: parametro.contaContrapartidaCodigo, cc: 'natureza' }
      return null
    }
    return this.montarEventos(ctx, modeloId, 'LANCAMENTO_TRIBUTARIO', null, resolverToken, opts, db)
  }

  /**
   * Resolve a INSCRIÇÃO em dívida ativa — reclassificação permutativa do crédito a
   * receber (E570 D Dívida Ativa 1.2.1.x / C baixa do crédito a receber circulante
   * 1.1.2.x), conta-corrente = natureza. Sem VPA (a VPA já foi no lançamento).
   */
  async resolverInscricaoDividaAtiva(
    ctx: { entidadeId: string; ano: number; naturezaCodigo: string; valor: Prisma.Decimal | string | number },
    opts: { estorno?: boolean } = {},
    tx?: Prisma.TransactionClient,
  ): Promise<LancamentoEvento[]> {
    const db = tx ?? this.prisma
    const modeloId = await this.modeloDaEntidade(ctx.entidadeId, db)
    const parametro = await this.parametroPara(modeloId, ctx.naturezaCodigo, db)
    if (!parametro || !parametro.contaAtivoCodigo || !parametro.contaDividaAtivaCodigo) {
      throw new ErroNegocio(
        'ENTIDADE_NAO_PROCESSAVEL',
        `A natureza ${ctx.naturezaCodigo} não tem conta de dívida ativa configurada — não há o que inscrever.`,
      )
    }
    const ativo = parametro.contaAtivoCodigo
    const dividaAtiva = parametro.contaDividaAtivaCodigo
    const resolverToken: ResolverToken = (t) => {
      if (t === TOKENS.DIVIDA_ATIVA) return { codigo: dividaAtiva, cc: 'natureza' }
      if (t === TOKENS.ATIVO) return { codigo: ativo, cc: 'natureza' }
      return null
    }
    return this.montarEventos(ctx, modeloId, 'INSCRICAO_DIVIDA_ATIVA', null, resolverToken, opts, db)
  }

  /** Saldo (devedor: D − C) de uma conta-folha da entidade no exercício, pelo código. */
  async saldoDaConta(entidadeId: string, ano: number, contaCodigo: string, tx?: Prisma.TransactionClient): Promise<Prisma.Decimal> {
    const db = tx ?? this.prisma
    const conta = await db.contaContabilEntidade.findUnique({
      where: { entidadeId_ano_codigo: { entidadeId, ano, codigo: contaCodigo } },
      select: { id: true },
    })
    if (!conta) return new Prisma.Decimal(0)
    const grp = await db.lancamentoItem.groupBy({ by: ['tipo'], where: { contaId: conta.id }, _sum: { valor: true } })
    let d = new Prisma.Decimal(0)
    let c = new Prisma.Decimal(0)
    for (const g of grp) {
      if (g.tipo === 'DEBITO') d = g._sum.valor ?? d
      else c = g._sum.valor ?? c
    }
    return d.minus(c)
  }

  /**
   * Controle da baixa parcial: a arrecadação de uma receita por COMPETÊNCIA (que
   * baixa o ativo) não pode exceder o crédito a receber já lançado (saldo do ativo).
   * Para naturezas de caixa (não tributárias) não há controle.
   */
  async validarBaixaArrecadacao(entidadeId: string, ano: number, naturezaCodigo: string, valor: Prisma.Decimal | string | number, tx?: Prisma.TransactionClient): Promise<void> {
    const db = tx ?? this.prisma
    const modeloId = await this.modeloDaEntidade(entidadeId, db)
    const parametro = await this.parametroPara(modeloId, naturezaCodigo, db)
    if (!parametro || parametro.indicadorReconhecimento !== 'COMPETENCIA' || !parametro.contaAtivoCodigo) return
    const saldo = await this.saldoDaConta(entidadeId, ano, parametro.contaAtivoCodigo, db)
    if (new Prisma.Decimal(valor).greaterThan(saldo)) {
      throw new ErroNegocio(
        'ENTIDADE_NAO_PROCESSAVEL',
        `Arrecadação excede o crédito a receber lançado para esta natureza (saldo a receber: ${saldo.toFixed(2)}). Lance o crédito antes de arrecadar.`,
      )
    }
  }

  /** Controle: a inscrição em dívida ativa não pode exceder o crédito a receber (circulante). */
  async validarInscricaoDividaAtiva(entidadeId: string, ano: number, naturezaCodigo: string, valor: Prisma.Decimal | string | number, tx?: Prisma.TransactionClient): Promise<void> {
    const db = tx ?? this.prisma
    const modeloId = await this.modeloDaEntidade(entidadeId, db)
    const parametro = await this.parametroPara(modeloId, naturezaCodigo, db)
    if (!parametro || !parametro.contaAtivoCodigo) return
    const saldo = await this.saldoDaConta(entidadeId, ano, parametro.contaAtivoCodigo, db)
    if (new Prisma.Decimal(valor).greaterThan(saldo)) {
      throw new ErroNegocio(
        'ENTIDADE_NAO_PROCESSAVEL',
        `Inscrição em dívida ativa excede o crédito a receber (saldo: ${saldo.toFixed(2)}).`,
      )
    }
  }

  /** Resolve o modelo contábil que a entidade usa (município ⟶ estado). */
  private async modeloDaEntidade(entidadeId: string, db: Db): Promise<string> {
    const entidade = await db.entidade.findUnique({
      where: { id: entidadeId },
      include: { municipio: { include: { estado: { select: { modeloContabilId: true } } } } },
    })
    if (!entidade) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Entidade não encontrada.')
    const modeloId = entidade.municipio.modeloContabilId ?? entidade.municipio.estado.modeloContabilId
    if (!modeloId) {
      throw new ErroNegocio('ENTIDADE_NAO_PROCESSAVEL', 'A entidade não está vinculada a um modelo contábil.')
    }
    return modeloId
  }

  /**
   * Busca o ParametroReceita (de/para NR→VPA) por correspondência do PREFIXO mais
   * longo: configura-se a natureza num nível (ex.: "1.7.1.1.51") e as folhas abaixo
   * herdam. Casa em fronteira de segmento ("1.3.2" não casa "1.3.20").
   */
  private async parametroPara(modeloContabilId: string, naturezaCodigo: string, db: Db) {
    const params = await db.parametroReceita.findMany({ where: { modeloContabilId } })
    let melhor: (typeof params)[number] | null = null
    for (const p of params) {
      const casa = naturezaCodigo === p.naturezaCodigo || naturezaCodigo.startsWith(p.naturezaCodigo + '.')
      if (casa && (!melhor || p.naturezaCodigo.length > melhor.naturezaCodigo.length)) melhor = p
    }
    return melhor
  }

  /** Mapeia código→id das folhas necessárias; valida existência e que admitem movimento. */
  private async resolverContas(
    entidadeId: string,
    ano: number,
    codigos: string[],
    db: Db,
  ): Promise<Map<string, string>> {
    const unicos = [...new Set(codigos)]
    const contas = await db.contaContabilEntidade.findMany({
      where: { entidadeId, ano, codigo: { in: unicos } },
      select: { id: true, codigo: true, admiteMovimento: true },
    })
    const map = new Map<string, string>()
    for (const c of contas) if (c.admiteMovimento) map.set(c.codigo, c.id)
    return map
  }
}
