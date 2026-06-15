import { PrismaClient, Prisma } from '@prisma/client'
import { ErroNegocio } from '../errors.js'

export interface DadosContaBancaria {
  fonteCodigo?: string
  bancoCodigo?: string
  bancoNome?: string
  agencia?: string
  agenciaDv?: string
  numero?: string
  numeroDv?: string
  descricao?: string
}

const RE_BANCO = /^\d{3}$/
const RE_AGENCIA = /^\d{1,4}$/
const RE_NUMERO = /^\d{1,12}$/
const RE_DV = /^[0-9X]$/i

function trimOuNull(v?: string | null): string | null {
  const t = v?.trim()
  return t ? t : null
}

/** Rótulo de exibição: "104 ag. 0394 c/c 12345-6 — Folha" (padrão Febraban). */
export function rotuloConta(c: {
  bancoCodigo: string
  agencia: string
  agenciaDv?: string | null
  numero: string
  numeroDv?: string | null
  descricao?: string | null
}): string {
  const ag = c.agenciaDv ? `${c.agencia}-${c.agenciaDv}` : c.agencia
  const num = c.numeroDv ? `${c.numero}-${c.numeroDv}` : c.numero
  return `${c.bancoCodigo} ag. ${ag} c/c ${num}${c.descricao ? ` — ${c.descricao}` : ''}`
}

/**
 * Contas bancárias da entidade (padrão Febraban), vinculadas à fonte de
 * recurso POR CÓDIGO — o código TCE/STN é estável entre exercícios, então a
 * conta sobrevive à virada de ano sem revinculação. Regra de negócio (Marco,
 * 2026-05-28): pagamentos de uma fonte só podem sair pelas contas daquela
 * fonte — o enforcement vive na emissão da OP (OrdensPagamentoService).
 */
export class ContasBancariasService {
  constructor(private prisma: PrismaClient) {}

  /** Contas da entidade + nomenclatura da fonte do exercício (uma query de cada lado). */
  async listar(entidadeId: string, ano: number) {
    const [contas, fontes] = await Promise.all([
      this.prisma.contaBancaria.findMany({
        where: { entidadeId },
        orderBy: [{ fonteCodigo: 'asc' }, { bancoCodigo: 'asc' }, { agencia: 'asc' }, { numero: 'asc' }],
      }),
      this.prisma.fonteRecursoEntidade.findMany({
        where: { entidadeId, ano },
        select: { codigo: true, nomenclatura: true },
      }),
    ])
    const nomes = new Map(fontes.map((f) => [f.codigo, f.nomenclatura]))
    return contas.map((c) => ({ ...c, fonteNomenclatura: nomes.get(c.fonteCodigo) ?? null, rotulo: rotuloConta(c) }))
  }

  /** Fontes do exercício para o select do form. */
  listarFontes(entidadeId: string, ano: number) {
    return this.prisma.fonteRecursoEntidade.findMany({
      where: { entidadeId, ano },
      orderBy: { codigo: 'asc' },
      select: { codigo: true, nomenclatura: true },
    })
  }

  /** Contas ATIVAS de uma fonte — para o select da emissão de OP. */
  async contasDaFonte(entidadeId: string, fonteCodigo: string) {
    const contas = await this.prisma.contaBancaria.findMany({
      where: { entidadeId, fonteCodigo, ativa: true },
      orderBy: [{ bancoCodigo: 'asc' }, { agencia: 'asc' }, { numero: 'asc' }],
    })
    return contas.map((c) => ({ ...c, rotulo: rotuloConta(c) }))
  }

  async criar(entidadeId: string, ano: number, dados: DadosContaBancaria) {
    const d = await this.validar(entidadeId, ano, dados)
    try {
      return await this.prisma.contaBancaria.create({ data: { entidadeId, ...d } })
    } catch (e) {
      throw this.traduzirUnique(e, d)
    }
  }

  async atualizar(id: string, entidadeId: string, ano: number, dados: DadosContaBancaria) {
    await this.buscarDaEntidade(id, entidadeId)
    const d = await this.validar(entidadeId, ano, dados)
    try {
      return await this.prisma.contaBancaria.update({ where: { id }, data: d })
    } catch (e) {
      throw this.traduzirUnique(e, d)
    }
  }

  /** Inativa/reativa (soft): conta inativa some dos selects de pagamento. */
  async alternarAtiva(id: string, entidadeId: string) {
    const conta = await this.buscarDaEntidade(id, entidadeId)
    return this.prisma.contaBancaria.update({ where: { id }, data: { ativa: !conta.ativa } })
  }

  /** Exclui apenas conta nunca usada em OP — histórico de pagamento é imutável. */
  async excluir(id: string, entidadeId: string) {
    await this.buscarDaEntidade(id, entidadeId)
    const usos = await this.prisma.ordemPagamento.count({ where: { contaBancariaId: id } })
    if (usos > 0) {
      throw new ErroNegocio('CONFLITO', `Esta conta já foi usada em ${usos} ordem(ns) de pagamento — inative-a em vez de excluir.`)
    }
    return this.prisma.contaBancaria.delete({ where: { id } })
  }

  private async buscarDaEntidade(id: string, entidadeId: string) {
    const conta = await this.prisma.contaBancaria.findUnique({ where: { id } })
    if (!conta || conta.entidadeId !== entidadeId) {
      throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Conta bancária não encontrada.')
    }
    return conta
  }

  private async validar(entidadeId: string, ano: number, dados: DadosContaBancaria) {
    const fonteCodigo = dados.fonteCodigo?.trim() ?? ''
    const bancoCodigo = dados.bancoCodigo?.trim() ?? ''
    const agencia = dados.agencia?.trim() ?? ''
    const numero = dados.numero?.trim() ?? ''
    const agenciaDv = trimOuNull(dados.agenciaDv)
    const numeroDv = trimOuNull(dados.numeroDv)

    if (!fonteCodigo) throw new ErroNegocio('REQUISICAO_INVALIDA', 'Selecione a fonte de recurso.')
    if (!RE_BANCO.test(bancoCodigo)) throw new ErroNegocio('REQUISICAO_INVALIDA', 'Código do banco deve ter 3 dígitos (padrão Febraban, ex.: 001, 104, 341).')
    if (!RE_AGENCIA.test(agencia)) throw new ErroNegocio('REQUISICAO_INVALIDA', 'Agência deve ter de 1 a 4 dígitos (sem o DV).')
    if (agenciaDv && !RE_DV.test(agenciaDv)) throw new ErroNegocio('REQUISICAO_INVALIDA', 'DV da agência deve ser um dígito ou X.')
    if (!RE_NUMERO.test(numero)) throw new ErroNegocio('REQUISICAO_INVALIDA', 'Número da conta deve ter de 1 a 12 dígitos (sem o DV).')
    if (numeroDv && !RE_DV.test(numeroDv)) throw new ErroNegocio('REQUISICAO_INVALIDA', 'DV da conta deve ser um dígito ou X.')

    const fonte = await this.prisma.fonteRecursoEntidade.findUnique({
      where: { entidadeId_ano_codigo: { entidadeId, ano, codigo: fonteCodigo } },
      select: { codigo: true },
    })
    if (!fonte) {
      throw new ErroNegocio('REQUISICAO_INVALIDA', `Fonte ${fonteCodigo} não existe para esta entidade no exercício ${ano}.`)
    }

    return {
      fonteCodigo,
      bancoCodigo,
      bancoNome: trimOuNull(dados.bancoNome),
      agencia,
      agenciaDv: agenciaDv ? agenciaDv.toUpperCase() : null,
      numero,
      numeroDv: numeroDv ? numeroDv.toUpperCase() : null,
      descricao: trimOuNull(dados.descricao),
    }
  }

  private traduzirUnique(e: unknown, d: { bancoCodigo: string; agencia: string; numero: string }) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return new ErroNegocio('CONFLITO', `Já existe a conta ${d.bancoCodigo} ag. ${d.agencia} nº ${d.numero} nesta entidade.`)
    }
    return e
  }
}
