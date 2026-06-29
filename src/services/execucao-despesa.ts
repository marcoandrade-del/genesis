import type { PrismaClient } from '@prisma/client'

/**
 * Execução da despesa pela codificação orçamentária COMPLETA: a despesa cruzada
 * pela funcional-programática (UO → Função → Subfunção → Programa → Ação) +
 * natureza, e também por Fonte de Recurso e por Função, mostrando os estágios
 * Autorizado / Empenhado / Liquidado / Pago (e os saldos a executar). Read-only.
 *
 * Autorizado vem de `DotacaoDespesa.valorAutorizado`; empenhado/liquidado/pago
 * vêm do ledger `MovimentoEmpenho` (sinal por tipo, igual ao despesa-diaria),
 * somados por dotação e com roll-up por dimensão. `dataRef` = posição até a data.
 */

export interface LinhaExec {
  codigo: string
  rotulo: string
  nivel: number
  autorizado: number
  empenhado: number
  aEmpenhar: number
  liquidado: number
  aLiquidar: number
  pago: number
  aPagar: number
  origem?: string // só em porNatureza (MODELO|DESDOBRAMENTO) — p/ granularidade
}

export interface ExecucaoDespesa {
  temOrcamento: boolean
  resumo: { autorizado: number; empenhado: number; liquidado: number; pago: number }
  porFP: LinhaExec[]
  porFonte: LinhaExec[]
  porFuncao: LinhaExec[]
  porNatureza: LinhaExec[]
}

const r2 = (n: number) => Math.round(n * 100) / 100
// Separador das chaves de caminho da FP: "-" ordena antes dos dígitos e não
// aparece nos códigos (numéricos/pontuados) das dimensões — pai antes dos filhos.
const SEP = '-'

type Estagios = { autorizado: number; empenhado: number; liquidado: number; pago: number }

export class ExecucaoDespesaService {
  constructor(private prisma: PrismaClient) {}

  async calcular(entidadeId: string, ano: number, dataRef?: Date): Promise<ExecucaoDespesa> {
    const vazio: ExecucaoDespesa = {
      temOrcamento: false,
      resumo: { autorizado: 0, empenhado: 0, liquidado: 0, pago: 0 },
      porFP: [],
      porFonte: [],
      porFuncao: [],
      porNatureza: [],
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

    // Árvore de contas (natureza) para roll-up.
    const contas = await this.prisma.contaDespesaEntidade.findMany({
      where: { entidadeId, ano },
      select: { id: true, codigo: true, descricao: true, nivel: true, parentId: true, origem: true },
    })
    const noConta = new Map(contas.map((c) => [c.id, c]))

    const novo = (codigo: string, rotulo: string, nivel: number): LinhaExec => ({
      codigo, rotulo, nivel, autorizado: 0, empenhado: 0, aEmpenhar: 0, liquidado: 0, aLiquidar: 0, pago: 0, aPagar: 0,
    })
    const soma = (l: LinhaExec, e: Estagios) => {
      l.autorizado += e.autorizado
      l.empenhado += e.empenhado
      l.liquidado += e.liquidado
      l.pago += e.pago
    }

    const resumo = { autorizado: 0, empenhado: 0, liquidado: 0, pago: 0 }
    const accFP = new Map<string, LinhaExec>()
    const accFonte = new Map<string, LinhaExec>()
    const accFuncao = new Map<string, LinhaExec>()
    const accNat = new Map<string, LinhaExec>()

    for (const d of dotacoes) {
      const ex = execDot.get(d.id) ?? { empenhado: 0, liquidado: 0, pago: 0 }
      const e: Estagios = { autorizado: Number(d.valorAutorizado), empenhado: ex.empenhado, liquidado: ex.liquidado, pago: ex.pago }
      resumo.autorizado += e.autorizado
      resumo.empenhado += e.empenhado
      resumo.liquidado += e.liquidado
      resumo.pago += e.pago

      // Funcional-programática + natureza, com roll-up por chave de caminho.
      const segs = [
        { cod: d.unidadeOrcamentaria.codigo, nome: d.unidadeOrcamentaria.nome },
        { cod: d.funcao.codigo, nome: d.funcao.nome },
        { cod: d.subfuncao.codigo, nome: d.subfuncao.nome },
        { cod: d.programa.codigo, nome: d.programa.nome },
        { cod: d.acao.codigo, nome: d.acao.nome },
        { cod: d.contaDespesa.codigo, nome: d.contaDespesa.descricao },
      ]
      for (let k = 1; k <= segs.length; k++) {
        const key = segs.slice(0, k).map((s) => s.cod).join(SEP)
        const cur = accFP.get(key) ?? novo(segs[k - 1]!.cod, segs[k - 1]!.nome, k)
        soma(cur, e)
        accFP.set(key, cur)
      }
      // Fonte (plano) e Função (plano).
      const cf = accFonte.get(d.fonteRecurso.codigo) ?? novo(d.fonteRecurso.codigo, d.fonteRecurso.nomenclatura, 1)
      soma(cf, e); accFonte.set(d.fonteRecurso.codigo, cf)
      const cfu = accFuncao.get(d.funcao.codigo) ?? novo(d.funcao.codigo, d.funcao.nome, 1)
      soma(cfu, e); accFuncao.set(d.funcao.codigo, cfu)
      // Natureza: roll-up na árvore (folha → ancestrais).
      let id: string | null = d.contaDespesaEntidadeId
      const vis = new Set<string>()
      while (id && !vis.has(id)) {
        vis.add(id)
        const node = noConta.get(id)
        if (!node) break
        const cn = accNat.get(id) ?? novo(node.codigo, node.descricao, node.nivel)
        if (!cn.origem) cn.origem = node.origem
        soma(cn, e)
        accNat.set(id, cn)
        id = node.parentId
      }
    }

    const finalize = (l: LinhaExec): LinhaExec => ({
      ...l,
      autorizado: r2(l.autorizado),
      empenhado: r2(l.empenhado),
      liquidado: r2(l.liquidado),
      pago: r2(l.pago),
      aEmpenhar: r2(l.autorizado - l.empenhado),
      aLiquidar: r2(l.empenhado - l.liquidado),
      aPagar: r2(l.liquidado - l.pago),
    })
    const ordCod = (a: LinhaExec, b: LinhaExec) => a.codigo.localeCompare(b.codigo, 'pt-BR', { numeric: true })

    return {
      temOrcamento: true,
      resumo: { autorizado: r2(resumo.autorizado), empenhado: r2(resumo.empenhado), liquidado: r2(resumo.liquidado), pago: r2(resumo.pago) },
      porFP: [...accFP.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([, l]) => finalize(l)),
      porFonte: [...accFonte.values()].map(finalize).sort(ordCod),
      porFuncao: [...accFuncao.values()].map(finalize).sort(ordCod),
      porNatureza: [...accNat.values()].map(finalize).sort(ordCod),
    }
  }
}
