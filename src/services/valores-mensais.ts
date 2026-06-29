import type { PrismaClient } from '@prisma/client'

/**
 * Valores MENSAIS granulares (read-only) para o painel do Oxy: receita por conta
 * analítica × fonte e despesa por grupo×função×órgão×fonte, com os valores de
 * cada mês (jan→dez) em R$ cheio. O Gênesis expõe granular; o oxy-bi-jpa agrega.
 * Contrato versionado em `src/api/memoriais.ts` (recurso `valores-mensais`).
 */

const r2 = (n: number) => Math.round(n * 100) / 100
const z12 = () => new Array<number>(12).fill(0)
const naturezaReceita = (cod: string): 'Corrente' | 'Capital' => (cod.startsWith('2') || cod.startsWith('8') ? 'Capital' : 'Corrente')

export interface ContaReceitaMensal {
  codigo: string
  descricao: string
  natureza: 'Corrente' | 'Capital'
  origem: string
  fonte: string
  arrecadadoMensal: number[]
  orcado: number
}
export interface ItemDespesaMensal {
  grupo: string
  funcao: string
  orgao: string
  fonte: string
  empenhadoMensal: number[]
  liquidadoMensal: number[]
  pagoMensal: number[]
  orcado: number
}
type Entidade = { id: string; nome: string; estado: string }
export interface ValoresMensaisReceita { entidade: Entidade; ano: number; mesesRealizados: number; contas: ContaReceitaMensal[] }
export interface ValoresMensaisDespesa { entidade: Entidade; ano: number; mesesRealizados: number; itens: ItemDespesaMensal[] }

export class ValoresMensaisService {
  constructor(private prisma: PrismaClient) {}

  /** Meses decorridos do exercício (12 se passado; mês atual se corrente; 0 se futuro). */
  private mesesRealizados(ano: number): number {
    const hoje = new Date()
    if (ano < hoje.getFullYear()) return 12
    if (ano > hoje.getFullYear()) return 0
    return hoje.getMonth() + 1
  }

  private async entidadeInfo(entidadeId: string): Promise<Entidade | null> {
    const e = await this.prisma.entidade.findUnique({
      where: { id: entidadeId },
      select: { id: true, nome: true, municipio: { select: { estado: { select: { sigla: true } } } } },
    })
    if (!e) return null
    return { id: e.id, nome: e.nome, estado: e.municipio?.estado?.sigla ?? '' }
  }

  async receita(entidadeId: string, ano: number): Promise<ValoresMensaisReceita | null> {
    const entidade = await this.entidadeInfo(entidadeId)
    if (!entidade) return null
    const base = { entidade, ano, mesesRealizados: this.mesesRealizados(ano) }
    const orcamento = await this.prisma.orcamento.findUnique({ where: { entidadeId_ano: { entidadeId, ano } }, select: { id: true } })
    if (!orcamento) return { ...base, contas: [] }

    // Árvore das contas de receita p/ derivar a "origem" (ancestral de nível 2).
    const contas = await this.prisma.contaReceitaEntidade.findMany({ where: { entidadeId, ano }, select: { id: true, descricao: true, nivel: true, parentId: true } })
    const noPorId = new Map(contas.map((c) => [c.id, c]))
    const origemDe = (contaId: string): string => {
      let id: string | null = contaId
      const visit = new Set<string>()
      let origem = ''
      while (id && !visit.has(id)) {
        visit.add(id)
        const n = noPorId.get(id)
        if (!n) break
        if (n.nivel === 2) origem = n.descricao
        id = n.parentId
      }
      return origem
    }

    const mapa = new Map<string, ContaReceitaMensal>() // chave: contaId|fonteId
    const novo = (codigo: string, descricao: string, contaId: string, fonte: string): ContaReceitaMensal => ({
      codigo, descricao, natureza: naturezaReceita(codigo), origem: origemDe(contaId), fonte, arrecadadoMensal: z12(), orcado: 0,
    })

    const previsoes = await this.prisma.previsaoReceita.findMany({
      where: { orcamentoId: orcamento.id },
      select: { contaReceitaEntidadeId: true, fonteRecursoEntidadeId: true, valorPrevisto: true, contaReceita: { select: { codigo: true, descricao: true } }, fonteRecurso: { select: { codigo: true, nomenclatura: true } } },
    })
    for (const p of previsoes) {
      const k = `${p.contaReceitaEntidadeId}|${p.fonteRecursoEntidadeId}`
      const l = mapa.get(k) ?? novo(p.contaReceita.codigo, p.contaReceita.descricao, p.contaReceitaEntidadeId, `${p.fonteRecurso.codigo} - ${p.fonteRecurso.nomenclatura}`)
      l.orcado += Number(p.valorPrevisto)
      mapa.set(k, l)
    }

    const arrecadacoes = await this.prisma.arrecadacao.findMany({
      where: { previsao: { orcamentoId: orcamento.id }, data: { gte: new Date(Date.UTC(ano, 0, 1)), lte: new Date(Date.UTC(ano, 11, 31)) } },
      select: { tipo: true, valor: true, data: true, previsao: { select: { contaReceitaEntidadeId: true, fonteRecursoEntidadeId: true, contaReceita: { select: { codigo: true, descricao: true } }, fonteRecurso: { select: { codigo: true, nomenclatura: true } } } } },
    })
    for (const a of arrecadacoes) {
      const pr = a.previsao
      const k = `${pr.contaReceitaEntidadeId}|${pr.fonteRecursoEntidadeId}`
      const l = mapa.get(k) ?? novo(pr.contaReceita.codigo, pr.contaReceita.descricao, pr.contaReceitaEntidadeId, `${pr.fonteRecurso.codigo} - ${pr.fonteRecurso.nomenclatura}`)
      const mes = a.data.getUTCMonth()
      l.arrecadadoMensal[mes] = (l.arrecadadoMensal[mes] ?? 0) + (a.tipo === 'ESTORNO' ? -1 : 1) * Number(a.valor)
      mapa.set(k, l)
    }

    const contasArr = [...mapa.values()]
      .map((l) => ({ ...l, orcado: r2(l.orcado), arrecadadoMensal: l.arrecadadoMensal.map(r2) }))
      .sort((a, b) => a.codigo.localeCompare(b.codigo, 'pt-BR', { numeric: true }) || a.fonte.localeCompare(b.fonte, 'pt-BR'))
    return { ...base, contas: contasArr }
  }

  async despesa(entidadeId: string, ano: number): Promise<ValoresMensaisDespesa | null> {
    const entidade = await this.entidadeInfo(entidadeId)
    if (!entidade) return null
    const base = { entidade, ano, mesesRealizados: this.mesesRealizados(ano) }
    const orcamento = await this.prisma.orcamento.findUnique({ where: { entidadeId_ano: { entidadeId, ano } }, select: { id: true } })
    if (!orcamento) return { ...base, itens: [] }

    // GRUPO = ancestral de nível 2 da natureza (ex.: "Pessoal e Encargos Sociais"),
    // obtido subindo a árvore (robusto a formatos de código). Cai pro nível 1 se faltar.
    const contasD = await this.prisma.contaDespesaEntidade.findMany({ where: { entidadeId, ano }, select: { id: true, descricao: true, nivel: true, parentId: true } })
    const noPorId = new Map(contasD.map((c) => [c.id, c]))
    const grupoDe = (contaId: string): string => {
      let id: string | null = contaId
      const visit = new Set<string>()
      let grupo = ''
      while (id && !visit.has(id)) {
        visit.add(id)
        const n = noPorId.get(id)
        if (!n) break
        if (n.nivel === 2) grupo = n.descricao
        else if (n.nivel === 1 && !grupo) grupo = n.descricao
        id = n.parentId
      }
      return grupo
    }

    const mapa = new Map<string, ItemDespesaMensal>()
    const chaveDeDotacao = new Map<string, string>() // dotacaoId → chave da tupla
    const SEP = ''

    const dotacoes = await this.prisma.dotacaoDespesa.findMany({
      where: { orcamentoId: orcamento.id },
      select: { id: true, valorAutorizado: true, contaDespesaEntidadeId: true, funcao: { select: { nome: true } }, unidadeOrcamentaria: { select: { nome: true } }, fonteRecurso: { select: { codigo: true, nomenclatura: true } } },
    })
    for (const d of dotacoes) {
      const grupo = grupoDe(d.contaDespesaEntidadeId)
      const funcao = d.funcao.nome
      const orgao = d.unidadeOrcamentaria.nome
      const fonte = `${d.fonteRecurso.codigo} - ${d.fonteRecurso.nomenclatura}`
      const k = [grupo, funcao, orgao, fonte].join(SEP)
      const it = mapa.get(k) ?? { grupo, funcao, orgao, fonte, empenhadoMensal: z12(), liquidadoMensal: z12(), pagoMensal: z12(), orcado: 0 }
      it.orcado += Number(d.valorAutorizado)
      mapa.set(k, it)
      chaveDeDotacao.set(d.id, k)
    }

    const movs = await this.prisma.movimentoEmpenho.findMany({
      where: { entidadeId, data: { gte: new Date(Date.UTC(ano, 0, 1)), lte: new Date(Date.UTC(ano, 11, 31)) } },
      select: { tipo: true, valor: true, data: true, empenho: { select: { dotacaoDespesaId: true } } },
    })
    for (const mv of movs) {
      const did = mv.empenho.dotacaoDespesaId
      if (!did) continue
      const k = chaveDeDotacao.get(did)
      if (!k) continue
      const it = mapa.get(k)
      if (!it) continue
      const m = mv.data.getUTCMonth()
      const v = Number(mv.valor)
      if (mv.tipo === 'EMPENHO') it.empenhadoMensal[m] = (it.empenhadoMensal[m] ?? 0) + v
      else if (mv.tipo === 'ESTORNO_EMPENHO') it.empenhadoMensal[m] = (it.empenhadoMensal[m] ?? 0) - v
      else if (mv.tipo === 'LIQUIDACAO') it.liquidadoMensal[m] = (it.liquidadoMensal[m] ?? 0) + v
      else if (mv.tipo === 'ESTORNO_LIQUIDACAO') it.liquidadoMensal[m] = (it.liquidadoMensal[m] ?? 0) - v
      else if (mv.tipo === 'PAGAMENTO') it.pagoMensal[m] = (it.pagoMensal[m] ?? 0) + v
      else if (mv.tipo === 'ESTORNO_PAGAMENTO') it.pagoMensal[m] = (it.pagoMensal[m] ?? 0) - v
    }

    const itens = [...mapa.values()]
      .map((it) => ({ ...it, orcado: r2(it.orcado), empenhadoMensal: it.empenhadoMensal.map(r2), liquidadoMensal: it.liquidadoMensal.map(r2), pagoMensal: it.pagoMensal.map(r2) }))
      .sort((a, b) => a.grupo.localeCompare(b.grupo, 'pt-BR') || a.funcao.localeCompare(b.funcao, 'pt-BR') || a.orgao.localeCompare(b.orgao, 'pt-BR') || a.fonte.localeCompare(b.fonte, 'pt-BR'))
    return { ...base, itens }
  }
}
