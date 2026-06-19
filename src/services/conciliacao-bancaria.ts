import { PrismaClient, Prisma, type TipoLancamento, type OrigemImportExtrato } from '@prisma/client'
import { randomUUID } from 'node:crypto'
import { ErroNegocio } from '../errors.js'
import { parseExtrato } from './extrato-parsers.js'
import { rotuloConta } from './contas-bancarias.js'

export type DadosMovimentoManual = {
  data: string // YYYY-MM-DD
  valor: string
  sentido?: string // CREDITO (default) | DEBITO
  historico?: string
  documento?: string
}

/** Tolerância de dias entre o crédito do extrato e a data da arrecadação no auto-match. */
const TOLERANCIA_DIAS = 3
const dec = (v: string | number | Prisma.Decimal) => new Prisma.Decimal(v)

/**
 * Conciliação bancária: casa os créditos do extrato de uma conta bancária com as
 * arrecadações já registradas naquela conta (1:1). Não cria arrecadação — audita
 * e vincula. Entrada do extrato por lançamento manual ou import (CSV/OFX; CNAB fase 2).
 */
export class ConciliacaoBancariaService {
  constructor(private prisma: PrismaClient) {}

  private async contaDaEntidade(contaBancariaId: string, entidadeId: string) {
    const conta = await this.prisma.contaBancaria.findUnique({ where: { id: contaBancariaId } })
    if (!conta || conta.entidadeId !== entidadeId) {
      throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Conta bancária não encontrada nesta entidade.')
    }
    return conta
  }

  /** Adiciona uma linha do extrato manualmente. */
  async registrarManual(contaBancariaId: string, entidadeId: string, dados: DadosMovimentoManual) {
    await this.contaDaEntidade(contaBancariaId, entidadeId)
    if (!dados.data?.trim() || Number.isNaN(Date.parse(dados.data))) {
      throw new ErroNegocio('REQUISICAO_INVALIDA', 'Informe uma data válida.')
    }
    const n = Number(dados.valor)
    if (!Number.isFinite(n) || n <= 0) throw new ErroNegocio('REQUISICAO_INVALIDA', 'Valor deve ser positivo.')
    const sentido = (dados.sentido === 'DEBITO' ? 'DEBITO' : 'CREDITO') as TipoLancamento
    return this.prisma.movimentoBancario.create({
      data: {
        contaBancariaId,
        data: new Date(dados.data),
        valor: dec(dados.valor),
        sentido,
        historico: dados.historico?.trim() || null,
        documento: dados.documento?.trim() || null,
        origemImport: 'MANUAL',
      },
    })
  }

  /** Importa um extrato (CSV/OFX) para a conta — cria os movimentos num lote. */
  async importar(contaBancariaId: string, entidadeId: string, formato: 'CSV' | 'OFX' | 'CNAB', conteudo: string) {
    await this.contaDaEntidade(contaBancariaId, entidadeId)
    const linhas = parseExtrato(formato, conteudo)
    const lote = randomUUID()
    await this.prisma.movimentoBancario.createMany({
      data: linhas.map((l) => ({
        contaBancariaId,
        data: new Date(l.data),
        valor: dec(l.valor),
        sentido: l.sentido as TipoLancamento,
        historico: l.historico ?? null,
        documento: l.documento ?? null,
        origemImport: formato as OrigemImportExtrato,
        loteImport: lote,
      })),
    })
    return { lote, total: linhas.length, creditos: linhas.filter((l) => l.sentido === 'CREDITO').length }
  }

  /** Painel da conta no exercício: conciliados, extrato pendente, arrecadações pendentes e totais. */
  async painel(contaBancariaId: string, entidadeId: string, ano: number) {
    const conta = await this.contaDaEntidade(contaBancariaId, entidadeId)
    const inicio = new Date(Date.UTC(ano, 0, 1))
    const fim = new Date(Date.UTC(ano + 1, 0, 1))
    const incPrev = { previsao: { include: { contaReceita: { select: { codigo: true, descricao: true } }, fonteRecurso: { select: { codigo: true } } } } }

    const [movimentos, arrecadacoes] = await Promise.all([
      this.prisma.movimentoBancario.findMany({
        where: { contaBancariaId, sentido: 'CREDITO', data: { gte: inicio, lt: fim } },
        include: { arrecadacao: { include: incPrev } },
        orderBy: [{ data: 'asc' }, { criadoEm: 'asc' }],
      }),
      this.prisma.arrecadacao.findMany({
        where: { contaBancariaId, tipo: 'ARRECADACAO', data: { gte: inicio, lt: fim } },
        include: { ...incPrev, movimentoBancario: { select: { id: true } } },
        orderBy: [{ data: 'asc' }, { criadoEm: 'asc' }],
      }),
    ])

    const conciliados = movimentos.filter((m) => m.arrecadacaoId)
    const extratoPendente = movimentos.filter((m) => !m.arrecadacaoId)
    const arrecadacoesPendentes = arrecadacoes.filter((a) => !a.movimentoBancario)

    const soma = (xs: { valor: Prisma.Decimal }[]) => xs.reduce((s, x) => s.plus(x.valor), dec(0))
    const totalExtrato = soma(movimentos)
    const totalArrecadado = soma(arrecadacoes)

    return {
      conta: { ...conta, rotulo: rotuloConta(conta) },
      conciliados,
      extratoPendente,
      arrecadacoesPendentes,
      totais: {
        extrato: totalExtrato.toNumber(),
        arrecadado: totalArrecadado.toNumber(),
        conciliado: soma(conciliados).toNumber(),
        diferenca: totalExtrato.minus(totalArrecadado).toNumber(),
        pendentesExtrato: extratoPendente.length,
        pendentesArrecadacao: arrecadacoesPendentes.length,
      },
    }
  }

  /**
   * Auto-concilia: casa cada crédito pendente do extrato com uma arrecadação
   * pendente de MESMO valor e data próxima (≤ TOLERANCIA_DIAS), 1:1 e sem
   * ambiguidade (pula quando há mais de uma candidata). Retorna quantos casou.
   */
  async sugerir(contaBancariaId: string, entidadeId: string, ano: number) {
    const { extratoPendente, arrecadacoesPendentes } = await this.painel(contaBancariaId, entidadeId, ano)
    const usados = new Set<string>()
    let casados = 0
    for (const mov of extratoPendente) {
      const candidatas = arrecadacoesPendentes.filter(
        (a) => !usados.has(a.id) && a.valor.equals(mov.valor) && diffDias(a.data, mov.data) <= TOLERANCIA_DIAS,
      )
      if (candidatas.length !== 1) continue // sem candidata ou ambíguo → deixa pro usuário
      usados.add(candidatas[0].id)
      await this.prisma.movimentoBancario.update({ where: { id: mov.id }, data: { arrecadacaoId: candidatas[0].id } })
      casados++
    }
    return casados
  }

  /** Concilia manualmente um crédito do extrato com uma arrecadação da mesma conta. */
  async conciliar(movimentoId: string, arrecadacaoId: string, entidadeId: string) {
    const mov = await this.prisma.movimentoBancario.findUnique({ where: { id: movimentoId }, include: { contaBancaria: true } })
    if (!mov || mov.contaBancaria.entidadeId !== entidadeId) {
      throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Movimento do extrato não encontrado.')
    }
    if (mov.sentido !== 'CREDITO') throw new ErroNegocio('ENTIDADE_NAO_PROCESSAVEL', 'Só créditos do extrato conciliam com arrecadação.')
    if (mov.arrecadacaoId) throw new ErroNegocio('CONFLITO', 'Este movimento já está conciliado.')

    const arr = await this.prisma.arrecadacao.findUnique({ where: { id: arrecadacaoId }, include: { movimentoBancario: { select: { id: true } } } })
    if (!arr || arr.contaBancariaId !== mov.contaBancariaId) {
      throw new ErroNegocio('REQUISICAO_INVALIDA', 'A arrecadação não é desta conta bancária.')
    }
    if (arr.tipo !== 'ARRECADACAO') throw new ErroNegocio('ENTIDADE_NAO_PROCESSAVEL', 'Estornos não conciliam.')
    if (arr.movimentoBancario) throw new ErroNegocio('CONFLITO', 'Esta arrecadação já está conciliada com outro movimento.')

    return this.prisma.movimentoBancario.update({ where: { id: movimentoId }, data: { arrecadacaoId } })
  }

  /** Desfaz a conciliação de um movimento. */
  async desconciliar(movimentoId: string, entidadeId: string) {
    const mov = await this.prisma.movimentoBancario.findUnique({ where: { id: movimentoId }, include: { contaBancaria: true } })
    if (!mov || mov.contaBancaria.entidadeId !== entidadeId) {
      throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Movimento do extrato não encontrado.')
    }
    return this.prisma.movimentoBancario.update({ where: { id: movimentoId }, data: { arrecadacaoId: null } })
  }

  /** Exclui um movimento do extrato (apenas se não conciliado). */
  async excluirMovimento(movimentoId: string, entidadeId: string) {
    const mov = await this.prisma.movimentoBancario.findUnique({ where: { id: movimentoId }, include: { contaBancaria: true } })
    if (!mov || mov.contaBancaria.entidadeId !== entidadeId) {
      throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Movimento do extrato não encontrado.')
    }
    if (mov.arrecadacaoId) throw new ErroNegocio('CONFLITO', 'Desfaça a conciliação antes de excluir o movimento.')
    return this.prisma.movimentoBancario.delete({ where: { id: movimentoId } })
  }
}

/** Diferença absoluta em dias entre duas datas (UTC). */
function diffDias(a: Date, b: Date): number {
  return Math.abs(Math.round((a.getTime() - b.getTime()) / 86400000))
}
