import { PrismaClient, Prisma } from '@prisma/client'
import { ErroNegocio } from '../errors.js'
import { MotorEventosReceita } from './motor-eventos-receita.js'
import { LancamentosService } from './lancamentos.js'

export interface DadosTransferenciaFinanceira {
  entidadeId: string
  data: string // YYYY-MM-DD
  valor: string
  fonteCodigo: string
  historico?: string
  criadoPorId: string // autor (para os lançamentos contábeis gerados)
  /** Estorno: inverte D↔C dos lançamentos gerados. */
  estorno?: boolean
  /** Folha de caixa a debitar; default = caixa de arrecadação da entidade. */
  caixaCodigo?: string | null
}

/**
 * Registra uma TRANSFERÊNCIA FINANCEIRA RECEBIDA (duodécimo/repasse intra-ente, ex.:
 * Executivo → Câmara) e dispara, na MESMA transação, o evento contábil 900 no razão:
 * D Caixa / C VPA "Repasse Recebido" (4.5.1.1.2.02). NÃO é receita orçamentária — não
 * toca 6.2.1.x nem DDR. Espelha `ArrecadacoesService.criar` (motor → LancamentosService).
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
    const histBase = dados.historico?.trim() || 'Transferência financeira recebida'

    return this.prisma.$transaction(async (tx) => {
      const tf = await tx.transferenciaFinanceira.create({
        data: {
          entidadeId: dados.entidadeId,
          data: new Date(dados.data),
          valor,
          fonteCodigo,
          historico: dados.historico?.trim() || null,
          criadoPorId: dados.criadoPorId,
        },
      })
      // Integração contábil (Tabela de Eventos): dispara o evento 900 no razão, na
      // mesma transação. O estorno gera os lançamentos invertidos.
      const eventos = await this.motor.resolverTransferenciaFinanceira(
        { entidadeId: dados.entidadeId, ano, fonteCodigo, valor, caixaCodigo: dados.caixaCodigo },
        { estorno: dados.estorno },
        tx,
      )
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
