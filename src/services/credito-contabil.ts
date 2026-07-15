import { PrismaClient, Prisma, type CreditoAdicionalTipo } from '@prisma/client'
import { ErroNegocio } from '../errors.js'
import { LancamentosService, type ItemDado } from './lancamentos.js'

/**
 * Contas de controle (folhas do PCASP) do crédito adicional. O eixo é POR TIPO:
 * o reforço debita o crédito do seu tipo e credita o disponível; a anulação
 * debita o disponível e credita o cancelamento de dotações. A disponibilidade
 * (6.2.2.1.1) é a MESMA da abertura/execução — o crédito só segrega o lado "5".
 * O detalhe POR FONTE (5.2.2.1.3.01/02/03/99) é informacional (soma zero no
 * oficial) e exige a origem do crédito, que não modelamos — fica de fora.
 */
export const CONTAS_CREDITO = {
  suplementar: '5.2.2.1.2.01.00.00.00.00.00.00', // D no reforço SUPLEMENTAR
  especial: '5.2.2.1.2.02.01.00.00.00.00.00', // .02 é sintética; a folha é .02.01 (abertos)
  extraordinario: '5.2.2.1.2.03.01.00.00.00.00.00', // idem, folha .03.01
  cancelamento: '5.2.2.1.3.09.00.00.00.00.00.00', // C na anulação — (-) cancelamento de dotações
  disponivel: '6.2.2.1.1.00.00.00.00.00.00.00', // par do reforço/anulação — mesma da abertura
} as const

/** Conta a DEBITAR no reforço, por tipo legal de crédito (Lei 4.320, art. 41). */
const CONTA_POR_TIPO: Record<CreditoAdicionalTipo, keyof typeof CONTAS_CREDITO> = {
  SUPLEMENTAR: 'suplementar',
  ESPECIAL: 'especial',
  EXTRAORDINARIO: 'extraordinario',
}

export type ResumoCreditoContabil = {
  creditos: number
  reforcos: number
  anulacoes: number
  totalReforco: string
  totalAnulacao: string
}

const dec = (v: Prisma.Decimal.Value = 0) => new Prisma.Decimal(v)

/**
 * Espelho contábil dos créditos adicionais (decretos). Cada crédito vira UM
 * lançamento, datado no decreto, segregando o controle orçamentário da despesa:
 *
 *   REFORÇO   → D 5.2.2.1.2.0X (crédito por tipo) / C 6.2.2.1.1 (disponível)
 *   ANULAÇÃO  → D 6.2.2.1.1 (disponível)          / C 5.2.2.1.3.09 (cancelamento)
 *
 * cc = { fonte, dotação } (a mesma dimensão da abertura/execução). Depende da
 * abertura já contabilizada (orçamento EM_EXECUCAO), pois a abertura passou a
 * fixar só o valorINICIAL — o crédito completa o disponível até o autorizado.
 * Idempotente (não contabiliza duas vezes o mesmo crédito) e reversível.
 */
export class CreditoContabilService {
  private lancamentos: LancamentosService

  constructor(private prisma: PrismaClient) {
    this.lancamentos = new LancamentosService(prisma)
  }

  async contabilizar(entidadeId: string, ano: number, usuarioId: string): Promise<ResumoCreditoContabil> {
    const orcamento = await this.prisma.orcamento.findUnique({
      where: { entidadeId_ano: { entidadeId, ano } },
      include: { creditos: { include: { itens: { include: { dotacaoDespesa: { include: { fonteRecurso: { select: { codigo: true } } } } } } } } },
    })
    if (!orcamento) {
      throw new ErroNegocio('ENTIDADE_NAO_PROCESSAVEL', `Não há orçamento (LOA) para ${ano}.`)
    }
    if (orcamento.status !== 'EM_EXECUCAO') {
      throw new ErroNegocio('CONFLITO', 'Contabilize a abertura do exercício antes dos créditos adicionais.')
    }

    // Idempotência: pula os créditos já espelhados no razão.
    const jaFeitos = new Set(
      (
        await this.prisma.lancamento.findMany({
          where: { entidadeId, origemTipo: 'CREDITO_ADICIONAL' },
          select: { origemId: true },
        })
      ).map((l) => l.origemId),
    )
    const pendentes = orcamento.creditos.filter((c) => !jaFeitos.has(c.id))

    // Resolve só as contas efetivamente usadas (tipos presentes + anulação, se houver).
    const tiposPresentes = new Set(pendentes.map((c) => c.tipo))
    const temAnulacao = pendentes.some((c) => c.itens.some((i) => i.operacao === 'ANULACAO'))
    const contas = await this.resolverContas(entidadeId, ano, tiposPresentes, temAnulacao)

    let reforcos = 0
    let anulacoes = 0
    let totalReforco = dec(0)
    let totalAnulacao = dec(0)
    const lancamentosDados = pendentes
      .map((credito) => {
        const contaTipo = contas.porTipo[credito.tipo]
        const itens: ItemDado[] = []
        for (const it of credito.itens) {
          const cc = { fonteCodigo: it.dotacaoDespesa.fonteRecurso.codigo, dotacaoDespesaId: it.dotacaoDespesaId }
          const valor = dec(it.valor).toFixed(2)
          if (it.operacao === 'REFORCO') {
            itens.push({ contaId: contaTipo, tipo: 'DEBITO', valor, ...cc })
            itens.push({ contaId: contas.disponivel, tipo: 'CREDITO', valor, ...cc })
            reforcos++
            totalReforco = totalReforco.plus(it.valor)
          } else {
            itens.push({ contaId: contas.disponivel, tipo: 'DEBITO', valor, ...cc })
            itens.push({ contaId: contas.cancelamento!, tipo: 'CREDITO', valor, ...cc })
            anulacoes++
            totalAnulacao = totalAnulacao.plus(it.valor)
          }
        }
        return { credito, itens }
      })
      .filter((l) => l.itens.length > 0)

    await this.prisma.$transaction(async (tx) => {
      for (const { credito, itens } of lancamentosDados) {
        await this.lancamentos.criar(
          {
            entidadeId,
            data: credito.data.toISOString().slice(0, 10),
            historico: `Crédito adicional ${credito.tipo.toLowerCase()} nº ${credito.numero} (${credito.atoLegal})`,
            itens,
            criadoPorId: usuarioId,
            origemTipo: 'CREDITO_ADICIONAL',
            origemId: credito.id,
            eventoCodigo: '003',
          },
          tx,
        )
      }
    })

    return {
      creditos: lancamentosDados.length,
      reforcos,
      anulacoes,
      totalReforco: totalReforco.toFixed(2),
      totalAnulacao: totalAnulacao.toFixed(2),
    }
  }

  /** Reverte os lançamentos de crédito adicional (revertendo o materializado). */
  async estornar(entidadeId: string, ano: number): Promise<number> {
    const inicio = new Date(Date.UTC(ano, 0, 1))
    const fim = new Date(Date.UTC(ano, 11, 31))
    const creditos = await this.prisma.lancamento.findMany({
      where: { entidadeId, origemTipo: 'CREDITO_ADICIONAL', data: { gte: inicio, lte: fim } },
      include: { itens: true },
    })

    await this.prisma.$transaction(async (tx) => {
      for (const lanc of creditos) {
        const mes = lanc.data.getUTCMonth() + 1
        const ladoAno = lanc.data.getUTCFullYear()
        const totais = new Map<string, { debito: Prisma.Decimal; credito: Prisma.Decimal }>()
        for (const i of lanc.itens) {
          const t = totais.get(i.contaId) ?? { debito: dec(0), credito: dec(0) }
          if (i.tipo === 'DEBITO') t.debito = t.debito.plus(i.valor)
          else t.credito = t.credito.plus(i.valor)
          totais.set(i.contaId, t)
        }
        for (const [contaId, { debito, credito }] of totais) {
          await tx.resumoMensalConta.update({
            where: { entidadeId_contaId_ano_mes: { entidadeId, contaId, ano: ladoAno, mes } },
            data: { totalDebito: { decrement: debito }, totalCredito: { decrement: credito } },
          })
        }
        await tx.lancamento.delete({ where: { id: lanc.id } }) // itens em cascade
      }
    })
    return creditos.length
  }

  private async resolverContas(entidadeId: string, ano: number, tipos: Set<CreditoAdicionalTipo>, temAnulacao: boolean) {
    const codigosPorTipo = new Map<CreditoAdicionalTipo, string>(
      [...tipos].map((t) => [t, CONTAS_CREDITO[CONTA_POR_TIPO[t]]]),
    )
    const codigos = [CONTAS_CREDITO.disponivel, ...codigosPorTipo.values()]
    if (temAnulacao) codigos.push(CONTAS_CREDITO.cancelamento)

    const contas = await this.prisma.contaContabilEntidade.findMany({
      where: { entidadeId, ano, codigo: { in: codigos }, admiteMovimento: true },
      select: { id: true, codigo: true },
    })
    const porCodigo = new Map(contas.map((c) => [c.codigo, c.id]))
    const pegar = (codigo: string) => {
      const id = porCodigo.get(codigo)
      if (!id) {
        throw new ErroNegocio('ENTIDADE_NAO_PROCESSAVEL', `Integração indisponível: conta de controle "${codigo}" não é folha no plano da entidade (exercício ${ano}).`)
      }
      return id
    }
    const porTipo = {} as Record<CreditoAdicionalTipo, string>
    for (const [tipo, codigo] of codigosPorTipo) porTipo[tipo] = pegar(codigo)
    return {
      porTipo,
      disponivel: pegar(CONTAS_CREDITO.disponivel),
      cancelamento: temAnulacao ? pegar(CONTAS_CREDITO.cancelamento) : null,
    }
  }
}
