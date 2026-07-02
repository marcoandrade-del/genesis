import type { PrismaClient, TipoMetaFiscal } from '@prisma/client'

/**
 * Metas Fiscais da LDO (LRF art. 4º §1º) por entidade/exercício, comparadas ao
 * PROJETADO da LOA no banco:
 *   - RECEITA_TOTAL → Σ previsões de receita (orçada bruta)
 *   - DESPESA_TOTAL → Σ dotações autorizadas
 *   - RESULTADO_PRIMARIO / RESULTADO_NOMINAL / DÍVIDA → sem projeção na base
 *     ainda (exigem execução e passivo); o comparativo mostra só a meta.
 * CRUD fino por cima do delegate; a regra é o comparativo.
 * Ver [[lrf-despesa-epico-plano]].
 */

export const ROTULO_META: Record<TipoMetaFiscal, string> = {
  RECEITA_TOTAL: 'Receita Total',
  DESPESA_TOTAL: 'Despesa Total',
  RESULTADO_PRIMARIO: 'Resultado Primário',
  RESULTADO_NOMINAL: 'Resultado Nominal',
  DIVIDA_CONSOLIDADA_LIQUIDA: 'Dívida Consolidada Líquida',
}
export const TIPOS_META = Object.keys(ROTULO_META) as TipoMetaFiscal[]

const r2 = (n: number) => Math.round(n * 100) / 100

export interface LinhaComparativoMeta {
  tipo: TipoMetaFiscal
  rotulo: string
  valorMeta: number
  exercicioReferencia: number
  projetado: number | null // null = sem projeção disponível na base
  diferenca: number | null // projetado − meta
}
export interface ComparativoMetas {
  temMetas: boolean
  linhas: LinhaComparativoMeta[]
}

export class MetasFiscaisService {
  constructor(private prisma: PrismaClient) {}

  listar(entidadeId: string, ano: number) {
    return this.prisma.metaFiscal.findMany({ where: { entidadeId, ano }, orderBy: { tipo: 'asc' } })
  }

  criar(dados: { entidadeId: string; ano: number; tipo: TipoMetaFiscal; valorMeta: number; exercicioReferencia: number }) {
    return this.prisma.metaFiscal.create({ data: dados })
  }

  atualizar(id: string, dados: { valorMeta: number; exercicioReferencia: number }) {
    return this.prisma.metaFiscal.update({ where: { id }, data: dados })
  }

  excluir(id: string) {
    return this.prisma.metaFiscal.delete({ where: { id } })
  }

  /** Metas × projetado da LOA. Só compara o que a base já projeta (receita/despesa). */
  async comparativo(entidadeId: string, ano: number): Promise<ComparativoMetas> {
    const metas = await this.listar(entidadeId, ano)
    if (metas.length === 0) return { temMetas: false, linhas: [] }

    const orcamento = await this.prisma.orcamento.findUnique({
      where: { entidadeId_ano: { entidadeId, ano } },
      select: { id: true },
    })
    let receita: number | null = null
    let despesa: number | null = null
    if (orcamento) {
      const [r, d] = await Promise.all([
        this.prisma.previsaoReceita.aggregate({ where: { orcamentoId: orcamento.id }, _sum: { valorPrevisto: true } }),
        this.prisma.dotacaoDespesa.aggregate({ where: { orcamentoId: orcamento.id }, _sum: { valorAutorizado: true } }),
      ])
      receita = r2(Number(r._sum.valorPrevisto ?? 0))
      despesa = r2(Number(d._sum.valorAutorizado ?? 0))
    }
    const projecao: Partial<Record<TipoMetaFiscal, number | null>> = {
      RECEITA_TOTAL: receita,
      DESPESA_TOTAL: despesa,
    }

    const linhas = metas.map((m) => {
      const projetado = projecao[m.tipo] ?? null
      const valorMeta = r2(Number(m.valorMeta))
      return {
        tipo: m.tipo,
        rotulo: ROTULO_META[m.tipo],
        valorMeta,
        exercicioReferencia: m.exercicioReferencia,
        projetado,
        diferenca: projetado == null ? null : r2(projetado - valorMeta),
      }
    })
    return { temMetas: true, linhas }
  }
}
