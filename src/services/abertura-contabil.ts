import { PrismaClient, Prisma } from '@prisma/client'
import { ErroNegocio } from '../errors.js'
import { LancamentosService, type ItemDado } from './lancamentos.js'
import { SaldoContabilService } from './saldo-contabil.js'

/**
 * Contas de controle (folhas fixas do PCASP) usadas na abertura do orçamentário.
 * Direção derivada do motor da execução (E100 debita "a realizar"; E600 debita
 * "disponível") para que abertura + execução zerem ao fim do exercício.
 */
export const CONTAS_ABERTURA = {
  receitaARealizar: '6.2.1.1.0.00.00.00.00.00.00.00', // C na previsão
  previsaoInicialReceita: '5.2.1.1.1.00.00.00.00.00.00.00', // D na previsão
  creditoInicial: '5.2.2.1.1.01.00.00.00.00.00.00', // D na fixação
  creditoDisponivel: '6.2.2.1.1.00.00.00.00.00.00.00', // C na fixação
} as const

export type StatusAbertura = {
  orcamentoId: string | null
  status: 'SEM_ORCAMENTO' | 'RASCUNHO' | 'APROVADO' | 'EM_EXECUCAO'
  contabilizada: boolean
  podeContabilizar: boolean
  podeEstornar: boolean
  temExecucao: boolean
}

export type ResumoAberturaContabil = {
  previsoes: number
  dotacoes: number
  totalPrevisto: string
  totalFixado: string
  contasTransportadas: number
}

const dec = (v: Prisma.Decimal.Value = 0) => new Prisma.Decimal(v)

/**
 * Abertura contábil do exercício (PCASP). Roda DEPOIS que a LOA está APROVADA e
 * gera, por entidade, os lançamentos de abertura — em uma transação:
 *
 *  - Parte A (orçamentário, a partir da LOA aprovada):
 *      Previsão da receita  → D 5.2.1.1.1 (previsão inicial) / C 6.2.1.1.0 (a realizar), cc natureza+fonte.
 *      Fixação da despesa   → D 5.2.2.1.1.01 (crédito inicial) / C 6.2.2.1.1 (crédito disponível), cc dotação+fonte.
 *  - Parte B (transporte de saldos patrimoniais do ano anterior):
 *      SaldoInicialAno[ano] = |saldo final[ano−1]| para as folhas do balanço (classes 1 e 2).
 *      As contas de resultado (3 VPD / 4 VPA) encerram no PL e começam zeradas.
 *
 * Ao concluir, o orçamento passa de APROVADO → EM_EXECUCAO. Idempotente (não abre
 * duas vezes) e reversível (`estornar`) enquanto não houve execução.
 */
export class AberturaContabilService {
  private lancamentos: LancamentosService
  private saldos: SaldoContabilService

  constructor(private prisma: PrismaClient) {
    this.lancamentos = new LancamentosService(prisma)
    this.saldos = new SaldoContabilService(prisma)
  }

  /** Situação da abertura p/ gating da UI. */
  async status(entidadeId: string, ano: number): Promise<StatusAbertura> {
    const orcamento = await this.prisma.orcamento.findUnique({ where: { entidadeId_ano: { entidadeId, ano } } })
    const temExecucao = await this.temExecucaoAlemDaAbertura(entidadeId, ano)
    if (!orcamento) {
      return { orcamentoId: null, status: 'SEM_ORCAMENTO', contabilizada: false, podeContabilizar: false, podeEstornar: false, temExecucao }
    }
    const contabilizada = orcamento.status === 'EM_EXECUCAO'
    return {
      orcamentoId: orcamento.id,
      status: orcamento.status,
      contabilizada,
      podeContabilizar: orcamento.status === 'PUBLICADO',
      podeEstornar: contabilizada && !temExecucao,
      temExecucao,
    }
  }

  async contabilizar(entidadeId: string, ano: number, usuarioId: string): Promise<ResumoAberturaContabil> {
    const orcamento = await this.prisma.orcamento.findUnique({
      where: { entidadeId_ano: { entidadeId, ano } },
      include: {
        previsoes: { include: { contaReceita: { select: { codigo: true } }, fonteRecurso: { select: { codigo: true } } } },
        dotacoes: { include: { fonteRecurso: { select: { codigo: true } } } },
      },
    })
    if (!orcamento) {
      throw new ErroNegocio('ENTIDADE_NAO_PROCESSAVEL', `Não há orçamento (LOA) para ${ano} — crie e publique o orçamento antes de contabilizar a abertura.`)
    }
    if (orcamento.status === 'EM_EXECUCAO') {
      throw new ErroNegocio('CONFLITO', `A abertura do exercício ${ano} já foi contabilizada.`)
    }
    if (orcamento.status !== 'PUBLICADO') {
      throw new ErroNegocio('CONFLITO', 'A LOA precisa estar publicada antes de contabilizar a abertura.')
    }

    const contas = await this.resolverContasControle(entidadeId, ano)
    const data = `${ano}-01-01`

    // Parte A — itens da previsão e da fixação.
    const itensPrevisao: ItemDado[] = []
    let totalPrevisto = dec(0)
    for (const p of orcamento.previsoes) {
      if (dec(p.valorPrevisto).lessThanOrEqualTo(0)) continue
      const cc = { naturezaReceitaCodigo: p.contaReceita.codigo, fonteCodigo: p.fonteRecurso.codigo }
      const valor = dec(p.valorPrevisto).toFixed(2)
      itensPrevisao.push({ contaId: contas.previsaoInicialReceita, tipo: 'DEBITO', valor, ...cc })
      itensPrevisao.push({ contaId: contas.receitaARealizar, tipo: 'CREDITO', valor, ...cc })
      totalPrevisto = totalPrevisto.plus(p.valorPrevisto)
    }

    const itensFixacao: ItemDado[] = []
    let totalFixado = dec(0)
    for (const d of orcamento.dotacoes) {
      if (dec(d.valorAutorizado).lessThanOrEqualTo(0)) continue
      // cc = dotação (funcional-programática completa) + fonte — a mesma dimensão que o
      // motor da despesa carimba na execução; sem ela, a linha 6.2.2.1.1×dotação da MSC
      // só recebe os débitos do empenho e aparece invertida (credora com saldo devedor).
      const cc = { fonteCodigo: d.fonteRecurso.codigo, dotacaoDespesaId: d.id }
      const valor = dec(d.valorAutorizado).toFixed(2)
      itensFixacao.push({ contaId: contas.creditoInicial, tipo: 'DEBITO', valor, ...cc })
      itensFixacao.push({ contaId: contas.creditoDisponivel, tipo: 'CREDITO', valor, ...cc })
      totalFixado = totalFixado.plus(d.valorAutorizado)
    }

    // Parte B — transporte dos saldos patrimoniais (só se houver ano anterior).
    const transporte = await this.calcularTransporte(entidadeId, ano)

    const resumo = await this.prisma.$transaction(async (tx) => {
      if (itensPrevisao.length) {
        await this.lancamentos.criar(
          { entidadeId, data, historico: 'Abertura do exercício — previsão da receita', itens: itensPrevisao, criadoPorId: usuarioId, origemTipo: 'ABERTURA', origemId: orcamento.id, eventoCodigo: '001' },
          tx,
        )
      }
      if (itensFixacao.length) {
        await this.lancamentos.criar(
          { entidadeId, data, historico: 'Abertura do exercício — fixação da despesa', itens: itensFixacao, criadoPorId: usuarioId, origemTipo: 'ABERTURA', origemId: orcamento.id, eventoCodigo: '002' },
          tx,
        )
      }
      for (const t of transporte) {
        await tx.saldoInicialAno.upsert({
          where: { entidadeId_contaId_ano: { entidadeId, contaId: t.contaId, ano } },
          create: { entidadeId, contaId: t.contaId, ano, valor: t.valor },
          update: { valor: t.valor },
        })
      }
      await tx.transicaoStatusOrcamento.create({
        data: { orcamentoId: orcamento.id, de: orcamento.status, para: 'EM_EXECUCAO', autorId: usuarioId, observacao: 'Abertura do exercício contabilizada.' },
      })
      await tx.orcamento.update({ where: { id: orcamento.id }, data: { status: 'EM_EXECUCAO' } })

      return {
        previsoes: itensPrevisao.length / 2,
        dotacoes: itensFixacao.length / 2,
        totalPrevisto: totalPrevisto.toFixed(2),
        totalFixado: totalFixado.toFixed(2),
        contasTransportadas: transporte.length,
      }
    })
    return resumo
  }

  async estornar(entidadeId: string, ano: number, usuarioId: string): Promise<void> {
    const orcamento = await this.prisma.orcamento.findUnique({ where: { entidadeId_ano: { entidadeId, ano } } })
    if (!orcamento) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Orçamento não encontrado.')
    if (orcamento.status !== 'EM_EXECUCAO') {
      throw new ErroNegocio('CONFLITO', 'A abertura deste exercício não está contabilizada.')
    }
    if (await this.temExecucaoAlemDaAbertura(entidadeId, ano)) {
      throw new ErroNegocio('CONFLITO', 'A execução já começou — estorne os movimentos do exercício antes de reverter a abertura.')
    }

    const aberturas = await this.prisma.lancamento.findMany({
      where: { entidadeId, origemTipo: 'ABERTURA', origemId: orcamento.id },
      include: { itens: true },
    })

    await this.prisma.$transaction(async (tx) => {
      for (const lanc of aberturas) {
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
      // Limpa o transporte de saldos do ano (a abertura é a única origem dele).
      await tx.saldoInicialAno.deleteMany({ where: { entidadeId, ano } })
      await tx.transicaoStatusOrcamento.create({
        data: { orcamentoId: orcamento.id, de: 'EM_EXECUCAO', para: 'PUBLICADO', autorId: usuarioId, observacao: 'Abertura do exercício estornada.' },
      })
      await tx.orcamento.update({ where: { id: orcamento.id }, data: { status: 'PUBLICADO' } })
    })
  }

  /** Há lançamentos no exercício que NÃO são da abertura? (manual ou execução) */
  private async temExecucaoAlemDaAbertura(entidadeId: string, ano: number): Promise<boolean> {
    const inicio = new Date(Date.UTC(ano, 0, 1))
    const fim = new Date(Date.UTC(ano, 11, 31))
    const n = await this.prisma.lancamento.count({
      where: { entidadeId, data: { gte: inicio, lte: fim }, NOT: { origemTipo: 'ABERTURA' } },
    })
    return n > 0
  }

  private async resolverContasControle(entidadeId: string, ano: number) {
    const codigos = Object.values(CONTAS_ABERTURA)
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
    return {
      receitaARealizar: pegar(CONTAS_ABERTURA.receitaARealizar),
      previsaoInicialReceita: pegar(CONTAS_ABERTURA.previsaoInicialReceita),
      creditoInicial: pegar(CONTAS_ABERTURA.creditoInicial),
      creditoDisponivel: pegar(CONTAS_ABERTURA.creditoDisponivel),
    }
  }

  /**
   * Transporte: para cada folha do balanço (classes 1 e 2) com saldo no ano
   * anterior, mapeia o código → conta do ano novo e guarda a MAGNITUDE do saldo
   * (SaldoInicialAno é magnitude; o sinal vem da natureza no cálculo).
   */
  private async calcularTransporte(entidadeId: string, ano: number): Promise<{ contaId: string; valor: Prisma.Decimal }[]> {
    const anoAnterior = ano - 1
    const contasAnt = await this.prisma.contaContabilEntidade.findMany({
      where: { entidadeId, ano: anoAnterior, admiteMovimento: true },
      select: { id: true, codigo: true },
    })
    if (contasAnt.length === 0) return [] // greenfield: nada a transportar

    const saldos = await this.saldos.calcular(entidadeId, anoAnterior, new Date(Date.UTC(anoAnterior, 11, 31)))
    const contasAno = await this.prisma.contaContabilEntidade.findMany({
      where: { entidadeId, ano, admiteMovimento: true },
      select: { id: true, codigo: true },
    })
    const idPorCodigoAno = new Map(contasAno.map((c) => [c.codigo, c.id]))

    const out: { contaId: string; valor: Prisma.Decimal }[] = []
    for (const c of contasAnt) {
      if (!(c.codigo.startsWith('1.') || c.codigo.startsWith('2.'))) continue // só balanço
      const saldo = saldos.get(c.id)
      if (!saldo || saldo.saldoAtual.isZero()) continue
      const contaIdAno = idPorCodigoAno.get(c.codigo)
      if (!contaIdAno) continue // conta sumiu no plano novo — ignora
      out.push({ contaId: contaIdAno, valor: saldo.saldoAtual.abs() })
    }
    return out
  }
}
