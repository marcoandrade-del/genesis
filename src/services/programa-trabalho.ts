import { PrismaClient } from '@prisma/client'

export interface LinhaPrograma {
  codigo: string
  rotulo: string
  nivel: number // 1=UO, 2=função, 3=subfunção, 4=programa, 5=ação
  valor: number
}

export interface ProgramaTrabalho {
  temOrcamento: boolean
  total: number
  linhas: LinhaPrograma[]
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

  async calcular(entidadeId: string, ano: number): Promise<ProgramaTrabalho> {
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
      const segs = [
        { cod: d.unidadeOrcamentaria.codigo, nome: d.unidadeOrcamentaria.nome },
        { cod: d.funcao.codigo, nome: d.funcao.nome },
        { cod: d.subfuncao.codigo, nome: d.subfuncao.nome },
        { cod: d.programa.codigo, nome: d.programa.nome },
        { cod: d.acao.codigo, nome: d.acao.nome },
      ]
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
