import { PrismaClient, Prisma } from '@prisma/client'
import { ErroNegocio } from '../errors.js'
import { MotorEventosReceita } from './motor-eventos-receita.js'
import { LancamentosService } from './lancamentos.js'

export interface DadosTransferenciaFinanceira {
  entidadeId: string
  /** RECEBIDA (default, evento 900) ou CONCEDIDA (espelho no Executivo, evento 901). */
  tipo?: 'RECEBIDA' | 'CONCEDIDA'
  data: string // YYYY-MM-DD
  valor: string
  fonteCodigo: string
  historico?: string
  criadoPorId: string // autor (para os lançamentos contábeis gerados)
  /** Estorno: inverte D↔C dos lançamentos gerados. */
  estorno?: boolean
  /** Folha de caixa a debitar (recebida) / creditar (concedida); default = caixa de arrecadação. */
  caixaCodigo?: string | null
}

/**
 * Registra uma TRANSFERÊNCIA FINANCEIRA intra-ente (duodécimo/repasse) e dispara,
 * na MESMA transação, o evento contábil no razão:
 *  - RECEBIDA (câmara/fundo/RPPS): evento 900 — D Caixa / C VPA 4.5.1.1.2.02;
 *  - CONCEDIDA (o espelho no Executivo): evento 901 — D VPD 3.5.1.1.2.02 / C Caixa.
 * NÃO é receita/despesa orçamentária — não toca 6.x nem DDR. Espelha
 * `ArrecadacoesService.criar` (motor → LancamentosService).
 */
export class TransferenciasFinanceirasService {
  private motor: MotorEventosReceita
  private lancamentos: LancamentosService

  constructor(private prisma: PrismaClient) {
    this.motor = new MotorEventosReceita(prisma)
    this.lancamentos = new LancamentosService(prisma)
  }

  async registrar(dados: DadosTransferenciaFinanceira) {
    const valor = new Prisma.Decimal(dados.valor)
    if (valor.lessThanOrEqualTo(0)) throw new ErroNegocio('REQUISICAO_INVALIDA', 'O valor da transferência financeira deve ser positivo.')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dados.data)) throw new ErroNegocio('REQUISICAO_INVALIDA', 'Data inválida (use YYYY-MM-DD).')
    if (!dados.fonteCodigo?.trim()) throw new ErroNegocio('REQUISICAO_INVALIDA', 'Fonte de recurso obrigatória.')
    const ano = Number(dados.data.slice(0, 4))
    const fonteCodigo = dados.fonteCodigo.trim()
    const tipo = dados.tipo ?? 'RECEBIDA'
    const histBase = dados.historico?.trim() || (tipo === 'CONCEDIDA' ? 'Transferência financeira concedida' : 'Transferência financeira recebida')

    return this.prisma.$transaction(async (tx) => {
      const tf = await tx.transferenciaFinanceira.create({
        data: {
          entidadeId: dados.entidadeId,
          tipo,
          data: new Date(dados.data),
          valor,
          fonteCodigo,
          historico: dados.historico?.trim() || null,
          criadoPorId: dados.criadoPorId,
        },
      })
      // Integração contábil (Tabela de Eventos): dispara o evento (900 recebida /
      // 901 concedida) no razão, na mesma transação. Estorno inverte D↔C.
      const ctx = { entidadeId: dados.entidadeId, ano, fonteCodigo, valor, caixaCodigo: dados.caixaCodigo }
      const eventos =
        tipo === 'CONCEDIDA'
          ? await this.motor.resolverTransferenciaConcedida(ctx, { estorno: dados.estorno }, tx)
          : await this.motor.resolverTransferenciaFinanceira(ctx, { estorno: dados.estorno }, tx)
      for (const ev of eventos) {
        await this.lancamentos.criar(
          {
            entidadeId: dados.entidadeId,
            data: dados.data,
            historico: `${ev.descricaoEvento} — ${histBase}`,
            itens: ev.itens,
            criadoPorId: dados.criadoPorId,
            origemTipo: 'TRANSFERENCIA_FINANCEIRA',
            origemId: tf.id,
            eventoCodigo: ev.eventoCodigo,
          },
          tx,
        )
      }
      return tf
    })
  }

  /** Lançamentos contábeis gerados por uma transferência (rastreabilidade →). */
  lancamentosDoMovimento(transferenciaId: string) {
    return this.prisma.lancamento.findMany({
      where: { origemTipo: 'TRANSFERENCIA_FINANCEIRA', origemId: transferenciaId },
      include: { itens: true },
      orderBy: { eventoCodigo: 'asc' },
    })
  }
}
