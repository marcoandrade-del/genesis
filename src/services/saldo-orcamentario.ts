import type { PrismaClient } from '@prisma/client'

/**
 * Consulta read-only do saldo orçamentário da despesa de uma entidade × exercício.
 *
 * Os campos de saldo já vivem materializados em `DotacaoDespesa`
 * (`valorAutorizado`, `valorReservado`, `valorEmpenhado`), mantidos pelos
 * services de reserva/empenho. Aqui só lemos e agregamos:
 *  - resumo geral do exercício;
 *  - por Unidade Orçamentária, Fonte de Recurso e Função (agrupamentos planos);
 *  - por Conta de Despesa COM roll-up: o saldo de cada dotação soma na sua conta
 *    (folha) e em todos os ancestrais da árvore `ContaDespesaEntidade`.
 *
 * Disponível = autorizado − reservado − empenhado.
 */

export interface LinhaSaldo {
  id: string
  codigo: string
  rotulo: string
  nivel: number
  autorizado: number
  reservado: number
  empenhado: number
  disponivel: number
  origem?: string // só nas linhas por conta (MODELO|DESDOBRAMENTO) — p/ a granularidade do painel
}

export interface SaldoOrcamentario {
  temOrcamento: boolean
  resumo: { autorizado: number; reservado: number; empenhado: number; disponivel: number }
  porUnidade: LinhaSaldo[]
  porFonte: LinhaSaldo[]
  porFuncao: LinhaSaldo[]
  porConta: LinhaSaldo[]
}

/** Arredonda para centavos, evitando deriva de ponto flutuante na soma. */
function r2(n: number): number {
  return Math.round(n * 100) / 100
}

const ZERO = { autorizado: 0, reservado: 0, empenhado: 0 }

export class SaldoOrcamentarioService {
  constructor(private prisma: PrismaClient) {}

  /**
   * @param dataRef quando informado, o empenhado é a posição ATÉ a data (somado
   *   do ledger `MovimentoEmpenho`, EMPENHO − ESTORNO_EMPENHO); senão usa o saldo
   *   materializado (posição atual). Reservas (pré-empenho) não têm ledger datado
   *   → em data passada o reservado é 0.
   */
  async calcular(entidadeId: string, ano: number, dataRef?: Date): Promise<SaldoOrcamentario> {
    const vazio: SaldoOrcamentario = {
      temOrcamento: false,
      resumo: { autorizado: 0, reservado: 0, empenhado: 0, disponivel: 0 },
      porUnidade: [],
      porFonte: [],
      porFuncao: [],
      porConta: [],
    }

    const orcamento = await this.prisma.orcamento.findUnique({ where: { entidadeId_ano: { entidadeId, ano } } })
    if (!orcamento) return vazio

    const dotacoes = await this.prisma.dotacaoDespesa.findMany({
      where: { orcamentoId: orcamento.id },
      include: { unidadeOrcamentaria: true, funcao: true, contaDespesa: true, fonteRecurso: true },
    })

    // Posição "até a data": empenhado por dotação somado do ledger datado.
    let empAteData: Map<string, number> | null = null
    if (dataRef) {
      const movs = await this.prisma.movimentoEmpenho.findMany({
        where: { entidadeId, data: { lte: dataRef }, tipo: { in: ['EMPENHO', 'ESTORNO_EMPENHO'] } },
        select: { valor: true, tipo: true, empenho: { select: { dotacaoDespesaId: true } } },
      })
      empAteData = new Map()
      for (const mv of movs) {
        const did = mv.empenho.dotacaoDespesaId
        if (!did) continue
        const sinal = mv.tipo === 'EMPENHO' ? 1 : -1
        empAteData.set(did, (empAteData.get(did) ?? 0) + sinal * Number(mv.valor))
      }
    }

    // Resumo geral + agrupamentos planos.
    let aut = 0
    let res = 0
    let emp = 0
    const porUO = new Map<string, { codigo: string; rotulo: string; autorizado: number; reservado: number; empenhado: number }>()
    const porFonte = new Map<string, { codigo: string; rotulo: string; autorizado: number; reservado: number; empenhado: number }>()
    const porFuncao = new Map<string, { codigo: string; rotulo: string; autorizado: number; reservado: number; empenhado: number }>()

    const acumular = (
      mapa: Map<string, { codigo: string; rotulo: string; autorizado: number; reservado: number; empenhado: number }>,
      id: string,
      codigo: string,
      rotulo: string,
      a: number,
      rr: number,
      e: number,
    ) => {
      const atual = mapa.get(id) ?? { codigo, rotulo, ...ZERO }
      atual.autorizado += a
      atual.reservado += rr
      atual.empenhado += e
      mapa.set(id, atual)
    }

    // Roll-up por conta: precisa da árvore ContaDespesaEntidade (folha → ancestrais).
    const contas = await this.prisma.contaDespesaEntidade.findMany({
      where: { entidadeId, ano },
      select: { id: true, codigo: true, descricao: true, nivel: true, parentId: true, origem: true },
    })
    const noPorId = new Map(contas.map((c) => [c.id, c]))
    const acumConta = new Map<string, { autorizado: number; reservado: number; empenhado: number }>()

    for (const d of dotacoes) {
      const a = Number(d.valorAutorizado)
      const rr = empAteData ? 0 : Number(d.valorReservado)
      const e = empAteData ? (empAteData.get(d.id) ?? 0) : Number(d.valorEmpenhado)
      aut += a
      res += rr
      emp += e

      acumular(porUO, d.unidadeOrcamentariaId, d.unidadeOrcamentaria.codigo, d.unidadeOrcamentaria.nome, a, rr, e)
      acumular(porFonte, d.fonteRecursoEntidadeId, d.fonteRecurso.codigo, d.fonteRecurso.nomenclatura, a, rr, e)
      acumular(porFuncao, d.funcaoId, d.funcao.codigo, d.funcao.nome, a, rr, e)

      // Roll-up na árvore de contas: a folha e todos os ancestrais recebem o valor.
      let id: string | null = d.contaDespesaEntidadeId
      const visitados = new Set<string>()
      while (id && !visitados.has(id)) {
        visitados.add(id)
        const node = noPorId.get(id)
        if (!node) break
        const acc = acumConta.get(id) ?? { ...ZERO }
        acc.autorizado += a
        acc.reservado += rr
        acc.empenhado += e
        acumConta.set(id, acc)
        id = node.parentId
      }
    }

    const linha = (
      id: string,
      codigo: string,
      rotulo: string,
      nivel: number,
      v: { autorizado: number; reservado: number; empenhado: number },
    ): LinhaSaldo => ({
      id,
      codigo,
      rotulo,
      nivel,
      autorizado: r2(v.autorizado),
      reservado: r2(v.reservado),
      empenhado: r2(v.empenhado),
      disponivel: r2(v.autorizado - v.reservado - v.empenhado),
    })

    const ordenarPorCodigo = (a: LinhaSaldo, b: LinhaSaldo) => a.codigo.localeCompare(b.codigo, 'pt-BR', { numeric: true })

    const porUnidade = [...porUO.entries()]
      .map(([id, v]) => linha(id, v.codigo, v.rotulo, 1, v))
      .sort(ordenarPorCodigo)
    const fontes = [...porFonte.entries()]
      .map(([id, v]) => linha(id, v.codigo, v.rotulo, 1, v))
      .sort(ordenarPorCodigo)
    const funcoes = [...porFuncao.entries()]
      .map(([id, v]) => linha(id, v.codigo, v.rotulo, 1, v))
      .sort(ordenarPorCodigo)

    // Conta: só os nós tocados por alguma dotação, ordenados por código (a árvore
    // emerge pela ordenação hierárquica do código + o nível para indentar).
    const porConta = [...acumConta.entries()]
      .map(([id, v]) => {
        const node = noPorId.get(id)!
        return { ...linha(id, node.codigo, node.descricao, node.nivel, v), origem: node.origem }
      })
      .sort(ordenarPorCodigo)

    return {
      temOrcamento: true,
      resumo: {
        autorizado: r2(aut),
        reservado: r2(res),
        empenhado: r2(emp),
        disponivel: r2(aut - res - emp),
      },
      porUnidade,
      porFonte: fontes,
      porFuncao: funcoes,
      porConta,
    }
  }
}
