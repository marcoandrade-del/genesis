import { PrismaClient, Prisma } from '@prisma/client'

const D0 = () => new Prisma.Decimal(0)

export type LinhaRcl = { codigo: string; rotulo: string; valor: Prisma.Decimal }

export type ResultadoRcl = {
  temOrcamento: boolean
  correntes: LinhaRcl[] // subcategorias da receita corrente (1.x)
  correntesTotal: Prisma.Decimal
  deducoes: LinhaRcl[] // linhas de dedução (nomeadas, conforme o Anexo 3)
  deducoesTotal: Prisma.Decimal
  rcl: Prisma.Decimal
}

/** Uma linha de dedução da RCL: rótulo oficial + naturezas de receita (por prefixo de código). */
export type LinhaDeducaoConfig = { rotulo: string; prefixos: string[] }

/**
 * Composição da RCL — parametrizável por Estado (TCE). O default segue a STN /
 * RREO Anexo 3, com as 3 deduções legais nomeadas; os prefixos de natureza ficam
 * vazios aqui (cada Estado/TCE informa os seus — camada de config futura: UI ou
 * import da planilha de memória de cálculo via IA). Ver [[contabil-rcl-lrf-plano]].
 */
export type ComposicaoRcl = { deducoes: LinhaDeducaoConfig[] }

export const COMPOSICAO_STN: ComposicaoRcl = {
  deducoes: [
    { rotulo: 'Contribuição do Servidor para o Plano de Previdência', prefixos: [] },
    { rotulo: 'Compensação Financeira entre Regimes de Previdência', prefixos: [] },
    { rotulo: 'Dedução de Receita para Formação do FUNDEB', prefixos: [] },
  ],
}

/** Rótulos STN das subcategorias da Receita Corrente (categoria 1). */
const SUBCATEGORIA: Record<string, string> = {
  '1.1': 'Impostos, Taxas e Contribuições de Melhoria',
  '1.2': 'Contribuições',
  '1.3': 'Receita Patrimonial',
  '1.4': 'Receita Agropecuária',
  '1.5': 'Receita Industrial',
  '1.6': 'Receita de Serviços',
  '1.7': 'Transferências Correntes',
  '1.8': 'Transferências Correntes',
  '1.9': 'Outras Receitas Correntes',
}

/**
 * Receita Corrente Líquida (RCL) por entidade: Receitas Correntes (categoria 1)
 * − Deduções legais (LRF art. 2º). No LOA usa a previsão anual; a composição das
 * deduções (quais naturezas e como) vem da config do Estado. Per-entidade — a
 * consolidação do município é uma camada seguinte. Ver [[contabil-rcl-lrf-plano]].
 */
export class RclService {
  constructor(private prisma: PrismaClient) {}

  async calcular(entidadeId: string, ano: number, comp: ComposicaoRcl = COMPOSICAO_STN): Promise<ResultadoRcl> {
    const orcamento = await this.prisma.orcamento.findUnique({
      where: { entidadeId_ano: { entidadeId, ano } },
      select: { id: true },
    })
    if (!orcamento) {
      return { temOrcamento: false, correntes: [], correntesTotal: D0(), deducoes: [], deducoesTotal: D0(), rcl: D0() }
    }

    const previsoes = await this.prisma.previsaoReceita.findMany({
      where: { orcamentoId: orcamento.id },
      select: { valorPrevisto: true, contaReceita: { select: { codigo: true } } },
    })

    const porSub = new Map<string, Prisma.Decimal>()
    const dedValor = comp.deducoes.map(() => D0())
    let correntesTotal = D0()

    for (const p of previsoes) {
      const cod = p.contaReceita.codigo
      const v = p.valorPrevisto
      if (cod.startsWith('1')) {
        correntesTotal = correntesTotal.plus(v)
        const sub = cod.slice(0, 3)
        porSub.set(sub, (porSub.get(sub) ?? D0()).plus(v))
      }
      comp.deducoes.forEach((d, i) => {
        if (d.prefixos.some((px) => cod.startsWith(px))) dedValor[i] = dedValor[i]!.plus(v)
      })
    }

    const correntes = [...porSub.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([codigo, valor]) => ({ codigo, rotulo: SUBCATEGORIA[codigo] ?? 'Receitas Correntes', valor }))

    const deducoes = comp.deducoes.map((d, i) => ({ codigo: '', rotulo: d.rotulo, valor: dedValor[i]! }))
    const deducoesTotal = dedValor.reduce((acc, v) => acc.plus(v), D0())

    return {
      temOrcamento: true,
      correntes,
      correntesTotal,
      deducoes,
      deducoesTotal,
      rcl: correntesTotal.minus(deducoesTotal),
    }
  }
}
