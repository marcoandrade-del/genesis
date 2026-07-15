import { PrismaClient, Prisma } from '@prisma/client'
import { ErroNegocio } from '../errors.js'
import { LancamentosService, type ItemDado } from './lancamentos.js'

/**
 * Uma linha de Restos a Pagar no razão: conta de controle (5.3.1.x / 6.3.1.x),
 * lado e valor, com a conta-corrente CRUA da despesa (RP de 2025 não tem dotação
 * no orçamento do ano — a cc viaja em campos crus no LancamentoItem).
 */
export type LinhaRp = {
  contaCodigo: string
  tipo: 'DEBITO' | 'CREDITO'
  valor: string
  fonte?: string | null
  funcao?: string | null
  subfuncao?: string | null
  naturezaDespesa?: string | null
}

/** Um movimento de RP = um lançamento (inscrição/abertura ou um mês de execução). */
export type MovimentoRp = {
  data: string // YYYY-MM-DD
  historico: string
  origemId: string // idempotência (ex.: "rp-abertura-2026", "rp-exec-2026-03")
  eventoCodigo: string
  linhas: LinhaRp[]
}

export type ResumoRp = { lancamentos: number; itens: number; totalDebito: string; totalCredito: string }

const dec = (v: Prisma.Decimal.Value = 0) => new Prisma.Decimal(v)

/**
 * Espelho contábil dos Restos a Pagar (carregados de 2025), a partir da MSC
 * OFICIAL do Siconfi (dev é greenfield em 2025). Cada movimento vira um
 * lançamento com cc crua da despesa; a partida dobrada tem de fechar em cada
 * um (Σ D = Σ C). Idempotente por `origemId` e reversível.
 */
export class RestosAPagarContabilService {
  private lancamentos: LancamentosService

  constructor(private prisma: PrismaClient) {
    this.lancamentos = new LancamentosService(prisma)
  }

  async contabilizar(entidadeId: string, ano: number, movimentos: MovimentoRp[], usuarioId: string): Promise<ResumoRp> {
    // idempotência: pula movimentos já contabilizados.
    const jaFeitos = new Set(
      (
        await this.prisma.lancamento.findMany({ where: { entidadeId, origemTipo: 'RESTOS_A_PAGAR' }, select: { origemId: true } })
      ).map((l) => l.origemId),
    )
    const pendentes = movimentos.filter((m) => !jaFeitos.has(m.origemId))

    // resolve as contas de controle usadas (folhas do plano da entidade).
    const codigos = [...new Set(pendentes.flatMap((m) => m.linhas.map((l) => l.contaCodigo)))]
    const contas = await this.prisma.contaContabilEntidade.findMany({
      where: { entidadeId, ano, codigo: { in: codigos }, admiteMovimento: true },
      select: { id: true, codigo: true },
    })
    const idPorCodigo = new Map(contas.map((c) => [c.codigo, c.id]))
    const pegar = (codigo: string) => {
      const id = idPorCodigo.get(codigo)
      if (!id) throw new ErroNegocio('ENTIDADE_NAO_PROCESSAVEL', `Conta de controle de RP "${codigo}" não é folha no plano da entidade (exercício ${ano}).`)
      return id
    }

    let itens = 0
    let totalDebito = dec(0)
    let totalCredito = dec(0)
    const preparados = pendentes.map((mov) => {
      let d = dec(0)
      let c = dec(0)
      const itensDados: ItemDado[] = mov.linhas.map((l) => {
        if (l.tipo === 'DEBITO') d = d.plus(l.valor)
        else c = c.plus(l.valor)
        return {
          contaId: pegar(l.contaCodigo),
          tipo: l.tipo,
          valor: dec(l.valor).toFixed(2),
          fonteCodigo: l.fonte ?? null,
          funcaoCodigo: l.funcao ?? null,
          subfuncaoCodigo: l.subfuncao ?? null,
          naturezaDespesaCodigo: l.naturezaDespesa ?? null,
        }
      })
      if (!d.equals(c)) {
        throw new ErroNegocio('ENTIDADE_NAO_PROCESSAVEL', `Movimento de RP "${mov.origemId}" não fecha: D ${d.toFixed(2)} ≠ C ${c.toFixed(2)}.`)
      }
      itens += itensDados.length
      totalDebito = totalDebito.plus(d)
      totalCredito = totalCredito.plus(c)
      return { mov, itensDados }
    })

    await this.prisma.$transaction(async (tx) => {
      for (const { mov, itensDados } of preparados) {
        await this.lancamentos.criar(
          { entidadeId, data: mov.data, historico: mov.historico, itens: itensDados, criadoPorId: usuarioId, origemTipo: 'RESTOS_A_PAGAR', origemId: mov.origemId, eventoCodigo: mov.eventoCodigo },
          tx,
        )
      }
    })

    return { lancamentos: preparados.length, itens, totalDebito: totalDebito.toFixed(2), totalCredito: totalCredito.toFixed(2) }
  }

  /** Reverte todos os lançamentos de RP do ano (revertendo o materializado). */
  async estornar(entidadeId: string, ano: number): Promise<number> {
    const inicio = new Date(Date.UTC(ano, 0, 1))
    const fim = new Date(Date.UTC(ano, 11, 31))
    const lancs = await this.prisma.lancamento.findMany({
      where: { entidadeId, origemTipo: 'RESTOS_A_PAGAR', data: { gte: inicio, lte: fim } },
      include: { itens: true },
    })
    await this.prisma.$transaction(async (tx) => {
      for (const lanc of lancs) {
        const mes = lanc.data.getUTCMonth() + 1
        const ladoAno = lanc.data.getUTCFullYear()
        const totais = new Map<string, { debito: Prisma.Decimal; credito: Prisma.Decimal }>()
        for (const i of lanc.itens) {
          const t = totais.get(i.contaId) ?? { debito: dec(0), credito: dec(0) }
          if (i.tipo === 'DEBITO') t.debito = t.debito.plus(i.valor)
          else t.credito = t.credito.plus(i.valor)
          totais.set(i.contaId, t)
        }
        for (const [contaId, { debito, credito }] of totais)
          await tx.resumoMensalConta.update({
            where: { entidadeId_contaId_ano_mes: { entidadeId, contaId, ano: ladoAno, mes } },
            data: { totalDebito: { decrement: debito }, totalCredito: { decrement: credito } },
          })
        await tx.lancamento.delete({ where: { id: lanc.id } })
      }
    })
    return lancs.length
  }
}
