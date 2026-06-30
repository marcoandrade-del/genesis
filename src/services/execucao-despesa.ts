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
  nivel: number // 1=Órgão · 2=UO · 3=Função/Subf · 4=Programa/Ação · 5=dotação (natureza+fonte)
  orgao: string
  uo: string
  funcaoSubf: string
  programaAcao: string
  natureza: string
  fonte: string
  rotulo: string // descrição do nível (nome do órgão/UO/função/ação/natureza)
  temFilhos: boolean
  autorizado: number
  empenhado: number
  aEmpenhar: number
  liquidado: number
  aLiquidar: number
  pago: number
  aPagar: number
  dotacaoId?: string // só na folha (nível 5): a dotação única (p/ drill de lançamentos)
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
  fonte?: string // só na folha
  dotacaoId?: string // só na folha
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
      include: { unidadeOrcamentaria: { include: { orgao: true } }, funcao: true, subfuncao: true, programa: true, acao: true, fonteRecurso: true, contaDespesa: true },
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
      const n = nos.get(path) ?? { path, parentPath, nivel, cod, rotulo, temFilhos: nivel < 5, autorizado: 0, empenhado: 0, liquidado: 0, pago: 0 }
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

      const orgaoCod = d.unidadeOrcamentaria.orgao?.codigo ?? (d.unidadeOrcamentaria.codigo.split('.')[0] ?? d.unidadeOrcamentaria.codigo)
      const orgaoNome = d.unidadeOrcamentaria.orgao?.nome ?? `Órgão ${orgaoCod}`
      const uoCod = d.unidadeOrcamentaria.codigo
      const fsCod = `${d.funcao.codigo}.${d.subfuncao.codigo}`
      const paCod = `${d.programa.codigo}.${d.acao.codigo}`
      const natCod = d.contaDespesa.codigo
      const fonte = d.fonteRecurso.codigo

      const p1 = orgaoCod
      const p2 = `${p1}${SEP}${uoCod}`
      const p3 = `${p2}${SEP}${fsCod}`
      const p4 = `${p3}${SEP}${paCod}`
      const p5 = `${p4}${SEP}${natCod}#${fonte}`
      acumular(p1, null, 1, orgaoCod, orgaoNome, e)
      acumular(p2, p1, 2, uoCod, d.unidadeOrcamentaria.nome, e)
      acumular(p3, p2, 3, fsCod, `${d.funcao.nome} / ${d.subfuncao.nome}`, e)
      acumular(p4, p3, 4, paCod, d.acao.nome, e)
      acumular(p5, p4, 5, natCod, d.contaDespesa.descricao, e)
      // a folha (dotação) carrega natureza + fonte nas suas colunas próprias.
      const folha = nos.get(p5)!
      folha.temFilhos = false
      folha.fonte = fonte
      folha.dotacaoId = d.id
    }

    // Pré-ordem (pai antes dos filhos) pela ordenação das chaves de caminho.
    const ordenadas = [...nos.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    const linhas: LinhaDotacao[] = ordenadas.map((n) => {
      const fonte = n.fonte ?? ''
      return {
        path: n.path,
        parentPath: n.parentPath,
        nivel: n.nivel,
        orgao: n.nivel === 1 ? n.cod : '',
        uo: n.nivel === 2 ? n.cod : '',
        funcaoSubf: n.nivel === 3 ? n.cod : '',
        programaAcao: n.nivel === 4 ? n.cod : '',
        natureza: n.nivel === 5 ? n.cod : '',
        fonte: n.nivel === 5 ? fonte : '',
        ...(n.dotacaoId ? { dotacaoId: n.dotacaoId } : {}),
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

  /**
   * Série MENSAL (empenhado/liquidado/pago por mês) de um NÓ da árvore (por `path`):
   * agrega as dotações cujo caminho começa pelo path. Read-only. null = path inexistente.
   */
  async mensal(entidadeId: string, ano: number, path: string): Promise<{ empenhadoMensal: number[]; liquidadoMensal: number[]; pagoMensal: number[] } | null> {
    const orcamento = await this.prisma.orcamento.findUnique({ where: { entidadeId_ano: { entidadeId, ano } }, select: { id: true } })
    if (!orcamento) return null
    const dotacoes = await this.prisma.dotacaoDespesa.findMany({
      where: { orcamentoId: orcamento.id },
      select: { id: true, unidadeOrcamentaria: { select: { codigo: true, orgao: { select: { codigo: true } } } }, funcao: { select: { codigo: true } }, subfuncao: { select: { codigo: true } }, programa: { select: { codigo: true } }, acao: { select: { codigo: true } }, contaDespesa: { select: { codigo: true } }, fonteRecurso: { select: { codigo: true } } },
    })
    const ids = new Set<string>()
    for (const d of dotacoes) {
      const orgaoCod = d.unidadeOrcamentaria.orgao?.codigo ?? (d.unidadeOrcamentaria.codigo.split('.')[0] ?? d.unidadeOrcamentaria.codigo)
      const p5 = `${orgaoCod}${SEP}${d.unidadeOrcamentaria.codigo}${SEP}${d.funcao.codigo}.${d.subfuncao.codigo}${SEP}${d.programa.codigo}.${d.acao.codigo}${SEP}${d.contaDespesa.codigo}#${d.fonteRecurso.codigo}`
      if (p5 === path || p5.startsWith(path + SEP)) ids.add(d.id)
    }
    if (ids.size === 0) return null
    const movs = await this.prisma.movimentoEmpenho.findMany({
      where: { entidadeId, data: { gte: new Date(Date.UTC(ano, 0, 1)), lte: new Date(Date.UTC(ano, 11, 31)) }, empenho: { dotacaoDespesaId: { in: [...ids] } } },
      select: { tipo: true, valor: true, data: true },
    })
    const emp = new Array<number>(12).fill(0)
    const liq = new Array<number>(12).fill(0)
    const pag = new Array<number>(12).fill(0)
    for (const mv of movs) {
      const m = mv.data.getUTCMonth()
      const v = Number(mv.valor)
      if (mv.tipo === 'EMPENHO') emp[m] = (emp[m] ?? 0) + v
      else if (mv.tipo === 'ESTORNO_EMPENHO') emp[m] = (emp[m] ?? 0) - v
      else if (mv.tipo === 'LIQUIDACAO') liq[m] = (liq[m] ?? 0) + v
      else if (mv.tipo === 'ESTORNO_LIQUIDACAO') liq[m] = (liq[m] ?? 0) - v
      else if (mv.tipo === 'PAGAMENTO') pag[m] = (pag[m] ?? 0) + v
      else if (mv.tipo === 'ESTORNO_PAGAMENTO') pag[m] = (pag[m] ?? 0) - v
    }
    return { empenhadoMensal: emp.map(r2), liquidadoMensal: liq.map(r2), pagoMensal: pag.map(r2) }
  }

  /**
   * Lançamentos (ledger MovimentoEmpenho) de UMA dotação, em ordem cronológica.
   * Valida que a dotação é da entidade. null = não encontrada / de outra entidade.
   */
  async lancamentos(entidadeId: string, dotacaoId: string): Promise<{ dotacao: { codigo: string; natureza: string; orgao: string; fonte: string }; movimentos: { data: Date; tipo: string; valor: number; documento: string }[] } | null> {
    const dot = await this.prisma.dotacaoDespesa.findUnique({
      where: { id: dotacaoId },
      select: { orcamento: { select: { entidadeId: true } }, unidadeOrcamentaria: { select: { codigo: true, nome: true } }, funcao: { select: { codigo: true } }, contaDespesa: { select: { codigo: true, descricao: true } }, fonteRecurso: { select: { codigo: true, nomenclatura: true } } },
    })
    if (!dot || dot.orcamento.entidadeId !== entidadeId) return null
    const movs = await this.prisma.movimentoEmpenho.findMany({
      where: { empenho: { dotacaoDespesaId: dotacaoId } },
      orderBy: [{ data: 'asc' }, { criadoEm: 'asc' }],
      select: { data: true, tipo: true, valor: true, documento: true, empenho: { select: { numero: true } }, liquidacao: { select: { numero: true } }, ordemPagamento: { select: { numero: true } } },
    })
    return {
      dotacao: {
        codigo: `${dot.unidadeOrcamentaria.codigo} · ${dot.funcao.codigo} · ${dot.contaDespesa.codigo}`,
        natureza: dot.contaDespesa.descricao,
        orgao: dot.unidadeOrcamentaria.nome,
        fonte: `${dot.fonteRecurso.codigo} - ${dot.fonteRecurso.nomenclatura}`,
      },
      movimentos: movs.map((m) => ({
        data: m.data,
        tipo: m.tipo,
        valor: Number(m.valor),
        documento: m.documento ?? (m.ordemPagamento ? `OP ${m.ordemPagamento.numero}` : m.liquidacao ? `Liq ${m.liquidacao.numero}` : `Emp ${m.empenho.numero}`),
      })),
    }
  }
}
