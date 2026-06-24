import { PrismaClient, Prisma, type StatusOrcamento } from '@prisma/client'
import { ErroNegocio } from '../errors.js'

export type DadosOrcamento = {
  leiNumero?: string | null
  dataAprovacao?: Date | string | null
  observacoes?: string | null
}

// Fluxo de aprovação da LOA, espelhando o ciclo real (Executivo → Legislativo →
// sanção → publicação → execução). EM_EXECUCAO NÃO é alcançável por aqui: só pela
// abertura contábil (que gera os lançamentos), a partir de PUBLICADO.
const TRANSICOES_VALIDAS: Record<StatusOrcamento, ReadonlyArray<StatusOrcamento>> = {
  RASCUNHO: ['ENVIADO_AO_LEGISLATIVO'],
  ENVIADO_AO_LEGISLATIVO: ['APROVADO', 'RASCUNHO'],
  APROVADO: ['PUBLICADO', 'ENVIADO_AO_LEGISLATIVO'],
  PUBLICADO: ['APROVADO'],
  EM_EXECUCAO: [],
}

// Estados em que a LOA já vale (aprovada em diante) e a execução é permitida —
// empenho/arrecadação/reserva/crédito/lançamento tributário. RASCUNHO e
// ENVIADO_AO_LEGISLATIVO (ainda sem aprovação) bloqueiam.
export const STATUS_EXECUTAVEIS: ReadonlyArray<StatusOrcamento> = ['APROVADO', 'PUBLICADO', 'EM_EXECUCAO']

/** A LOA pode receber execução (já está aprovada em diante)? */
export function orcamentoPodeExecutar(status: StatusOrcamento): boolean {
  return STATUS_EXECUTAVEIS.includes(status)
}

/**
 * Orçamento (LOA) por entidade × ano. Cabeçalho que agrupa dotações de despesa
 * e previsões de receita. O conteúdo é editável só em RASCUNHO; o status segue o
 * fluxo de aprovação (rascunho → Legislativo → aprovado → publicado → execução),
 * com trilha de quem mudou o quê (`TransicaoStatusOrcamento`).
 */
export class OrcamentosService {
  constructor(private prisma: PrismaClient) {}

  listar(entidadeId: string) {
    return this.prisma.orcamento.findMany({
      where: { entidadeId },
      orderBy: { ano: 'desc' },
      include: { _count: { select: { dotacoes: true, previsoes: true } } },
    })
  }

  buscarPorEntidadeAno(entidadeId: string, ano: number) {
    return this.prisma.orcamento.findUnique({
      where: { entidadeId_ano: { entidadeId, ano } },
    })
  }

  buscarPorId(id: string) {
    return this.prisma.orcamento.findUnique({
      where: { id },
      include: {
        entidade: { include: { municipio: { include: { estado: true } } } },
        _count: { select: { dotacoes: true, previsoes: true } },
      },
    })
  }

  async criar(entidadeId: string, ano: number, dados: DadosOrcamento) {
    if (!Number.isInteger(ano) || ano < 1900 || ano > 9999) {
      throw new ErroNegocio('REQUISICAO_INVALIDA', 'Ano inválido.')
    }
    const entidade = await this.prisma.entidade.findUnique({ where: { id: entidadeId } })
    if (!entidade) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Entidade não encontrada.')

    try {
      return await this.prisma.orcamento.create({
        data: {
          entidadeId,
          ano,
          leiNumero: trimOuNull(dados.leiNumero),
          dataAprovacao: parseData(dados.dataAprovacao),
          observacoes: trimOuNull(dados.observacoes),
        },
      })
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ErroNegocio('CONFLITO', `Já existe um orçamento para esta entidade no exercício ${ano}.`)
      }
      throw e
    }
  }

  async atualizar(id: string, dados: DadosOrcamento) {
    const existente = await this.prisma.orcamento.findUnique({ where: { id } })
    if (!existente) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Orçamento não encontrado.')
    if (existente.status === 'EM_EXECUCAO') {
      throw new ErroNegocio('CONFLITO', 'Orçamento em execução não pode ser editado.')
    }
    return this.prisma.orcamento.update({
      where: { id },
      data: {
        leiNumero: trimOuNull(dados.leiNumero),
        dataAprovacao: parseData(dados.dataAprovacao),
        observacoes: trimOuNull(dados.observacoes),
      },
    })
  }

  /**
   * Avança o status no fluxo de aprovação, registrando a transição na trilha
   * (autor + de/para + observação) na MESMA transação. Carimba `dataAprovacao` /
   * `dataPublicacao` na primeira vez que atinge cada marco.
   */
  async alterarStatus(id: string, novoStatus: StatusOrcamento, autorId: string, observacao?: string | null) {
    const existente = await this.prisma.orcamento.findUnique({ where: { id } })
    if (!existente) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Orçamento não encontrado.')
    const permitidos = TRANSICOES_VALIDAS[existente.status]
    if (!permitidos.includes(novoStatus)) {
      throw new ErroNegocio(
        'CONFLITO',
        `Transição inválida: ${existente.status} → ${novoStatus}.`,
      )
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.transicaoStatusOrcamento.create({
        data: { orcamentoId: id, de: existente.status, para: novoStatus, autorId, observacao: trimOuNull(observacao) },
      })
      return tx.orcamento.update({
        where: { id },
        data: {
          status: novoStatus,
          ...(novoStatus === 'APROVADO' && !existente.dataAprovacao ? { dataAprovacao: new Date() } : {}),
          ...(novoStatus === 'PUBLICADO' && !existente.dataPublicacao ? { dataPublicacao: new Date() } : {}),
        },
      })
    })
  }

  /** Trilha das transições de status (mais recente primeiro), com o autor. */
  trilha(orcamentoId: string) {
    return this.prisma.transicaoStatusOrcamento.findMany({
      where: { orcamentoId },
      orderBy: { criadoEm: 'desc' },
      include: { autor: { select: { nomeCompleto: true, emailPrincipal: true } } },
    })
  }

  async excluir(id: string) {
    const existente = await this.prisma.orcamento.findUnique({
      where: { id },
      include: { _count: { select: { dotacoes: true, previsoes: true } } },
    })
    if (!existente) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Orçamento não encontrado.')
    if (existente.status !== 'RASCUNHO') {
      throw new ErroNegocio('CONFLITO', 'Apenas orçamentos em rascunho podem ser excluídos.')
    }
    if (existente._count.dotacoes > 0 || existente._count.previsoes > 0) {
      throw new ErroNegocio(
        'CONFLITO',
        `Não é possível excluir: orçamento tem ${existente._count.dotacoes} dotação(ões) e ${existente._count.previsoes} previsão(ões).`,
      )
    }
    await this.prisma.orcamento.delete({ where: { id } })
  }
}

function trimOuNull(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null
  const t = v.trim()
  return t === '' ? null : t
}

function parseData(v: Date | string | null | undefined): Date | null {
  if (v === null || v === undefined || v === '') return null
  const d = v instanceof Date ? v : new Date(v)
  if (Number.isNaN(d.getTime())) {
    throw new ErroNegocio('REQUISICAO_INVALIDA', `Data inválida: "${v}".`)
  }
  return d
}
