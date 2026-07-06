import { PrismaClient } from '@prisma/client'

/**
 * Despesa Total com Pessoal (DTP) para o RGF Anexo 1 (LRF arts. 18-20).
 *
 *   DTP = INCLUSÕES − EXCLUSÕES, sobre a base AUTORIZADA (LOA projetado).
 *   - Inclusões: Pessoal e Encargos (3.1) + terceirização que substitui
 *     servidores (3.3.90.34, "Outras Despesas de Pessoal", art. 18 §1º).
 *   - Exclusões (art. 19 §1º): indenizações por demissão/PDV, decisão judicial
 *     de período anterior, despesas de exercícios anteriores, e inativos/
 *     pensionistas custeados pelo RPPS.
 * Limite: 54% da RCL (Executivo municipal); prudencial 51,3%; alerta 48,6%.
 *
 * Base autorizada (não execução) — mesma escolha da RCL prevista. As naturezas
 * de inclusão/exclusão são parametrizáveis (default em código, igual ao padrão
 * da RCL); ficam fiéis ao TCE quando os marcadores oficiais entrarem. As
 * dotações de Maringá estão no nível de ELEMENTO (3.1.90.94 etc.), então as
 * exclusões são aplicáveis de verdade. Ver [[contabil-rcl-lrf-plano]].
 */

export interface RegraPessoal { rotulo: string; prefixos: string[] }
export interface ComposicaoPessoal { nome: string; inclusoes: RegraPessoal[]; exclusoes: RegraPessoal[] }

export const COMPOSICAO_PESSOAL_STN: ComposicaoPessoal = {
  nome: 'LRF/STN (padrão)',
  inclusoes: [
    { rotulo: 'Pessoal e Encargos Sociais (3.1)', prefixos: ['3.1'] },
    { rotulo: 'Terceirização — substituição de servidores (3.3.90.34)', prefixos: ['3.3.90.34'] },
  ],
  exclusoes: [
    { rotulo: '(−) Indenizações por demissão e PDV (3.1.90.94)', prefixos: ['3.1.90.94'] },
    { rotulo: '(−) Decisão judicial de período anterior (3.1.90.91)', prefixos: ['3.1.90.91'] },
    { rotulo: '(−) Despesas de exercícios anteriores (3.1.x.92)', prefixos: ['3.1.90.92', '3.1.91.92'] },
    { rotulo: '(−) Inativos e pensionistas custeados pelo RPPS (3.1.90.01/03)', prefixos: ['3.1.90.01', '3.1.90.03'] },
  ],
}

/** Composições por Estado (TCE). Deltas sobre a STN; vazio por ora (a STN é boa base). */
export const COMPOSICAO_PESSOAL_POR_ESTADO: Record<string, ComposicaoPessoal> = {}

/** Resolve a composição de pessoal pelo Estado (sigla); cai na STN se não houver delta. */
export function composicaoPessoalDoEstado(sigla: string | null | undefined): ComposicaoPessoal {
  return (sigla && COMPOSICAO_PESSOAL_POR_ESTADO[sigla]) || COMPOSICAO_PESSOAL_STN
}

/** Valida o JSON da composição editável (do banco). Retorna null se inválido/sem inclusões. */
export function parsePessoal(json: unknown): ComposicaoPessoal | null {
  if (!json || typeof json !== 'object') return null
  const o = json as { nome?: unknown; inclusoes?: unknown; exclusoes?: unknown }
  const regras = (arr: unknown): RegraPessoal[] => {
    if (!Array.isArray(arr)) return []
    const out: RegraPessoal[] = []
    for (const r of arr) {
      if (!r || typeof r !== 'object') continue
      const rr = r as { rotulo?: unknown; prefixos?: unknown }
      if (typeof rr.rotulo !== 'string' || !rr.rotulo.trim()) continue
      const prefixos = Array.isArray(rr.prefixos) ? rr.prefixos.filter((p): p is string => typeof p === 'string' && !!p.trim()) : []
      out.push({ rotulo: rr.rotulo.trim(), prefixos })
    }
    return out
  }
  const inclusoes = regras(o.inclusoes)
  if (inclusoes.length === 0) return null
  return {
    nome: typeof o.nome === 'string' && o.nome.trim() ? o.nome.trim() : 'Personalizada (Estado)',
    inclusoes,
    exclusoes: regras(o.exclusoes),
  }
}

/** Composição efetiva: config do Estado > config do Modelo > default do código. Aditivo (modeloJson opcional). */
export function resolverComposicaoPessoal(sigla: string | null | undefined, estadoJson: unknown, modeloJson?: unknown): ComposicaoPessoal {
  return parsePessoal(estadoJson) ?? parsePessoal(modeloJson) ?? composicaoPessoalDoEstado(sigla)
}

export interface LinhaPessoal { rotulo: string; valor: number }
export interface ResultadoPessoal {
  temOrcamento: boolean
  metodologia: string
  inclusoes: LinhaPessoal[]
  inclusoesTotal: number
  exclusoes: LinhaPessoal[]
  exclusoesTotal: number
  despesaLiquida: number // DTP = inclusões − exclusões
}

export interface LinhaPessoalMensal { rotulo: string; mensal: number[]; total: number }
export interface ResultadoPessoalExecutado {
  temExecucao: boolean
  metodologia: string
  inclusoes: LinhaPessoalMensal[]
  inclusoesTotal: number
  exclusoes: LinhaPessoalMensal[]
  exclusoesTotal: number
  dtp: number // executada = inclusões − exclusões (liquidado)
  ultimoMesComDado: number // 1–12; 0 = sem movimento no período
}

const r2 = (n: number) => Math.round(n * 100) / 100
const casa = (cod: string, regra: RegraPessoal) => regra.prefixos.some((px) => cod.startsWith(px))

/** Despesa Total com Pessoal por entidade/exercício, sobre a dotação autorizada. */
export class DespesaPessoalService {
  constructor(private prisma: PrismaClient) {}

  async calcular(entidadeId: string, ano: number, comp: ComposicaoPessoal = COMPOSICAO_PESSOAL_STN): Promise<ResultadoPessoal> {
    const vazio: ResultadoPessoal = {
      temOrcamento: false, metodologia: comp.nome,
      inclusoes: comp.inclusoes.map((r) => ({ rotulo: r.rotulo, valor: 0 })), inclusoesTotal: 0,
      exclusoes: comp.exclusoes.map((r) => ({ rotulo: r.rotulo, valor: 0 })), exclusoesTotal: 0,
      despesaLiquida: 0,
    }
    const orcamento = await this.prisma.orcamento.findUnique({ where: { entidadeId_ano: { entidadeId, ano } }, select: { id: true } })
    if (!orcamento) return vazio

    const dotacoes = await this.prisma.dotacaoDespesa.findMany({
      where: { orcamentoId: orcamento.id },
      select: { valorAutorizado: true, contaDespesa: { select: { codigo: true } } },
    })

    const inc = comp.inclusoes.map(() => 0)
    const exc = comp.exclusoes.map(() => 0)
    for (const d of dotacoes) {
      const cod = d.contaDespesa.codigo
      const v = Number(d.valorAutorizado)
      comp.inclusoes.forEach((r, i) => { if (casa(cod, r)) inc[i]! += v })
      comp.exclusoes.forEach((r, i) => { if (casa(cod, r)) exc[i]! += v })
    }

    const inclusoes = comp.inclusoes.map((r, i) => ({ rotulo: r.rotulo, valor: r2(inc[i]!) }))
    const exclusoes = comp.exclusoes.map((r, i) => ({ rotulo: r.rotulo, valor: r2(exc[i]!) }))
    const inclusoesTotal = r2(inc.reduce((a, b) => a + b, 0))
    const exclusoesTotal = r2(exc.reduce((a, b) => a + b, 0))
    return {
      temOrcamento: true, metodologia: comp.nome,
      inclusoes, inclusoesTotal, exclusoes, exclusoesTotal,
      despesaLiquida: r2(inclusoesTotal - exclusoesTotal),
    }
  }

  /**
   * DTP EXECUTADA (RGF Anexo 1 oficial): despesa liquidada no período, mês a
   * mês, pela mesma composição. Fonte: MovimentoEmpenho LIQUIDACAO −
   * ESTORNO_LIQUIDACAO, casando o código da conta da dotação do empenho.
   * `fimPeriodo` corta o quadrimestre (datas `@db.Date` = meia-noite UTC →
   * mês por getUTCMonth).
   */
  async calcularExecutado(entidadeId: string, ano: number, comp: ComposicaoPessoal = COMPOSICAO_PESSOAL_STN, fimPeriodo?: Date): Promise<ResultadoPessoalExecutado> {
    const fim = fimPeriodo ?? new Date(Date.UTC(ano, 12, 0))
    const movimentos = await this.prisma.movimentoEmpenho.findMany({
      where: {
        entidadeId,
        tipo: { in: ['LIQUIDACAO', 'ESTORNO_LIQUIDACAO'] },
        data: { gte: new Date(Date.UTC(ano, 0, 1)), lte: fim },
      },
      select: {
        tipo: true,
        valor: true,
        data: true,
        empenho: { select: { dotacaoDespesa: { select: { contaDespesa: { select: { codigo: true } } } } } },
      },
    })

    const zeros = () => Array<number>(12).fill(0)
    const inc = comp.inclusoes.map(zeros)
    const exc = comp.exclusoes.map(zeros)
    let ultimoMesComDado = 0
    for (const m of movimentos) {
      const cod = m.empenho.dotacaoDespesa.contaDespesa.codigo
      const mes = m.data.getUTCMonth() // 0–11
      const v = Number(m.valor) * (m.tipo === 'ESTORNO_LIQUIDACAO' ? -1 : 1)
      let casou = false
      comp.inclusoes.forEach((r, i) => { if (casa(cod, r)) { inc[i]![mes] += v; casou = true } })
      comp.exclusoes.forEach((r, i) => { if (casa(cod, r)) { exc[i]![mes] += v; casou = true } })
      if (casou) ultimoMesComDado = Math.max(ultimoMesComDado, mes + 1)
    }

    const linhas = (regras: RegraPessoal[], acc: number[][]): LinhaPessoalMensal[] =>
      regras.map((r, i) => ({
        rotulo: r.rotulo,
        mensal: acc[i]!.map(r2),
        total: r2(acc[i]!.reduce((a, b) => a + b, 0)),
      }))
    const inclusoes = linhas(comp.inclusoes, inc)
    const exclusoes = linhas(comp.exclusoes, exc)
    const inclusoesTotal = r2(inclusoes.reduce((a, l) => a + l.total, 0))
    const exclusoesTotal = r2(exclusoes.reduce((a, l) => a + l.total, 0))
    return {
      temExecucao: ultimoMesComDado > 0,
      metodologia: comp.nome,
      inclusoes, inclusoesTotal, exclusoes, exclusoesTotal,
      dtp: r2(inclusoesTotal - exclusoesTotal),
      ultimoMesComDado,
    }
  }
}
