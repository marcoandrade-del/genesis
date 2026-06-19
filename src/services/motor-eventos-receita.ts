import { PrismaClient, Prisma } from '@prisma/client'
import { ErroNegocio } from '../errors.js'
import type { ItemDado } from './lancamentos.js'

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

export type ContextoArrecadacao = {
  entidadeId: string
  ano: number
  /** Código da natureza da receita (ContaReceitaEntidade.codigo). */
  naturezaCodigo: string
  /** Código da fonte de recursos (FonteRecursoEntidade.codigo). */
  fonteCodigo: string
  fonteVinculada: boolean
  valor: Prisma.Decimal | string | number
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
    const efetiva = parametro?.tipoMutacao === 'EFETIVA'

    const ddrControle = ctx.fonteVinculada
      ? CONTAS_EVENTO.ddrControleVinculado
      : CONTAS_EVENTO.ddrControleOrdinario

    const codigos = [
      CONTAS_EVENTO.receitaARealizar,
      CONTAS_EVENTO.receitaRealizada,
      ddrControle,
      CONTAS_EVENTO.ddrDisponibilidade,
    ]
    if (efetiva) codigos.push(CONTAS_EVENTO.caixaArrecadacao, parametro!.contaVpaCodigo)

    const idPorCodigo = await this.resolverContas(ctx.entidadeId, ctx.ano, codigos, db)
    const valor = new Prisma.Decimal(ctx.valor).toFixed(2)

    const leg = (codigo: string, tipo: 'DEBITO' | 'CREDITO', cc: { natureza?: string; fonte?: string }): ItemDado => {
      const id = idPorCodigo.get(codigo)
      if (!id) {
        throw new ErroNegocio(
          'ENTIDADE_NAO_PROCESSAVEL',
          `Integração contábil indisponível: conta "${codigo}" não existe como folha no plano da entidade (exercício ${ctx.ano}).`,
        )
      }
      return {
        contaId: id,
        tipo,
        valor,
        naturezaReceitaCodigo: cc.natureza ?? null,
        fonteCodigo: cc.fonte ?? null,
      }
    }

    // No estorno, inverte o lado de cada perna (mesmas contas).
    const dDeb: 'DEBITO' | 'CREDITO' = opts.estorno ? 'CREDITO' : 'DEBITO'
    const dCred: 'DEBITO' | 'CREDITO' = opts.estorno ? 'DEBITO' : 'CREDITO'
    const par = (
      codigo: string,
      descricao: string,
      deb: { codigo: string; cc: { natureza?: string; fonte?: string } },
      cred: { codigo: string; cc: { natureza?: string; fonte?: string } },
    ): LancamentoEvento => ({
      eventoCodigo: codigo,
      descricaoEvento: descricao,
      itens: [leg(deb.codigo, dDeb, deb.cc), leg(cred.codigo, dCred, cred.cc)],
    })

    const eventos: LancamentoEvento[] = [
      // E100 — Orçamentário: D Receita Realizada / C Receita a Realizar (cc natureza)
      par(
        '100',
        'Arrecadação orçamentária',
        { codigo: CONTAS_EVENTO.receitaRealizada, cc: { natureza: ctx.naturezaCodigo } },
        { codigo: CONTAS_EVENTO.receitaARealizar, cc: { natureza: ctx.naturezaCodigo } },
      ),
      // E200 — Controle DDR: D Controle da Disponibilidade / C Disponibilidade por Destinação (cc fonte)
      par(
        '200',
        'Disponibilidade por destinação de recursos (DDR)',
        { codigo: ddrControle, cc: { fonte: ctx.fonteCodigo } },
        { codigo: CONTAS_EVENTO.ddrDisponibilidade, cc: { fonte: ctx.fonteCodigo } },
      ),
    ]

    // E300 — Patrimonial (só receita EFETIVA): D Caixa / C VPA
    if (efetiva) {
      eventos.push(
        par(
          '300',
          'Variação patrimonial aumentativa (receita efetiva)',
          { codigo: CONTAS_EVENTO.caixaArrecadacao, cc: { fonte: ctx.fonteCodigo } },
          { codigo: parametro!.contaVpaCodigo, cc: { natureza: ctx.naturezaCodigo } },
        ),
      )
    }

    return eventos
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
