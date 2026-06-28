import { PrismaClient, Prisma } from '@prisma/client'
import { MemorialRclService } from './memorial-rcl.js'

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

/**
 * Guardião LRF — os indicadores fiscais calculados NO GÊNESIS (fonte única),
 * prontos pra exibir no Oxy. Hoje: RCL (base) + Despesa com Pessoal (% da RCL).
 * Demais indicadores entram conforme o Gênesis ganhar os dados.
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

      // 2) Despesa com Pessoal (% da RCL) — base: dotação autorizada (execução não lançada).
      if (rcl.rcl > 0) {
        const pessoal = await this.pessoalAutorizado(entidadeId, ano)
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
            descricao:
              'Despesa com pessoal (naturezas 3.1) ÷ RCL. Base: dotação autorizada — execução ainda não lançada.',
            baseLegal: 'LRF arts. 19-20 (limite 54% Executivo), 22 (prudencial) e 59 (alerta do TCE).',
            linhas: [
              { item: 'Despesa com pessoal (3.1, autorizado)', valor: pessoal },
              { item: 'RCL', valor: rcl.rcl },
            ],
          },
        })
      }
    }

    return { entidade: rcl.entidade, ano, metodologia: rcl.metodologia, temOrcamento: rcl.temOrcamento, indicadores }
  }

  /** Soma da despesa autorizada nas naturezas de pessoal (código 3.1.x). */
  private async pessoalAutorizado(entidadeId: string, ano: number): Promise<number> {
    const orc = await this.prisma.orcamento.findUnique({
      where: { entidadeId_ano: { entidadeId, ano } },
      select: { id: true },
    })
    if (!orc) return 0
    const agg = await this.prisma.dotacaoDespesa.aggregate({
      where: { orcamentoId: orc.id, contaDespesa: { codigo: { startsWith: '3.1' } } },
      _sum: { valorAutorizado: true },
    })
    return n(agg._sum.valorAutorizado ?? D0())
  }
}
