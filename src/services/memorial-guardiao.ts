import { PrismaClient, Prisma } from '@prisma/client'
import { MemorialRclService } from './memorial-rcl.js'
import { DespesaPessoalService } from './despesa-pessoal.js'

const n = (d: { toNumber(): number }) => d.toNumber()
const D0 = () => new Prisma.Decimal(0)
const r1 = (x: number): number => Math.round(x * 10) / 10

export interface LinhaMemorialGuardiao {
  item: string
  valor: number
}

export interface IndicadorGuardiao {
  indicador: string
  unidade: string
  valor: number // R$
  base: number // R$
  percentual: number // %
  limite: number | null
  prudencial: number | null
  alerta: number | null
  nivel: string // ok | alerta | prudencial | estouro
  memorial: { descricao: string; baseLegal: string; linhas: LinhaMemorialGuardiao[] }
}

export interface Guardiao {
  entidade: { id: string; nome: string; municipio: string; estado: string }
  ano: number
  metodologia: string
  temOrcamento: boolean
  indicadores: IndicadorGuardiao[]
}

function nivelDe(pct: number, limite: number | null, prudencial: number, alerta: number): string {
  if (limite == null) return 'ok'
  if (pct >= limite) return 'estouro'
  if (pct >= prudencial) return 'prudencial'
  if (pct >= alerta) return 'alerta'
  return 'ok'
}

/** Indicador INFORMATIVO de aplicação por função (não é o índice constitucional). */
function aplicacaoFuncao(nome: string, valor: number, total: number, descFuncao: string, nota: string): IndicadorGuardiao {
  return {
    indicador: nome,
    unidade: '% da despesa',
    valor,
    base: total,
    percentual: total ? r1((valor / total) * 100) : 0,
    limite: null,
    prudencial: null,
    alerta: null,
    nivel: 'ok',
    memorial: {
      descricao: `Despesa autorizada na ${descFuncao} ÷ despesa total autorizada (informativo).`,
      baseLegal: nota,
      linhas: [
        { item: `Despesa na ${descFuncao}`, valor },
        { item: 'Despesa total autorizada', valor: total },
      ],
    },
  }
}

/**
 * Guardião LRF — os indicadores fiscais calculados NO GÊNESIS (fonte única),
 * prontos pra exibir no Oxy. Hoje: RCL (base) + Despesa com Pessoal (% da RCL,
 * limite 54%) + Aplicação em Educação/Saúde (informativo — participação por
 * função; NÃO é o índice constitucional, que exige vinculação por fonte).
 * Dívida/Restos a Pagar entram quando o Gênesis tiver execução/passivo.
 * Ver [[oxy-dashboards-integracao]].
 */
export class MemorialGuardiaoService {
  constructor(private prisma: PrismaClient) {}

  async guardiao(entidadeId: string, ano: number): Promise<Guardiao | null> {
    const rcl = await new MemorialRclService(this.prisma).rcl(entidadeId, ano)
    if (!rcl) return null

    const indicadores: IndicadorGuardiao[] = []
    if (rcl.temOrcamento) {
      // 1) RCL — base dos limites (informativa, sem limite próprio).
      indicadores.push({
        indicador: 'Receita Corrente Líquida',
        unidade: 'R$',
        valor: rcl.rcl,
        base: rcl.correntesTotal,
        percentual: rcl.correntesTotal ? r1((rcl.rcl / rcl.correntesTotal) * 100) : 0,
        limite: null,
        prudencial: null,
        alerta: null,
        nivel: 'ok',
        memorial: {
          descricao: `RCL = Receitas Correntes − Deduções (${rcl.metodologia}).`,
          baseLegal: 'LRF art. 2º, IV; RREO Anexo 3.',
          linhas: [
            ...rcl.correntes.map((c) => ({ item: c.rotulo, valor: c.valor })),
            ...rcl.deducoes.map((d) => ({ item: '(−) ' + d.rotulo, valor: d.valor })),
          ],
        },
      })

      // 2) Despesa com Pessoal (% da RCL) — DTP fiel (inclusões − exclusões, RGF Anexo 1).
      // Base: dotação autorizada (execução não lançada).
      if (rcl.rcl > 0) {
        const dtp = await new DespesaPessoalService(this.prisma).calcular(entidadeId, ano)
        const pessoal = dtp.despesaLiquida
        const pct = r1((pessoal / rcl.rcl) * 100)
        indicadores.push({
          indicador: 'Despesa com Pessoal',
          unidade: '% da RCL',
          valor: pessoal,
          base: rcl.rcl,
          percentual: pct,
          limite: 54,
          prudencial: 51.3,
          alerta: 48.6,
          nivel: nivelDe(pct, 54, 51.3, 48.6),
          memorial: {
            descricao: `Despesa Total com Pessoal (inclusões − exclusões, ${dtp.metodologia}) ÷ RCL. Base: dotação autorizada — execução ainda não lançada.`,
            baseLegal: 'LRF arts. 18-20 (limite 54% Executivo), 22 (prudencial) e 59 (alerta do TCE).',
            linhas: [
              ...dtp.inclusoes.map((l) => ({ item: l.rotulo, valor: l.valor })),
              ...dtp.exclusoes.map((l) => ({ item: l.rotulo, valor: l.valor })),
              { item: '= Despesa com Pessoal (líquida)', valor: pessoal },
              { item: 'RCL', valor: rcl.rcl },
            ],
          },
        })
      }

      // 3) Aplicação em Educação e Saúde (informativo) — despesa por função ÷ despesa total.
      // ⚠️ NÃO é o índice constitucional (MDE 25% / ASPS 15%): este exige a parcela
      // financiada por impostos/transferências (vinculação por fonte), indisponível
      // nesta base (tudo em fonte genérica). Aqui é a participação de cada função.
      const df = await this.despesaFuncoes(entidadeId, ano)
      if (df.total > 0) {
        indicadores.push(
          aplicacaoFuncao(
            'Aplicação em Educação',
            df.educacao,
            df.total,
            'função 12 (Educação)',
            'Informativo. O índice MDE (CF art. 212, 25%) exige a despesa com recursos de impostos/transferências — depende de vinculação por fonte, ainda não disponível.',
          ),
        )
        indicadores.push(
          aplicacaoFuncao(
            'Aplicação em Saúde',
            df.saude,
            df.total,
            'função 10 (Saúde)',
            'Informativo. O índice ASPS (CF art. 198 / LC 141, 15%) exige a despesa com recursos próprios — depende de vinculação por fonte, ainda não disponível.',
          ),
        )
      }
    }

    return { entidade: rcl.entidade, ano, metodologia: rcl.metodologia, temOrcamento: rcl.temOrcamento, indicadores }
  }

  /** Despesa autorizada total e por função (12 = Educação, 10 = Saúde). */
  private async despesaFuncoes(entidadeId: string, ano: number): Promise<{ total: number; educacao: number; saude: number }> {
    const orc = await this.prisma.orcamento.findUnique({
      where: { entidadeId_ano: { entidadeId, ano } },
      select: { id: true },
    })
    if (!orc) return { total: 0, educacao: 0, saude: 0 }
    const somaAutorizado = async (where: object) => {
      const agg = await this.prisma.dotacaoDespesa.aggregate({ where: { orcamentoId: orc.id, ...where }, _sum: { valorAutorizado: true } })
      return n(agg._sum.valorAutorizado ?? D0())
    }
    const [total, educacao, saude] = await Promise.all([
      somaAutorizado({}),
      somaAutorizado({ funcao: { codigo: '12' } }),
      somaAutorizado({ funcao: { codigo: '10' } }),
    ])
    return { total, educacao, saude }
  }
}
