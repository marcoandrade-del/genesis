import { PrismaClient, Prisma } from '@prisma/client'
import { ErroNegocio } from '../errors.js'
import { MotorEventosReceita } from './motor-eventos-receita.js'
import { LancamentosService } from './lancamentos.js'

export interface DadosLancamentoTributario {
  previsaoId: string
  tipo?: string // LANCAMENTO (default) | INSCRICAO_DIVIDA_ATIVA
  data: string // YYYY-MM-DD (fato gerador / lançamento)
  valor: string
  vencimento?: string
  devedorNome?: string
  devedorDocumento?: string
  documento?: string
  historico?: string
  criadoPorId: string
}

/**
 * Lançamento (constituição) do crédito tributário — estágio de COMPETÊNCIA. Reconhece
 * o direito a receber e a VPA no fato gerador, disparando o evento E550 (D ativo / C VPA)
 * de forma atômica. A arrecadação posterior baixa o ativo (E560) — feita pelo
 * ArrecadacoesService, sem mudança, pois o motor já reconhece a natureza por competência.
 */
export class LancamentoTributarioService {
  private motor: MotorEventosReceita
  private lancamentos: LancamentosService

  constructor(private prisma: PrismaClient) {
    this.motor = new MotorEventosReceita(prisma)
    this.lancamentos = new LancamentosService(prisma)
  }

  /** Lançamentos do orçamento, mais recentes primeiro. */
  listar(orcamentoId: string) {
    return this.prisma.lancamentoTributario.findMany({
      where: { previsao: { orcamentoId } },
      orderBy: [{ data: 'desc' }, { criadoEm: 'desc' }],
      include: { previsao: { include: { contaReceita: true, fonteRecurso: true } } },
    })
  }

  async criar(orcamentoId: string, dados: DadosLancamentoTributario) {
    const orcamento = await this.prisma.orcamento.findUnique({ where: { id: orcamentoId } })
    if (!orcamento) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Orçamento não encontrado.')
    if (orcamento.status === 'RASCUNHO') {
      throw new ErroNegocio('ENTIDADE_NAO_PROCESSAVEL', 'O orçamento ainda está em rascunho — aprove-o antes de lançar créditos.')
    }
    if (!dados.previsaoId?.trim()) throw new ErroNegocio('REQUISICAO_INVALIDA', 'Selecione a previsão (natureza × fonte).')
    if (!dados.data?.trim() || Number.isNaN(Date.parse(dados.data))) throw new ErroNegocio('REQUISICAO_INVALIDA', 'Informe uma data válida.')
    const n = Number(dados.valor)
    if (!Number.isFinite(n) || n <= 0) throw new ErroNegocio('REQUISICAO_INVALIDA', 'Valor deve ser positivo.')
    if (dados.vencimento && Number.isNaN(Date.parse(dados.vencimento))) throw new ErroNegocio('REQUISICAO_INVALIDA', 'Vencimento inválido.')

    const previsao = await this.prisma.previsaoReceita.findUnique({
      where: { id: dados.previsaoId.trim() },
      include: { contaReceita: { select: { codigo: true } } },
    })
    if (!previsao || previsao.orcamentoId !== orcamentoId) {
      throw new ErroNegocio('REQUISICAO_INVALIDA', 'A previsão não pertence a este orçamento.')
    }

    const ano = Number(dados.data.slice(0, 4))
    const valor = new Prisma.Decimal(dados.valor)
    const ehInscricao = dados.tipo === 'INSCRICAO_DIVIDA_ATIVA'
    const histBase = dados.historico?.trim() || (ehInscricao ? 'Inscrição em dívida ativa' : 'Lançamento de crédito tributário')
    const ctx = { entidadeId: orcamento.entidadeId, ano, naturezaCodigo: previsao.contaReceita.codigo, valor }

    return this.prisma.$transaction(async (tx) => {
      const lt = await tx.lancamentoTributario.create({
        data: {
          previsaoId: previsao.id,
          tipo: ehInscricao ? 'INSCRICAO_DIVIDA_ATIVA' : 'LANCAMENTO',
          data: new Date(dados.data),
          valor,
          vencimento: dados.vencimento ? new Date(dados.vencimento) : null,
          devedorNome: dados.devedorNome?.trim() || null,
          devedorDocumento: dados.devedorDocumento?.trim() || null,
          documento: dados.documento?.trim() || null,
          historico: dados.historico?.trim() || null,
          criadoPorId: dados.criadoPorId,
        },
      })

      const eventos = ehInscricao
        ? await this.motor.resolverInscricaoDividaAtiva(ctx, {}, tx)
        : await this.motor.resolverLancamentoTributario(ctx, {}, tx)
      const origemTipo = ehInscricao ? 'INSCRICAO_DIVIDA_ATIVA' : 'LANCAMENTO_TRIBUTARIO'
      for (const ev of eventos) {
        await this.lancamentos.criar(
          {
            entidadeId: orcamento.entidadeId,
            data: dados.data,
            historico: `${ev.descricaoEvento} — ${histBase}`,
            itens: ev.itens,
            criadoPorId: dados.criadoPorId,
            origemTipo,
            origemId: lt.id,
            eventoCodigo: ev.eventoCodigo,
          },
          tx,
        )
      }
      return lt
    })
  }

  /** Exclui o lançamento e reverte os lançamentos contábeis gerados (correção). */
  async excluir(id: string, entidadeId: string) {
    const lt = await this.prisma.lancamentoTributario.findUnique({
      where: { id },
      include: { previsao: { include: { orcamento: { select: { entidadeId: true } } } } },
    })
    if (!lt || lt.previsao.orcamento.entidadeId !== entidadeId) {
      throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Lançamento tributário não encontrado.')
    }
    const lancs = await this.prisma.lancamento.findMany({
      where: { origemTipo: { in: ['LANCAMENTO_TRIBUTARIO', 'INSCRICAO_DIVIDA_ATIVA'] }, origemId: id },
      select: { id: true },
    })
    for (const l of lancs) await this.lancamentos.excluir(l.id) // reverte ResumoMensalConta + apaga itens
    await this.prisma.lancamentoTributario.delete({ where: { id } })
    return lt
  }

  /** Trilha contábil de um lançamento (rastreabilidade →): o lançamento + os contábeis gerados. */
  async trilhaDoLancamento(id: string, entidadeId: string) {
    const lancamento = await this.prisma.lancamentoTributario.findUnique({
      where: { id },
      include: {
        previsao: {
          include: {
            contaReceita: { select: { codigo: true, descricao: true } },
            fonteRecurso: { select: { codigo: true, nomenclatura: true } },
            orcamento: { select: { entidadeId: true } },
          },
        },
      },
    })
    if (!lancamento || lancamento.previsao.orcamento.entidadeId !== entidadeId) {
      throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Lançamento tributário não encontrado.')
    }
    const lancs = await this.prisma.lancamento.findMany({
      where: { origemTipo: { in: ['LANCAMENTO_TRIBUTARIO', 'INSCRICAO_DIVIDA_ATIVA'] }, origemId: id },
      include: { itens: true },
      orderBy: { eventoCodigo: 'asc' },
    })
    const contaIds = [...new Set(lancs.flatMap((l) => l.itens.map((i) => i.contaId)))]
    const contas = await this.prisma.contaContabilEntidade.findMany({
      where: { id: { in: contaIds } },
      select: { id: true, codigo: true, descricao: true },
    })
    const porId = new Map(contas.map((c) => [c.id, c]))
    const eventos = lancs.map((l) => ({
      eventoCodigo: l.eventoCodigo,
      historico: l.historico,
      itens: l.itens
        .slice()
        .sort((a, b) => (a.tipo === b.tipo ? 0 : a.tipo === 'DEBITO' ? -1 : 1))
        .map((i) => ({ tipo: i.tipo, valor: i.valor, naturezaReceitaCodigo: i.naturezaReceitaCodigo, conta: porId.get(i.contaId) ?? null })),
    }))
    return { lancamento, eventos }
  }
}
