import { PrismaClient, Prisma, type CreditoAdicionalTipo } from '@prisma/client'
import { ErroNegocio } from '../errors.js'
import { saldoDisponivel } from './reservas-dotacao.js'
import { orcamentoPodeExecutar } from './orcamentos.js'

export interface DadosItemCredito {
  dotacaoId: string
  operacao: string // 'REFORCO' | 'ANULACAO'
  valor: string
}

export interface DadosCriarCredito {
  tipo: string // CreditoAdicionalTipo
  numero: string
  data: string // yyyy-mm-dd
  atoLegal: string
  justificativa?: string
  itens: DadosItemCredito[]
}

const TIPOS_VALIDOS = ['SUPLEMENTAR', 'ESPECIAL', 'EXTRAORDINARIO']

/**
 * Créditos adicionais (Lei 4.320/1964). Aplicados de imediato na criação:
 * cada item REFORÇA (+) a dotação alvo ou ANULA (−) saldo de uma dotação-fonte,
 * alterando o `valorAutorizado`. Imutável após criado (documento orçamentário).
 */
export class CreditosAdicionaisService {
  constructor(private prisma: PrismaClient) {}

  listar(orcamentoId: string) {
    return this.prisma.creditoAdicional.findMany({
      where: { orcamentoId },
      orderBy: [{ data: 'desc' }, { numero: 'desc' }],
      include: { _count: { select: { itens: true } } },
    })
  }

  buscarPorId(id: string) {
    return this.prisma.creditoAdicional.findUnique({
      where: { id },
      include: {
        orcamento: true,
        itens: {
          include: {
            dotacaoDespesa: {
              include: { unidadeOrcamentaria: true, contaDespesa: true, fonteRecurso: true },
            },
          },
        },
      },
    })
  }

  async criar(orcamentoId: string, dados: DadosCriarCredito) {
    const orcamento = await this.prisma.orcamento.findUnique({ where: { id: orcamentoId } })
    if (!orcamento) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Orçamento não encontrado.')
    if (!orcamentoPodeExecutar(orcamento.status)) {
      throw new ErroNegocio('ENTIDADE_NAO_PROCESSAVEL', 'A LOA precisa estar aprovada antes de lançar créditos adicionais.')
    }

    if (!TIPOS_VALIDOS.includes(dados.tipo)) throw new ErroNegocio('REQUISICAO_INVALIDA', 'Tipo de crédito inválido.')
    if (!dados.numero?.trim()) throw new ErroNegocio('REQUISICAO_INVALIDA', 'Informe o número do crédito.')
    if (!dados.atoLegal?.trim()) throw new ErroNegocio('REQUISICAO_INVALIDA', 'Informe o ato legal (lei/decreto).')
    if (!dados.data?.trim() || Number.isNaN(Date.parse(dados.data))) throw new ErroNegocio('REQUISICAO_INVALIDA', 'Informe uma data válida.')
    if (!dados.itens || dados.itens.length === 0) throw new ErroNegocio('REQUISICAO_INVALIDA', 'Adicione ao menos um item.')

    const itens = dados.itens.map((it, i) => {
      const n = Number(it.valor)
      if (!it.dotacaoId?.trim()) throw new ErroNegocio('REQUISICAO_INVALIDA', `Item ${i + 1}: selecione a dotação.`)
      if (it.operacao !== 'REFORCO' && it.operacao !== 'ANULACAO') {
        throw new ErroNegocio('REQUISICAO_INVALIDA', `Item ${i + 1}: operação inválida.`)
      }
      if (!Number.isFinite(n) || n <= 0) throw new ErroNegocio('REQUISICAO_INVALIDA', `Item ${i + 1}: valor deve ser positivo.`)
      return { dotacaoId: it.dotacaoId.trim(), operacao: it.operacao, valor: new Prisma.Decimal(it.valor) }
    })

    let totalReforco = new Prisma.Decimal(0)
    let totalAnulacao = new Prisma.Decimal(0)
    for (const it of itens) {
      if (it.operacao === 'REFORCO') totalReforco = totalReforco.plus(it.valor)
      else totalAnulacao = totalAnulacao.plus(it.valor)
    }
    if (totalReforco.lessThanOrEqualTo(0)) {
      throw new ErroNegocio('ENTIDADE_NAO_PROCESSAVEL', 'O crédito precisa reforçar ao menos uma dotação.')
    }
    if (totalAnulacao.greaterThan(totalReforco)) {
      throw new ErroNegocio('ENTIDADE_NAO_PROCESSAVEL', 'A anulação não pode superar o total reforçado.')
    }

    // Todas as dotações precisam pertencer a este orçamento.
    const ids = [...new Set(itens.map((i) => i.dotacaoId))]
    const dotacoes = await this.prisma.dotacaoDespesa.findMany({ where: { id: { in: ids }, orcamentoId } })
    const porId = new Map(dotacoes.map((d) => [d.id, d]))
    for (const id of ids) {
      if (!porId.has(id)) throw new ErroNegocio('REQUISICAO_INVALIDA', 'Há dotação que não pertence a este orçamento.')
    }

    // Anulação não pode exceder o saldo disponível da dotação-fonte.
    const anulPorDot = new Map<string, Prisma.Decimal>()
    for (const it of itens) {
      if (it.operacao === 'ANULACAO') {
        anulPorDot.set(it.dotacaoId, (anulPorDot.get(it.dotacaoId) ?? new Prisma.Decimal(0)).plus(it.valor))
      }
    }
    for (const [id, anul] of anulPorDot) {
      const dot = porId.get(id)!
      const disp = saldoDisponivel(dot)
      if (anul.greaterThan(disp)) {
        throw new ErroNegocio('ENTIDADE_NAO_PROCESSAVEL', `Anulação da dotação ${dot.id} excede o saldo disponível.`)
      }
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const credito = await tx.creditoAdicional.create({
          data: {
            orcamentoId,
            tipo: dados.tipo as CreditoAdicionalTipo,
            numero: dados.numero.trim(),
            data: new Date(dados.data),
            atoLegal: dados.atoLegal.trim(),
            justificativa: dados.justificativa?.trim() || null,
            valorTotal: totalReforco,
            itens: {
              create: itens.map((it) => ({
                dotacaoDespesaId: it.dotacaoId,
                operacao: it.operacao as 'REFORCO' | 'ANULACAO',
                valor: it.valor,
              })),
            },
          },
        })
        for (const it of itens) {
          await tx.dotacaoDespesa.update({
            where: { id: it.dotacaoId },
            data: { valorAutorizado: it.operacao === 'REFORCO' ? { increment: it.valor } : { decrement: it.valor } },
          })
        }
        return credito
      })
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ErroNegocio('CONFLITO', 'Já existe um crédito adicional com esse número neste orçamento.')
      }
      throw e
    }
  }
}
