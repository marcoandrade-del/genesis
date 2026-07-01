import { PrismaClient, Prisma } from '@prisma/client'

const D0 = () => new Prisma.Decimal(0)

// valor = previsto (LOA); valorRealizado = arrecadado (execução, mesma natureza/dedução)
export type LinhaRcl = { codigo: string; rotulo: string; valor: Prisma.Decimal; valorRealizado: Prisma.Decimal }

export type ResultadoRcl = {
  temOrcamento: boolean
  correntes: LinhaRcl[] // subcategorias da receita corrente (1.x)
  correntesTotal: Prisma.Decimal
  deducoes: LinhaRcl[] // linhas de dedução (nomeadas, conforme o Anexo 3)
  deducoesTotal: Prisma.Decimal
  rcl: Prisma.Decimal
  // Execução (arrecadado) — RCL EXECUTADA, ao lado da prevista. Aditivo.
  correntesRealizadoTotal: Prisma.Decimal
  deducoesRealizadoTotal: Prisma.Decimal
  rclRealizado: Prisma.Decimal
}

/** Uma linha de dedução da RCL: rótulo oficial + naturezas de receita (por prefixo de código). */
export type LinhaDeducaoConfig = { rotulo: string; prefixos: string[] }

/**
 * Composição da RCL — parametrizável por Estado (TCE). O default segue a STN /
 * RREO Anexo 3, com as 3 deduções legais nomeadas; os prefixos de natureza ficam
 * vazios aqui (cada Estado/TCE informa os seus — camada de config futura: UI ou
 * import da planilha de memória de cálculo via IA). Ver [[contabil-rcl-lrf-plano]].
 */
export type ComposicaoRcl = { nome: string; deducoes: LinhaDeducaoConfig[] }

export const COMPOSICAO_STN: ComposicaoRcl = {
  nome: 'STN (padrão)',
  deducoes: [
    { rotulo: 'Contribuição do Servidor para o Plano de Previdência', prefixos: [] },
    { rotulo: 'Compensação Financeira entre Regimes de Previdência', prefixos: [] },
    { rotulo: 'Dedução de Receita para Formação do FUNDEB', prefixos: [] },
  ],
}

/**
 * Composições por Estado (TCE). Deltas sobre a STN, com os prefixos de natureza
 * que cada TCE usa. PR extraído do RREO Anexo 3 do TCE-PR (memória de cálculo) —
 * aproximação por código de natureza (os marcadores internos do TCE e a receita
 * realizada não estão disponíveis aqui). Ver [[contabil-rcl-lrf-plano]].
 */
export const COMPOSICAO_POR_ESTADO: Record<string, ComposicaoRcl> = {
  PR: {
    nome: 'TCE-PR (aproximação por natureza)',
    deducoes: [
      { rotulo: 'Contribuição do Servidor para o Plano de Previdência', prefixos: ['1.2.1.5'] },
      { rotulo: 'Compensação Financeira entre Regimes de Previdência', prefixos: ['1.3.2.1.04'] },
      { rotulo: 'Dedução de Receita para Formação do FUNDEB', prefixos: ['1.7.5.1.50', '1.7.1.1.50', '1.7.1.1.53'] },
    ],
  },
}

/** Resolve a composição da RCL pelo Estado (sigla); cai na STN se não houver delta. */
export function composicaoDoEstado(sigla: string | null | undefined): ComposicaoRcl {
  return (sigla && COMPOSICAO_POR_ESTADO[sigla]) || COMPOSICAO_STN
}

/** Valida o JSON da composição editável (vindo do banco). Retorna null se inválido/ausente. */
export function parseComposicao(json: unknown): ComposicaoRcl | null {
  if (!json || typeof json !== 'object') return null
  const o = json as { nome?: unknown; deducoes?: unknown }
  if (!Array.isArray(o.deducoes)) return null
  const deducoes: LinhaDeducaoConfig[] = []
  for (const d of o.deducoes) {
    if (!d || typeof d !== 'object') continue
    const dd = d as { rotulo?: unknown; prefixos?: unknown }
    if (typeof dd.rotulo !== 'string' || !dd.rotulo.trim()) continue
    const prefixos = Array.isArray(dd.prefixos) ? dd.prefixos.filter((p): p is string => typeof p === 'string') : []
    deducoes.push({ rotulo: dd.rotulo.trim(), prefixos })
  }
  if (deducoes.length === 0) return null
  return { nome: typeof o.nome === 'string' && o.nome.trim() ? o.nome.trim() : 'Personalizada (Estado)', deducoes }
}

/**
 * Composição efetiva: a config EDITÁVEL do Estado (JSON do banco) tem prioridade;
 * sem ela, cai no default do código (delta do Estado ou STN).
 */
export function resolverComposicao(sigla: string | null | undefined, estadoJson: unknown, modeloJson?: unknown): ComposicaoRcl {
  return parseComposicao(estadoJson) ?? parseComposicao(modeloJson) ?? composicaoDoEstado(sigla)
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
      return {
        temOrcamento: false, correntes: [], correntesTotal: D0(), deducoes: [], deducoesTotal: D0(), rcl: D0(),
        correntesRealizadoTotal: D0(), deducoesRealizadoTotal: D0(), rclRealizado: D0(),
      }
    }

    const previsoes = await this.prisma.previsaoReceita.findMany({
      where: { orcamentoId: orcamento.id },
      select: { valorPrevisto: true, valorArrecadado: true, contaReceita: { select: { codigo: true } } },
    })

    const porSub = new Map<string, Prisma.Decimal>()
    const porSubReal = new Map<string, Prisma.Decimal>()
    const dedValor = comp.deducoes.map(() => D0())
    const dedReal = comp.deducoes.map(() => D0())
    let correntesTotal = D0()
    let correntesRealizadoTotal = D0()

    for (const p of previsoes) {
      const cod = p.contaReceita.codigo
      const v = p.valorPrevisto
      const a = p.valorArrecadado ?? D0()
      if (cod.startsWith('1')) {
        correntesTotal = correntesTotal.plus(v)
        correntesRealizadoTotal = correntesRealizadoTotal.plus(a)
        const sub = cod.slice(0, 3)
        porSub.set(sub, (porSub.get(sub) ?? D0()).plus(v))
        porSubReal.set(sub, (porSubReal.get(sub) ?? D0()).plus(a))
      }
      comp.deducoes.forEach((d, i) => {
        if (d.prefixos.some((px) => cod.startsWith(px))) {
          dedValor[i] = dedValor[i]!.plus(v)
          dedReal[i] = dedReal[i]!.plus(a)
        }
      })
    }

    const correntes = [...porSub.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([codigo, valor]) => ({ codigo, rotulo: SUBCATEGORIA[codigo] ?? 'Receitas Correntes', valor, valorRealizado: porSubReal.get(codigo) ?? D0() }))

    const deducoes = comp.deducoes.map((d, i) => ({ codigo: '', rotulo: d.rotulo, valor: dedValor[i]!, valorRealizado: dedReal[i]! }))
    const deducoesTotal = dedValor.reduce((acc, v) => acc.plus(v), D0())
    const deducoesRealizadoTotal = dedReal.reduce((acc, v) => acc.plus(v), D0())

    return {
      temOrcamento: true,
      correntes,
      correntesTotal,
      deducoes,
      deducoesTotal,
      rcl: correntesTotal.minus(deducoesTotal),
      correntesRealizadoTotal,
      deducoesRealizadoTotal,
      rclRealizado: correntesRealizadoTotal.minus(deducoesRealizadoTotal),
    }
  }
}
