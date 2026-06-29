import type { PrismaClient } from '@prisma/client'

/**
 * Execução da despesa pela codificação orçamentária COMPLETA, como árvore de
 * dotações desdobrável por linha:
 *   Unidade Orçamentária → Função/Subfunção → Programa/Ação → dotação (Natureza + Fonte).
 * Cada nó traz Autorizado / Empenhado / Liquidado / Pago (e os saldos a executar),
 * com roll-up dos filhos. Read-only. `dataRef` = posição até a data.
 *
 * Autorizado vem de `DotacaoDespesa.valorAutorizado`; empenhado/liquidado/pago do
 * ledger `MovimentoEmpenho` (sinal por tipo, igual ao despesa-diaria).
 */

export interface LinhaDotacao {
  path: string
  parentPath: string | null
  nivel: number // 1=UO · 2=Função/Subf · 3=Programa/Ação · 4=dotação (natureza+fonte)
  uo: string
  funcaoSubf: string
  programaAcao: string
  natureza: string
  fonte: string
  rotulo: string // descrição do nível (nome da UO/função/ação/natureza)
  temFilhos: boolean
  autorizado: number
  empenhado: number
  aEmpenhar: number
  liquidado: number
  aLiquidar: number
  pago: number
  aPagar: number
}

export interface ExecucaoDespesa {
  temOrcamento: boolean
  resumo: { autorizado: number; empenhado: number; liquidado: number; pago: number }
  dotacoes: LinhaDotacao[]
  totalDotacoes: number // nº de dotações (folhas)
}

const r2 = (n: number) => Math.round(n * 100) / 100
const SEP = '|' // separa segmentos do path; não aparece nos códigos (numéricos/pontuados)

type No = {
  path: string
  parentPath: string | null
  nivel: number
  cod: string // código do segmento (para a coluna do nível)
  rotulo: string
  temFilhos: boolean
  autorizado: number
  empenhado: number
  liquidado: number
  pago: number
}

export class ExecucaoDespesaService {
  constructor(private prisma: PrismaClient) {}

  async calcular(entidadeId: string, ano: number, dataRef?: Date): Promise<ExecucaoDespesa> {
    const vazio: ExecucaoDespesa = {
      temOrcamento: false,
      resumo: { autorizado: 0, empenhado: 0, liquidado: 0, pago: 0 },
      dotacoes: [],
      totalDotacoes: 0,
    }
    const orcamento = await this.prisma.orcamento.findUnique({ where: { entidadeId_ano: { entidadeId, ano } }, select: { id: true } })
    if (!orcamento) return vazio

    const dotacoes = await this.prisma.dotacaoDespesa.findMany({
      where: { orcamentoId: orcamento.id },
      include: { unidadeOrcamentaria: true, funcao: true, subfuncao: true, programa: true, acao: true, fonteRecurso: true, contaDespesa: true },
    })

    // Execução por dotação: soma o ledger MovimentoEmpenho (sinal por tipo) até a data.
    const ate = dataRef ?? new Date(Date.UTC(ano, 11, 31))
    const movs = await this.prisma.movimentoEmpenho.findMany({
      where: { entidadeId, data: { lte: ate } },
      select: { tipo: true, valor: true, empenho: { select: { dotacaoDespesaId: true } } },
    })
    const execDot = new Map<string, { empenhado: number; liquidado: number; pago: number }>()
    for (const mv of movs) {
      const did = mv.empenho.dotacaoDespesaId
      if (!did) continue
      const e = execDot.get(did) ?? { empenhado: 0, liquidado: 0, pago: 0 }
      const v = Number(mv.valor)
      if (mv.tipo === 'EMPENHO') e.empenhado += v
      else if (mv.tipo === 'ESTORNO_EMPENHO') e.empenhado -= v
      else if (mv.tipo === 'LIQUIDACAO') e.liquidado += v
      else if (mv.tipo === 'ESTORNO_LIQUIDACAO') e.liquidado -= v
      else if (mv.tipo === 'PAGAMENTO') e.pago += v
      else if (mv.tipo === 'ESTORNO_PAGAMENTO') e.pago -= v
      execDot.set(did, e)
    }

    const resumo = { autorizado: 0, empenhado: 0, liquidado: 0, pago: 0 }
    const nos = new Map<string, No>()
    let totalDotacoes = 0

    const acumular = (path: string, parentPath: string | null, nivel: number, cod: string, rotulo: string, e: { autorizado: number; empenhado: number; liquidado: number; pago: number }) => {
      const n = nos.get(path) ?? { path, parentPath, nivel, cod, rotulo, temFilhos: nivel < 4, autorizado: 0, empenhado: 0, liquidado: 0, pago: 0 }
      n.autorizado += e.autorizado
      n.empenhado += e.empenhado
      n.liquidado += e.liquidado
      n.pago += e.pago
      nos.set(path, n)
    }

    for (const d of dotacoes) {
      totalDotacoes++
      const ex = execDot.get(d.id) ?? { empenhado: 0, liquidado: 0, pago: 0 }
      const e = { autorizado: Number(d.valorAutorizado), empenhado: ex.empenhado, liquidado: ex.liquidado, pago: ex.pago }
      resumo.autorizado += e.autorizado
      resumo.empenhado += e.empenhado
      resumo.liquidado += e.liquidado
      resumo.pago += e.pago

      const uoCod = d.unidadeOrcamentaria.codigo
      const fsCod = `${d.funcao.codigo}.${d.subfuncao.codigo}`
      const paCod = `${d.programa.codigo}.${d.acao.codigo}`
      const natCod = d.contaDespesa.codigo
      const fonte = d.fonteRecurso.codigo

      const p1 = uoCod
      const p2 = `${p1}${SEP}${fsCod}`
      const p3 = `${p2}${SEP}${paCod}`
      const p4 = `${p3}${SEP}${natCod}#${fonte}`
      acumular(p1, null, 1, uoCod, d.unidadeOrcamentaria.nome, e)
      acumular(p2, p1, 2, fsCod, `${d.funcao.nome} / ${d.subfuncao.nome}`, e)
      acumular(p3, p2, 3, paCod, d.acao.nome, e)
      acumular(p4, p3, 4, natCod, d.contaDespesa.descricao, e)
      // a folha (dotação) carrega natureza + fonte nas suas colunas próprias.
      const folha = nos.get(p4)!
      folha.temFilhos = false
      ;(folha as No & { fonte?: string }).fonte = fonte
    }

    // Pré-ordem (pai antes dos filhos) pela ordenação das chaves de caminho.
    const ordenadas = [...nos.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    const linhas: LinhaDotacao[] = ordenadas.map((n) => {
      const fonte = (n as No & { fonte?: string }).fonte ?? ''
      return {
        path: n.path,
        parentPath: n.parentPath,
        nivel: n.nivel,
        uo: n.nivel === 1 ? n.cod : '',
        funcaoSubf: n.nivel === 2 ? n.cod : '',
        programaAcao: n.nivel === 3 ? n.cod : '',
        natureza: n.nivel === 4 ? n.cod : '',
        fonte: n.nivel === 4 ? fonte : '',
        rotulo: n.rotulo,
        temFilhos: n.temFilhos,
        autorizado: r2(n.autorizado),
        empenhado: r2(n.empenhado),
        aEmpenhar: r2(n.autorizado - n.empenhado),
        liquidado: r2(n.liquidado),
        aLiquidar: r2(n.empenhado - n.liquidado),
        pago: r2(n.pago),
        aPagar: r2(n.liquidado - n.pago),
      }
    })

    return {
      temOrcamento: true,
      resumo: { autorizado: r2(resumo.autorizado), empenhado: r2(resumo.empenhado), liquidado: r2(resumo.liquidado), pago: r2(resumo.pago) },
      dotacoes: linhas,
      totalDotacoes,
    }
  }
}
