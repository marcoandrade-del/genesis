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
}
