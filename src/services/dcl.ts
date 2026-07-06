import { PrismaClient } from '@prisma/client'
import { RgfCadastrosService } from './rgf-cadastros.js'
import { DisponibilidadeFonteService } from './disponibilidade-fonte.js'

/**
 * Dívida Consolidada Líquida (RGF Anexo 2, MDF 9ª ed.):
 *
 *   DCL = Dívida Consolidada (cadastro DividaItem) − deduções
 *   deduções = disponibilidade de caixa bruta + demais haveres (0 no MVP)
 *              − restos a pagar processados
 *
 * As deduções vêm do MESMO cálculo do Anexo 5 (DisponibilidadeFonteService) —
 * consistência entre anexos. A DCL informada na LDO (MetaFiscal) entra como
 * linha comparativa, nunca como fonte do cálculo: Δ ≠ 0 é informação (a base
 * ainda não tem os saldos bancários reais).
 * Limite: 120% da RCL (Res. Senado 40/2001); alerta 108% (LRF art. 59 §1º).
 */

export interface ResultadoDcl {
  dividaPorCategoria: { rotulo: string; total: number }[]
  dividaTotal: number // (I)
  deducoes: { caixa: number; rpProcessados: number; total: number } // (II)
  dcl: number // (III) = I − II
  metaLdo: number | null // DCL informada na LDO (comparativo)
  temDivida: boolean // há itens no cadastro?
}

const r2 = (n: number) => Math.round(n * 100) / 100

export class DclService {
  private cadastros: RgfCadastrosService
  private disponibilidade: DisponibilidadeFonteService

  constructor(private prisma: PrismaClient) {
    this.cadastros = new RgfCadastrosService(prisma)
    this.disponibilidade = new DisponibilidadeFonteService(prisma)
  }

  async calcular(entidadeId: string, ano: number): Promise<ResultadoDcl> {
    const [totais, disp, meta] = await Promise.all([
      this.cadastros.totais(entidadeId, ano),
      this.disponibilidade.calcular(entidadeId, ano),
      this.prisma.metaFiscal.findUnique({
        where: { entidadeId_ano_tipo: { entidadeId, ano, tipo: 'DIVIDA_CONSOLIDADA_LIQUIDA' } },
        select: { valorMeta: true },
      }),
    ])
    const caixa = disp.totais.caixa
    const rpProcessados = disp.totais.rpProcessados
    const deducoesTotal = r2(caixa - rpProcessados)
    return {
      dividaPorCategoria: totais.divida.porCategoria.map((c) => ({ rotulo: c.rotulo, total: c.total })),
      dividaTotal: totais.divida.total,
      deducoes: { caixa: r2(caixa), rpProcessados: r2(rpProcessados), total: deducoesTotal },
      dcl: r2(totais.divida.total - deducoesTotal),
      metaLdo: meta ? Number(meta.valorMeta) : null,
      temDivida: totais.divida.total > 0,
    }
  }
}
