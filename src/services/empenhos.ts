import { PrismaClient, Prisma, type TipoEmpenho } from '@prisma/client'
import { ErroNegocio } from '../errors.js'
import { trimOuNull, parseDecimalPositivo } from './planos-contratacao.js'
import { saldoDisponivel } from './reservas-dotacao.js'
import { resumirEmpenho, validarLancamento } from './saldos-empenho.js'
import { MotorEventosDespesa, gravarEventos, isoData } from './motor-eventos-despesa.js'
import { LancamentosService } from './lancamentos.js'

export type DadosEmpenho = {
  dotacaoDespesaId: string
  fornecedorId: string
  reservaDotacaoId?: string | null
  contratoId?: string | null
  ataRegistroPrecoId?: string | null
  subElementoContaId: string
  numero: string
  tipo: TipoEmpenho
  data?: Date | string | null
  valor: string | number
  historico?: string | null
}

const TIPOS: ReadonlyArray<TipoEmpenho> = ['ORDINARIO', 'GLOBAL', 'ESTIMATIVO']

/**
 * Empenho (1º estágio da despesa). Compromete o orçamento e cria a obrigação
 * com o fornecedor.
 *
 * REGRA 2 (Conversão de Saldo): ao empenhar a partir de uma reserva, baixa a
 * reserva (status BAIXADA, estorna `valorReservado`) e soma `valorEmpenhado` na
 * dotação — sem duplicar o bloqueio. Empenho direto (sem reserva) consome o
 * saldo disponível. Tudo na mesma transação.
 */
export class EmpenhosService {
  private motor: MotorEventosDespesa
  private lancamentos: LancamentosService

  constructor(private prisma: PrismaClient) {
    this.motor = new MotorEventosDespesa(prisma)
    this.lancamentos = new LancamentosService(prisma)
  }

  listar(entidadeId: string) {
    return this.prisma.empenho.findMany({
      where: { entidadeId },
      orderBy: { data: 'desc' },
      include: {
        fornecedor: { select: { razaoSocial: true } },
        dotacaoDespesa: { include: { unidadeOrcamentaria: true, contaDespesa: true, fonteRecurso: true } },
        _count: { select: { liquidacoes: true } },
      },
    })
  }

  buscarPorId(id: string) {
    return this.prisma.empenho.findUnique({
      where: { id },
      include: { fornecedor: true, dotacaoDespesa: true, reservaDotacao: { select: { id: true, numero: true } } },
    })
  }

  /**
   * Ficha de empenho: o empenho + a razão imutável (movimentos) + o resumo das 6
   * colunas/saldos (Specs 22-06-2026 §8). É a "movimentação da despesa" da ficha.
   */
  async ficha(id: string) {
    const empenho = await this.prisma.empenho.findUnique({
      where: { id },
      include: {
        fornecedor: { select: { razaoSocial: true, cnpj: true, cpf: true } },
        subElementoConta: { select: { codigo: true, descricao: true } },
        dotacaoDespesa: {
          include: {
            unidadeOrcamentaria: { select: { codigo: true, nome: true, orgao: { select: { codigo: true, nome: true } } } },
            contaDespesa: { select: { codigo: true, descricao: true } },
            fonteRecurso: { select: { codigo: true, nomenclatura: true } },
          },
        },
      },
    })
    if (!empenho) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Empenho não encontrado.')
    const movimentos = await this.prisma.movimentoEmpenho.findMany({
      where: { empenhoId: id },
      orderBy: [{ data: 'asc' }, { criadoEm: 'asc' }],
    })
    return { empenho, movimentos, resumo: resumirEmpenho(movimentos), trilha: await this.trilhaContabil(id) }
  }

  /**
   * Trilha contábil do empenho: os lançamentos automáticos (E6xx/E7xx/E8xx) que a
   * execução disparou via Tabela de Eventos, em todo o ciclo do empenho (o próprio
   * empenho + suas liquidações + as ordens de pagamento delas). Rastreabilidade →.
   */
  async trilhaContabil(empenhoId: string) {
    const liquidacoes = await this.prisma.liquidacao.findMany({
      where: { empenhoId },
      select: { id: true, ordensPagamento: { select: { id: true } } },
    })
    const liqIds = liquidacoes.map((l) => l.id)
    const opIds = liquidacoes.flatMap((l) => l.ordensPagamento.map((o) => o.id))
    return this.prisma.lancamento.findMany({
      where: {
        OR: [
          { origemTipo: 'EMPENHO', origemId: empenhoId },
          ...(liqIds.length ? [{ origemTipo: 'LIQUIDACAO' as const, origemId: { in: liqIds } }] : []),
          ...(opIds.length ? [{ origemTipo: 'PAGAMENTO' as const, origemId: { in: opIds } }] : []),
        ],
      },
      include: { itens: { orderBy: { tipo: 'desc' }, include: { conta: { select: { codigo: true, descricao: true } } } } }, // DEBITO antes de CREDITO
      orderBy: [{ data: 'asc' }, { criadoEm: 'asc' }],
    })
  }

  async criar(entidadeId: string, dados: DadosEmpenho, usuarioId: string) {
    const entidade = await this.prisma.entidade.findUnique({ where: { id: entidadeId } })
    if (!entidade) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Entidade não encontrada.')

    const numero = dados.numero?.trim()
    if (!numero) throw new ErroNegocio('REQUISICAO_INVALIDA', 'Número do empenho é obrigatório.')
    if (!TIPOS.includes(dados.tipo)) throw new ErroNegocio('REQUISICAO_INVALIDA', 'Tipo de empenho inválido.')
    const valor = parseDecimalPositivo(dados.valor, 'Valor do empenho')

    const fornecedor = await this.prisma.fornecedor.findUnique({ where: { id: dados.fornecedorId } })
    if (!fornecedor || !fornecedor.ativo) throw new ErroNegocio('REQUISICAO_INVALIDA', 'Fornecedor inválido ou inativo.')

    const dotacao = await this.carregarDotacao(dados.dotacaoDespesaId, entidadeId)
    const reserva = await this.carregarReserva(dados.reservaDotacaoId, entidadeId, dados.dotacaoDespesaId)
    await this.validarVinculos(dados, entidadeId)
    await this.validarSubElemento(dados.subElementoContaId, dotacao.contaDespesa.codigo, entidadeId, dotacao.orcamento.ano)

    if (reserva) {
      if (valor.greaterThan(reserva.valor)) {
        throw new ErroNegocio('REQUISICAO_INVALIDA', 'Valor do empenho não pode exceder o da reserva convertida.')
      }
    } else {
      const disp = saldoDisponivel(dotacao)
      if (valor.greaterThan(disp)) {
        throw new ErroNegocio(
          'ENTIDADE_NAO_PROCESSAVEL',
          `Saldo insuficiente na dotação: disponível R$ ${disp.toFixed(2)}, empenho R$ ${valor.toFixed(2)}.`,
        )
      }
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const empenho = await tx.empenho.create({
          data: {
            entidadeId,
            dotacaoDespesaId: dados.dotacaoDespesaId,
            fornecedorId: dados.fornecedorId,
            reservaDotacaoId: reserva?.id ?? null,
            contratoId: trimOuNull(dados.contratoId),
            ataRegistroPrecoId: trimOuNull(dados.ataRegistroPrecoId),
            subElementoContaId: dados.subElementoContaId.trim(),
            numero,
            tipo: dados.tipo,
            valor,
            historico: trimOuNull(dados.historico),
            ...(dados.data ? { data: new Date(dados.data) } : {}),
          },
        })
        // Razão imutável: lançamento EMPENHO da ficha (Specs 22-06-2026 §8).
        await tx.movimentoEmpenho.create({
          data: { entidadeId, empenhoId: empenho.id, tipo: 'EMPENHO', valor, data: empenho.data, criadoPorId: usuarioId, historico: `Empenho ${numero}` },
        })
        if (reserva) {
          await tx.reservaDotacao.update({ where: { id: reserva.id }, data: { status: 'BAIXADA' } })
          await tx.dotacaoDespesa.update({
            where: { id: dados.dotacaoDespesaId },
            data: { valorReservado: { decrement: reserva.valor }, valorEmpenhado: { increment: valor } },
          })
        } else {
          await tx.dotacaoDespesa.update({
            where: { id: dados.dotacaoDespesaId },
            data: { valorEmpenhado: { increment: valor } },
          })
        }
        // Integração contábil (Tabela de Eventos): o empenho dispara os
        // lançamentos automáticos (E600/E601) na mesma transação.
        await this.dispararEmpenho(tx, {
          entidadeId,
          ano: dotacao.orcamento.ano,
          dotacaoDespesaId: dados.dotacaoDespesaId,
          naturezaCodigo: dotacao.contaDespesa.codigo,
          valor,
          data: isoData(empenho.data),
          historico: `Empenho ${numero}`,
          origemId: empenho.id,
          criadoPorId: usuarioId,
        })
        return empenho
      })
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ErroNegocio('CONFLITO', `Já existe um empenho nº "${numero}" nesta entidade.`)
      }
      throw e
    }
  }

  /**
   * Estorna o empenho (do saldo a liquidar). O valor define se é parcial ou total —
   * o núcleo valida `Σ estornos ≤ saldo do empenho` e a anterioridade. Ao zerar o net
   * empenhado, vira ANULADO. Estorna o empenhado na dotação.
   */
  async estornar(id: string, valor: string | number, usuarioId: string, data: Date = new Date()) {
    const empenho = await this.prisma.empenho.findUnique({
      where: { id },
      include: { dotacaoDespesa: { include: { orcamento: { select: { ano: true } }, contaDespesa: { select: { codigo: true } } } } },
    })
    if (!empenho) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Empenho não encontrado.')
    const v = parseDecimalPositivo(valor, 'Valor do estorno')
    const movimentos = await this.prisma.movimentoEmpenho.findMany({ where: { empenhoId: id } })
    validarLancamento(movimentos, { tipo: 'ESTORNO_EMPENHO', valor: v, data }, { empenho: empenho.data })
    return this.prisma.$transaction(async (tx) => {
      await tx.movimentoEmpenho.create({
        data: { entidadeId: empenho.entidadeId, empenhoId: id, tipo: 'ESTORNO_EMPENHO', valor: v, data, criadoPorId: usuarioId, historico: `Estorno do empenho ${empenho.numero}` },
      })
      await tx.dotacaoDespesa.update({ where: { id: empenho.dotacaoDespesaId }, data: { valorEmpenhado: { decrement: v } } })
      if (resumirEmpenho([...movimentos, { tipo: 'ESTORNO_EMPENHO', valor: v }]).netEmpenhado.isZero()) {
        await tx.empenho.update({ where: { id }, data: { status: 'ANULADO' } })
      }
      // Integração contábil: o estorno do empenho inverte E600/E601 na mesma transação.
      await this.dispararEmpenho(tx, {
        entidadeId: empenho.entidadeId,
        ano: empenho.dotacaoDespesa.orcamento.ano,
        dotacaoDespesaId: empenho.dotacaoDespesaId,
        naturezaCodigo: empenho.dotacaoDespesa.contaDespesa.codigo,
        valor: v,
        data: isoData(data),
        historico: `Estorno do empenho ${empenho.numero}`,
        origemId: empenho.id,
        criadoPorId: usuarioId,
        estorno: true,
      })
      return { id, estornado: v.toFixed(2) }
    })
  }

  /**
   * Dispara os lançamentos contábeis do empenho (E600 orçamentário + E601 DDR)
   * via Tabela de Eventos, dentro da transação. `estorno` inverte cada par D↔C.
   * Como na receita, falha (rollback) se o plano da entidade não tiver as folhas:
   * num sistema contábil, plano incompleto é erro de configuração e deve aparecer.
   */
  private async dispararEmpenho(
    tx: Prisma.TransactionClient,
    args: {
      entidadeId: string
      ano: number
      dotacaoDespesaId: string
      naturezaCodigo: string
      valor: Prisma.Decimal
      data: string
      historico: string
      origemId: string
      criadoPorId: string
      estorno?: boolean
    },
  ) {
    const eventos = await this.motor.resolverEmpenho(
      { entidadeId: args.entidadeId, ano: args.ano, dotacaoDespesaId: args.dotacaoDespesaId, naturezaCodigo: args.naturezaCodigo, valor: args.valor },
      { estorno: args.estorno },
      tx,
    )
    await gravarEventos(
      this.lancamentos,
      eventos,
      { entidadeId: args.entidadeId, data: args.data, histBase: args.historico, origemTipo: 'EMPENHO', origemId: args.origemId, criadoPorId: args.criadoPorId },
      tx,
    )
  }

  private async carregarDotacao(dotacaoDespesaId: string, entidadeId: string) {
    if (!dotacaoDespesaId?.trim()) throw new ErroNegocio('REQUISICAO_INVALIDA', 'Dotação é obrigatória.')
    const dotacao = await this.prisma.dotacaoDespesa.findUnique({
      where: { id: dotacaoDespesaId },
      include: { orcamento: { select: { entidadeId: true, status: true, ano: true } }, contaDespesa: { select: { codigo: true } } },
    })
    if (!dotacao || dotacao.orcamento.entidadeId !== entidadeId) {
      throw new ErroNegocio('REQUISICAO_INVALIDA', 'Dotação inválida para esta entidade.')
    }
    if (dotacao.orcamento.status === 'RASCUNHO') {
      throw new ErroNegocio('CONFLITO', 'Não é possível empenhar contra orçamento em RASCUNHO.')
    }
    return dotacao
  }

  private async carregarReserva(reservaId: string | null | undefined, entidadeId: string, dotacaoDespesaId: string) {
    const id = trimOuNull(reservaId)
    if (!id) return null
    const reserva = await this.prisma.reservaDotacao.findUnique({ where: { id } })
    if (!reserva || reserva.entidadeId !== entidadeId) {
      throw new ErroNegocio('REQUISICAO_INVALIDA', 'Reserva inválida para esta entidade.')
    }
    if (reserva.dotacaoDespesaId !== dotacaoDespesaId) {
      throw new ErroNegocio('REQUISICAO_INVALIDA', 'Reserva não pertence à dotação informada.')
    }
    if (reserva.status !== 'ATIVA') {
      throw new ErroNegocio('CONFLITO', `Reserva não está ATIVA (status: ${reserva.status}).`)
    }
    return reserva
  }

  private async validarVinculos(dados: DadosEmpenho, entidadeId: string) {
    const contratoId = trimOuNull(dados.contratoId)
    if (contratoId) {
      const c = await this.prisma.contrato.findUnique({ where: { id: contratoId } })
      if (!c || c.entidadeId !== entidadeId) throw new ErroNegocio('REQUISICAO_INVALIDA', 'Contrato inválido para esta entidade.')
    }
    const ataId = trimOuNull(dados.ataRegistroPrecoId)
    if (ataId) {
      const a = await this.prisma.ataRegistroPreco.findUnique({ where: { id: ataId } })
      if (!a || a.entidadeId !== entidadeId) throw new ErroNegocio('REQUISICAO_INVALIDA', 'Ata inválida para esta entidade.')
    }
  }

  /**
   * Sub-elemento da natureza no empenho (obrigatório — Lei 4.320 / TCE-PR SIM-AM):
   * folha analítica do plano de despesa, da mesma entidade/exercício, SOB o elemento
   * da dotação (mesmos 4 primeiros segmentos da natureza). Aceita desdobramentos locais.
   */
  private async validarSubElemento(subElementoContaId: string, naturezaDotacaoCodigo: string, entidadeId: string, ano: number) {
    const id = subElementoContaId?.trim()
    if (!id) throw new ErroNegocio('REQUISICAO_INVALIDA', 'Sub-elemento da despesa é obrigatório.')
    const sub = await this.prisma.contaDespesaEntidade.findUnique({ where: { id } })
    if (!sub || sub.entidadeId !== entidadeId || sub.ano !== ano) {
      throw new ErroNegocio('REQUISICAO_INVALIDA', 'Sub-elemento inválido para esta entidade/exercício.')
    }
    if (!sub.admiteMovimento) {
      throw new ErroNegocio('REQUISICAO_INVALIDA', 'O sub-elemento deve ser uma conta analítica (folha) da natureza.')
    }
    const elementoPrefixo = naturezaDotacaoCodigo.split('.').slice(0, 4).join('.') + '.'
    if (!sub.codigo.startsWith(elementoPrefixo)) {
      throw new ErroNegocio('REQUISICAO_INVALIDA', `O sub-elemento (${sub.codigo}) deve pertencer ao elemento da dotação (${elementoPrefixo}*).`)
    }
  }
}
