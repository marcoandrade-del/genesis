import { PrismaClient, Prisma, type ArrecadacaoTipo } from '@prisma/client'
import { ErroNegocio } from '../errors.js'
import { MotorEventosReceita } from './motor-eventos-receita.js'
import { LancamentosService } from './lancamentos.js'
import { orcamentoPodeExecutar } from './orcamentos.js'
import {
  resolverClassificacaoFonte,
  classificarFonte,
  ROTULO_FINALIDADE,
  ORDEM_FINALIDADE,
  type Finalidade,
} from './fonte-classificacao.js'

export interface DadosArrecadacao {
  previsaoId: string
  tipo: string // 'ARRECADACAO' | 'ESTORNO'
  data: string // yyyy-mm-dd
  valor: string
  historico?: string
  criadoPorId: string // autor (para os lançamentos contábeis gerados)
  contaBancariaId?: string // conta por onde a receita entra (deriva a folha de caixa do E300)
}

export interface LinhaArrecadacao {
  id: string
  codigo: string
  rotulo: string
  nivel: number
  previsto: number
  arrecadado: number
  saldo: number
  origem?: string // só nas linhas por conta (MODELO|DESDOBRAMENTO) — p/ a granularidade do painel
}

/** Receita agregada por FINALIDADE da fonte (MDE/ASPS/FUNDEB/livres/…). */
export interface LinhaFinalidade {
  finalidade: string
  rotulo: string
  previsto: number
  arrecadado: number
  saldo: number
}

export interface ResumoArrecadacao {
  temOrcamento: boolean
  resumo: { previsto: number; arrecadado: number; saldo: number }
  porFonte: LinhaArrecadacao[]
  porConta: LinhaArrecadacao[]
  // Por finalidade da fonte (eixo da prestação de contas). Metodologia da classificação em `metodologiaFonte`.
  porFinalidade: LinhaFinalidade[]
  metodologiaFonte: string
}

const TIPOS_VALIDOS = ['ARRECADACAO', 'ESTORNO']

/** Arredonda para centavos, evitando deriva de ponto flutuante na soma. */
function r2(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Arrecadação da receita (gap #5 PR-3). Movimento sobre uma previsão (conta
 * analítica × fonte) do orçamento APROVADO; ESTORNO reverte. O acumulado vive
 * materializado em `PrevisaoReceita.valorArrecadado`, atualizado na mesma
 * transação do movimento (espelha o padrão de `DotacaoDespesa`). Movimento é
 * imutável após criado — correção é por estorno, preservando a trilha.
 */
export class ArrecadacoesService {
  private motor: MotorEventosReceita
  private lancamentos: LancamentosService

  constructor(private prisma: PrismaClient) {
    this.motor = new MotorEventosReceita(prisma)
    this.lancamentos = new LancamentosService(prisma)
  }

  /** Movimentos do orçamento, mais recentes primeiro. */
  listar(orcamentoId: string) {
    return this.prisma.arrecadacao.findMany({
      where: { previsao: { orcamentoId } },
      orderBy: [{ data: 'desc' }, { criadoEm: 'desc' }],
      include: { previsao: { include: { contaReceita: true, fonteRecurso: true } } },
    })
  }

  async criar(orcamentoId: string, dados: DadosArrecadacao) {
    const orcamento = await this.prisma.orcamento.findUnique({ where: { id: orcamentoId } })
    if (!orcamento) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Orçamento não encontrado.')
    if (!orcamentoPodeExecutar(orcamento.status)) {
      throw new ErroNegocio('ENTIDADE_NAO_PROCESSAVEL', 'A LOA precisa estar aprovada antes de registrar arrecadações.')
    }

    if (!dados.previsaoId?.trim()) throw new ErroNegocio('REQUISICAO_INVALIDA', 'Selecione a previsão (conta × fonte).')
    if (!TIPOS_VALIDOS.includes(dados.tipo)) throw new ErroNegocio('REQUISICAO_INVALIDA', 'Tipo de movimento inválido.')
    if (!dados.data?.trim() || Number.isNaN(Date.parse(dados.data))) {
      throw new ErroNegocio('REQUISICAO_INVALIDA', 'Informe uma data válida.')
    }
    const n = Number(dados.valor)
    if (!Number.isFinite(n) || n <= 0) throw new ErroNegocio('REQUISICAO_INVALIDA', 'Valor deve ser positivo.')
    const valor = new Prisma.Decimal(dados.valor)

    const previsao = await this.prisma.previsaoReceita.findUnique({
      where: { id: dados.previsaoId.trim() },
      include: {
        contaReceita: { select: { codigo: true } },
        fonteRecurso: { select: { codigo: true, vinculada: true } },
      },
    })
    if (!previsao || previsao.orcamentoId !== orcamentoId) {
      throw new ErroNegocio('REQUISICAO_INVALIDA', 'A previsão não pertence a este orçamento.')
    }
    // Estorno não pode deixar o arrecadado da previsão negativo (saldo a estornar).
    if (dados.tipo === 'ESTORNO' && valor.greaterThan(previsao.valorArrecadado)) {
      throw new ErroNegocio('ENTIDADE_NAO_PROCESSAVEL', 'O estorno excede o valor arrecadado desta previsão.')
    }

    const ano = Number(dados.data.slice(0, 4))
    const histBase = dados.historico?.trim() || (dados.tipo === 'ESTORNO' ? 'Estorno de arrecadação' : 'Arrecadação da receita')

    // Conta bancária (opcional): a receita entra por ela e dela vem a folha de
    // caixa do E300. A conta tem de ser da MESMA fonte da previsão.
    let contaBancariaId: string | null = null
    let caixaCodigo: string | null = null
    if (dados.contaBancariaId?.trim()) {
      const cb = await this.prisma.contaBancaria.findUnique({ where: { id: dados.contaBancariaId.trim() } })
      if (!cb || cb.entidadeId !== orcamento.entidadeId) {
        throw new ErroNegocio('REQUISICAO_INVALIDA', 'Conta bancária não encontrada nesta entidade.')
      }
      if (!cb.ativa) throw new ErroNegocio('ENTIDADE_NAO_PROCESSAVEL', 'A conta bancária selecionada está inativa.')
      if (cb.fonteCodigo !== previsao.fonteRecurso.codigo) {
        throw new ErroNegocio(
          'ENTIDADE_NAO_PROCESSAVEL',
          `A conta bancária é da fonte ${cb.fonteCodigo}, mas a previsão é da fonte ${previsao.fonteRecurso.codigo}.`,
        )
      }
      contaBancariaId = cb.id
      caixaCodigo = cb.contaContabilCodigo // pode ser null → motor usa o caixa default
    }

    return this.prisma.$transaction(async (tx) => {
      const mov = await tx.arrecadacao.create({
        data: {
          previsaoId: previsao.id,
          tipo: dados.tipo as ArrecadacaoTipo,
          data: new Date(dados.data),
          valor,
          historico: dados.historico?.trim() || null,
          contaBancariaId,
        },
      })
      await tx.previsaoReceita.update({
        where: { id: previsao.id },
        data: { valorArrecadado: dados.tipo === 'ARRECADACAO' ? { increment: valor } : { decrement: valor } },
      })

      // Baixa parcial controlada: arrecadação de tributária (competência) não pode
      // exceder o crédito a receber lançado (saldo do ativo).
      if (dados.tipo === 'ARRECADACAO') {
        await this.motor.validarBaixaArrecadacao(orcamento.entidadeId, ano, previsao.contaReceita.codigo, valor, tx)
      }

      // Integração contábil (Tabela de Eventos): a arrecadação dispara os
      // lançamentos automáticos no plano de contas, na mesma transação. O estorno
      // gera os lançamentos invertidos. Rastreabilidade mão-dupla via origem*.
      const eventos = await this.motor.resolver(
        {
          entidadeId: orcamento.entidadeId,
          ano,
          naturezaCodigo: previsao.contaReceita.codigo,
          fonteCodigo: previsao.fonteRecurso.codigo,
          fonteVinculada: previsao.fonteRecurso.vinculada,
          valor,
          caixaCodigo,
        },
        { estorno: dados.tipo === 'ESTORNO' },
        tx,
      )
      for (const ev of eventos) {
        await this.lancamentos.criar(
          {
            entidadeId: orcamento.entidadeId,
            data: dados.data,
            historico: `${ev.descricaoEvento} — ${histBase}`,
            itens: ev.itens,
            criadoPorId: dados.criadoPorId,
            origemTipo: 'ARRECADACAO',
            origemId: mov.id,
            eventoCodigo: ev.eventoCodigo,
          },
          tx,
        )
      }
      return mov
    })
  }

  /** Lançamentos contábeis gerados por um movimento de arrecadação (rastreabilidade →). */
  lancamentosDoMovimento(arrecadacaoId: string) {
    return this.prisma.lancamento.findMany({
      where: { origemTipo: 'ARRECADACAO', origemId: arrecadacaoId },
      include: { itens: true },
      orderBy: { eventoCodigo: 'asc' },
    })
  }

  /**
   * Trilha contábil de um movimento (para a tela "lançamentos do movimento"):
   * o movimento + os lançamentos gerados, com código/descrição de cada conta
   * resolvidos. Escopado à entidade (não vaza movimento de outra).
   */
  async trilhaDoMovimento(arrecadacaoId: string, entidadeId: string) {
    const movimento = await this.prisma.arrecadacao.findUnique({
      where: { id: arrecadacaoId },
      include: {
        previsao: {
          include: {
            contaReceita: { select: { codigo: true, descricao: true } },
            fonteRecurso: { select: { codigo: true, nomenclatura: true } },
            orcamento: { select: { entidadeId: true } },
          },
        },
        contaBancaria: { select: { bancoCodigo: true, agencia: true, numero: true, descricao: true } },
      },
    })
    if (!movimento || movimento.previsao.orcamento.entidadeId !== entidadeId) {
      throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Movimento de arrecadação não encontrado.')
    }

    const lancamentos = await this.lancamentosDoMovimento(arrecadacaoId)
    const contaIds = [...new Set(lancamentos.flatMap((l) => l.itens.map((i) => i.contaId)))]
    const contas = await this.prisma.contaContabilEntidade.findMany({
      where: { id: { in: contaIds } },
      select: { id: true, codigo: true, descricao: true },
    })
    const porId = new Map(contas.map((c) => [c.id, c]))

    const eventos = lancamentos.map((l) => ({
      eventoCodigo: l.eventoCodigo,
      historico: l.historico,
      itens: l.itens
        .slice()
        .sort((a, b) => (a.tipo === b.tipo ? 0 : a.tipo === 'DEBITO' ? -1 : 1))
        .map((i) => ({
          tipo: i.tipo,
          valor: i.valor,
          naturezaReceitaCodigo: i.naturezaReceitaCodigo,
          fonteCodigo: i.fonteCodigo,
          conta: porId.get(i.contaId) ?? null,
        })),
    }))
    return { movimento, eventos }
  }

  /**
   * Previsto × arrecadado do exercício: totais, por fonte (plano) e por conta
   * de receita COM roll-up (folha + ancestrais da árvore ContaReceitaEntidade)
   * — espelha o SaldoOrcamentarioService da despesa.
   */
  async resumo(entidadeId: string, ano: number): Promise<ResumoArrecadacao> {
    // Classificação de fonte→finalidade do Estado da entidade (default em código + override do banco).
    const ent = await this.prisma.entidade.findUnique({
      where: { id: entidadeId },
      select: { municipio: { select: { estado: { select: { sigla: true, fonteClassificacao: true } } } } },
    })
    const comp = resolverClassificacaoFonte(ent?.municipio?.estado?.sigla, ent?.municipio?.estado?.fonteClassificacao)

    const vazio: ResumoArrecadacao = {
      temOrcamento: false,
      resumo: { previsto: 0, arrecadado: 0, saldo: 0 },
      porFonte: [],
      porConta: [],
      porFinalidade: [],
      metodologiaFonte: comp.nome,
    }
    const orcamento = await this.prisma.orcamento.findUnique({ where: { entidadeId_ano: { entidadeId, ano } } })
    if (!orcamento) return vazio

    const previsoes = await this.prisma.previsaoReceita.findMany({
      where: { orcamentoId: orcamento.id },
      include: { fonteRecurso: true },
    })

    const contas = await this.prisma.contaReceitaEntidade.findMany({
      where: { entidadeId, ano },
      select: { id: true, codigo: true, descricao: true, nivel: true, parentId: true, origem: true },
    })
    const noPorId = new Map(contas.map((c) => [c.id, c]))

    let prevTotal = 0
    let arrTotal = 0
    const porFonte = new Map<string, { codigo: string; rotulo: string; previsto: number; arrecadado: number }>()
    const acumConta = new Map<string, { previsto: number; arrecadado: number }>()
    const porFin = new Map<Finalidade, { previsto: number; arrecadado: number }>()

    for (const p of previsoes) {
      const prev = Number(p.valorPrevisto)
      const arr = Number(p.valorArrecadado)
      prevTotal += prev
      arrTotal += arr

      const fin = classificarFonte(p.fonteRecurso.codigo, comp)
      const af = porFin.get(fin) ?? { previsto: 0, arrecadado: 0 }
      af.previsto += prev
      af.arrecadado += arr
      porFin.set(fin, af)

      const f = porFonte.get(p.fonteRecursoEntidadeId) ?? {
        codigo: p.fonteRecurso.codigo,
        rotulo: p.fonteRecurso.nomenclatura,
        previsto: 0,
        arrecadado: 0,
      }
      f.previsto += prev
      f.arrecadado += arr
      porFonte.set(p.fonteRecursoEntidadeId, f)

      // Roll-up na árvore de contas: a folha e todos os ancestrais recebem o valor.
      let id: string | null = p.contaReceitaEntidadeId
      const visitados = new Set<string>()
      while (id && !visitados.has(id)) {
        visitados.add(id)
        const node = noPorId.get(id)
        if (!node) break
        const acc = acumConta.get(id) ?? { previsto: 0, arrecadado: 0 }
        acc.previsto += prev
        acc.arrecadado += arr
        acumConta.set(id, acc)
        id = node.parentId
      }
    }

    const linha = (
      id: string,
      codigo: string,
      rotulo: string,
      nivel: number,
      v: { previsto: number; arrecadado: number },
    ): LinhaArrecadacao => ({
      id,
      codigo,
      rotulo,
      nivel,
      previsto: r2(v.previsto),
      arrecadado: r2(v.arrecadado),
      saldo: r2(v.previsto - v.arrecadado),
    })

    return {
      temOrcamento: true,
      resumo: { previsto: r2(prevTotal), arrecadado: r2(arrTotal), saldo: r2(prevTotal - arrTotal) },
      porFonte: [...porFonte.entries()]
        .map(([id, v]) => linha(id, v.codigo, v.rotulo, 0, v))
        .sort((a, b) => a.codigo.localeCompare(b.codigo)),
      porConta: contas
        .filter((c) => acumConta.has(c.id))
        .sort((a, b) => a.codigo.localeCompare(b.codigo, undefined, { numeric: true }))
        .map((c) => ({ ...linha(c.id, c.codigo, c.descricao, c.nivel, acumConta.get(c.id)!), origem: c.origem })),
      porFinalidade: ORDEM_FINALIDADE.filter((fin) => porFin.has(fin)).map((fin) => {
        const v = porFin.get(fin)!
        return {
          finalidade: fin,
          rotulo: ROTULO_FINALIDADE[fin],
          previsto: r2(v.previsto),
          arrecadado: r2(v.arrecadado),
          saldo: r2(v.previsto - v.arrecadado),
        }
      }),
      metodologiaFonte: comp.nome,
    }
  }
}
