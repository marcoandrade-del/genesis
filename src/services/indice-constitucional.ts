import { PrismaClient } from '@prisma/client'

/**
 * Índices constitucionais de aplicação mínima — MDE (CF art. 212, ≥25%) e
 * ASPS (CF art. 198 / LC 141 art. 7º, ≥15%) — sobre a receita de impostos.
 *
 *   índice = despesa nas funções típicas financiada pelas FONTES vinculadas
 *            ÷ receita de impostos + transferências constitucionais de impostos
 *
 * Fiel porque cruza função × FONTE DE RECURSO real (o QDD da LOA foi aplicado
 * às dotações — ver [[lrf-despesa-epico-plano]]); antes só existia o
 * informativo por função no Guardião. Detalhes da aproximação:
 *   - MDE: funções 12 × fontes de impostos vinculados à educação + FUNDEB
 *     (a contribuição ao FUNDEB conta pro art. 212). Salário-educação (1107)
 *     fica FORA — é adicional, não entra no mínimo.
 *   - ASPS: função 10 × fonte de recursos PRÓPRIOS da saúde (LC 141 exige
 *     recursos próprios; transferências SUS não contam pro mínimo).
 *   - Base: impostos (1.1.1) + cotas constitucionais (FPM/ITR/ICMS/IPVA/IPI);
 *     CIDE fica fora (é contribuição). Dívida ativa/multas de impostos ainda
 *     não entram (refinamento futuro).
 * Base AUTORIZADA (LOA) na despesa e PREVISTA na receita — mesma escolha da
 * RCL/Pessoal (execução da despesa ainda não lançada).
 *
 * Composição default em código por Estado (padrão do projeto); a camada
 * editável (Estado/Modelo, bancada) é follow-up. Ver [[contabil-rcl-lrf-plano]].
 */

export interface RegraIndice { rotulo: string; prefixos: string[] }
export interface RegraAplicacao { funcoes: string[]; fontes: string[] }
export interface ComposicaoIndices {
  nome: string
  baseImpostos: RegraIndice[] // naturezas da RECEITA que formam o denominador
  mde: RegraAplicacao // DESPESA: funções × prefixos de fonte (numerador MDE)
  asps: RegraAplicacao // idem, ASPS
}

export const COMPOSICAO_INDICES_STN: ComposicaoIndices = {
  nome: 'STN (padrão)',
  baseImpostos: [
    { rotulo: 'Impostos', prefixos: [] },
    { rotulo: 'Transferências constitucionais de impostos', prefixos: [] },
  ],
  mde: { funcoes: ['12'], fontes: [] },
  asps: { funcoes: ['10'], fontes: [] },
}

/** Deltas por Estado (TCE). PR validado contra a LOA real de Maringá 2026. */
export const COMPOSICAO_INDICES_POR_ESTADO: Record<string, ComposicaoIndices> = {
  PR: {
    nome: 'TCE-PR (aproximação por natureza e fonte)',
    baseImpostos: [
      { rotulo: 'Impostos (IPTU, ISS, ITBI, IRRF)', prefixos: ['1.1.1'] },
      { rotulo: 'Cota-parte FPM e ITR', prefixos: ['1.7.1.1.51', '1.7.1.1.52'] },
      { rotulo: 'Cota-parte ICMS, IPVA e IPI', prefixos: ['1.7.2.1.50', '1.7.2.1.51', '1.7.2.1.52'] },
    ],
    mde: { funcoes: ['12'], fontes: ['1101', '1102', '1103', '1104'] },
    asps: { funcoes: ['10'], fontes: ['1303'] },
  },
}

/** Resolve a composição pelo Estado (sigla); cai na STN se não houver delta. */
export function composicaoIndicesDoEstado(sigla: string | null | undefined): ComposicaoIndices {
  return (sigla && COMPOSICAO_INDICES_POR_ESTADO[sigla]) || COMPOSICAO_INDICES_STN
}

export interface LinhaIndice { rotulo: string; valor: number }
export interface ResultadoIndice {
  linhas: LinhaIndice[] // despesa por fonte (numerador aberto)
  total: number
  percentual: number // total ÷ baseTotal
  minimo: number // 25 (MDE) | 15 (ASPS)
  atende: boolean
}
export interface ResultadoIndices {
  temOrcamento: boolean
  metodologia: string
  base: LinhaIndice[] // receita do denominador, aberta pelas regras
  baseTotal: number
  mde: ResultadoIndice
  asps: ResultadoIndice
}

const r2 = (n: number) => Math.round(n * 100) / 100

/** Índices constitucionais (MDE/ASPS) por entidade/exercício, sobre a LOA. */
export class IndiceConstitucionalService {
  constructor(private prisma: PrismaClient) {}

  async calcular(entidadeId: string, ano: number, comp: ComposicaoIndices = COMPOSICAO_INDICES_STN): Promise<ResultadoIndices> {
    const indiceVazio = (minimo: number): ResultadoIndice => ({ linhas: [], total: 0, percentual: 0, minimo, atende: false })
    const orcamento = await this.prisma.orcamento.findUnique({
      where: { entidadeId_ano: { entidadeId, ano } },
      select: { id: true },
    })
    if (!orcamento) {
      return { temOrcamento: false, metodologia: comp.nome, base: [], baseTotal: 0, mde: indiceVazio(25), asps: indiceVazio(15) }
    }

    // denominador: receita prevista nas naturezas da base de impostos
    const previsoes = await this.prisma.previsaoReceita.findMany({
      where: { orcamentoId: orcamento.id },
      select: { valorPrevisto: true, contaReceita: { select: { codigo: true } } },
    })
    const baseValores = comp.baseImpostos.map(() => 0)
    for (const p of previsoes) {
      const cod = p.contaReceita.codigo
      comp.baseImpostos.forEach((r, i) => {
        if (r.prefixos.some((px) => cod.startsWith(px))) baseValores[i]! += Number(p.valorPrevisto)
      })
    }
    const base = comp.baseImpostos.map((r, i) => ({ rotulo: r.rotulo, valor: r2(baseValores[i]!) }))
    const baseTotal = r2(baseValores.reduce((a, b) => a + b, 0))

    // numeradores: despesa autorizada nas funções típicas × fontes vinculadas
    const dotacoes = await this.prisma.dotacaoDespesa.findMany({
      where: { orcamentoId: orcamento.id },
      select: {
        valorAutorizado: true,
        funcao: { select: { codigo: true } },
        fonteRecurso: { select: { codigo: true } },
      },
    })
    const aplicacao = (regra: RegraAplicacao, minimo: number): ResultadoIndice => {
      const porFonte = new Map<string, number>()
      for (const d of dotacoes) {
        if (!regra.funcoes.includes(d.funcao.codigo)) continue
        const fonte = d.fonteRecurso.codigo
        if (!regra.fontes.some((px) => fonte.startsWith(px))) continue
        porFonte.set(fonte, (porFonte.get(fonte) ?? 0) + Number(d.valorAutorizado))
      }
      const linhas = [...porFonte.entries()]
        .sort(([, a], [, b]) => b - a)
        .map(([fonte, valor]) => ({ rotulo: `Fonte ${fonte}`, valor: r2(valor) }))
      const total = r2([...porFonte.values()].reduce((a, b) => a + b, 0))
      const percentual = baseTotal > 0 ? r2((total / baseTotal) * 100) : 0
      return { linhas, total, percentual, minimo, atende: percentual >= minimo }
    }

    return {
      temOrcamento: true,
      metodologia: comp.nome,
      base,
      baseTotal,
      mde: aplicacao(comp.mde, 25),
      asps: aplicacao(comp.asps, 15),
    }
  }
}
