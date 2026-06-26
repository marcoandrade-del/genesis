import { PrismaClient } from '@prisma/client'

export interface LinhaPrograma {
  codigo: string
  rotulo: string
  nivel: number // profundidade na hierarquia escolhida (1 = raiz)
  valor: number
}

export interface ProgramaTrabalho {
  temOrcamento: boolean
  total: number
  linhas: LinhaPrograma[]
}

/** Dimensões da funcional-programática que podem compor a hierarquia de um anexo. */
export type DimensaoPrograma = 'uo' | 'funcao' | 'subfuncao' | 'programa' | 'acao'

type DotacaoDim = {
  unidadeOrcamentaria: { codigo: string; nome: string }
  funcao: { codigo: string; nome: string }
  subfuncao: { codigo: string; nome: string }
  programa: { codigo: string; nome: string }
  acao: { codigo: string; nome: string }
}

const DIM: Record<DimensaoPrograma, (d: DotacaoDim) => { cod: string; nome: string }> = {
  uo: (d) => ({ cod: d.unidadeOrcamentaria.codigo, nome: d.unidadeOrcamentaria.nome }),
  funcao: (d) => ({ cod: d.funcao.codigo, nome: d.funcao.nome }),
  subfuncao: (d) => ({ cod: d.subfuncao.codigo, nome: d.subfuncao.nome }),
  programa: (d) => ({ cod: d.programa.codigo, nome: d.programa.nome }),
  acao: (d) => ({ cod: d.acao.codigo, nome: d.acao.nome }),
}

function r2(n: number): number {
  return Math.round(n * 100) / 100
}

// Separador das chaves de caminho. "-" ordena antes dos dígitos (0x2D < 0x30),
// então o pai vem antes dos filhos; e não aparece nos códigos (numéricos) das
// dimensões, evitando colisão entre níveis.
const SEP = '-'

/**
 * Programa de Trabalho (Anexo 6 / QDD): a despesa fixada cruzada pela
 * funcional-programática completa — Unidade Orçamentária → Função → Subfunção
 * → Programa → Ação — com subtotal em cada nível. O valor de cada dotação
 * soma em todos os seus ancestrais; ordenar pelas chaves de caminho (códigos
 * concatenados) já entrega a pré-ordem (pai antes dos filhos).
 */
export class ProgramaTrabalhoService {
  constructor(private prisma: PrismaClient) {}

  /** Anexo 6 / QDD: hierarquia completa UO → Função → Subfunção → Programa → Ação. */
  async calcular(entidadeId: string, ano: number): Promise<ProgramaTrabalho> {
    return this.calcularPor(entidadeId, ano, ['uo', 'funcao', 'subfuncao', 'programa', 'acao'])
  }

  /**
   * Cruza a despesa fixada por uma hierarquia escolhida de dimensões
   * funcional-programáticas, com subtotal em cada nível. O valor de cada dotação
   * soma em todos os seus ancestrais; ordenar pelas chaves de caminho (códigos
   * concatenados) já entrega a pré-ordem (pai antes dos filhos).
   */
  async calcularPor(entidadeId: string, ano: number, dims: DimensaoPrograma[]): Promise<ProgramaTrabalho> {
    const orcamento = await this.prisma.orcamento.findUnique({ where: { entidadeId_ano: { entidadeId, ano } } })
    if (!orcamento) return { temOrcamento: false, total: 0, linhas: [] }

    const dotacoes = await this.prisma.dotacaoDespesa.findMany({
      where: { orcamentoId: orcamento.id },
      include: { unidadeOrcamentaria: true, funcao: true, subfuncao: true, programa: true, acao: true },
    })

    const acc = new Map<string, LinhaPrograma>()
    let total = 0
    for (const d of dotacoes) {
      const v = Number(d.valorAutorizado)
      total += v
      const segs = dims.map((dim) => DIM[dim](d))
      for (let k = 1; k <= segs.length; k++) {
        const key = segs
          .slice(0, k)
          .map((s) => s.cod)
          .join(SEP)
        const cur = acc.get(key) ?? { codigo: segs[k - 1]!.cod, rotulo: segs[k - 1]!.nome, nivel: k, valor: 0 }
        cur.valor += v
        acc.set(key, cur)
      }
    }

    // Chaves de caminho são únicas (nunca iguais); ordena pai-antes-dos-filhos.
    const linhas = [...acc.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([, l]) => ({ ...l, valor: r2(l.valor) }))

    return { temOrcamento: true, total: r2(total), linhas }
  }
}
