import { PrismaClient, Prisma, type StatusContrato } from '@prisma/client'
import { ErroNegocio } from '../errors.js'
import { trimOuNull, parseDecimalPositivo, parseDecimalNaoNegativo, garantirCatalogoExiste } from './planos-contratacao.js'

export type DadosItemContrato = {
  itemCatalogoId: string
  quantidadeContratada: string | number
  precoUnitario: string | number
}

export type DadosContrato = {
  processoId?: string | null
  fornecedorId: string
  numero: string
  objeto: string
  vigenciaInicio: Date | string
  vigenciaFim: Date | string
  valorTotal: string | number
  itens: DadosItemContrato[]
}

const TRANSICOES_VALIDAS: Record<StatusContrato, ReadonlyArray<StatusContrato>> = {
  VIGENTE: ['ENCERRADO', 'RESCINDIDO'],
  ENCERRADO: [],
  RESCINDIDO: [],
}

/**
 * Contrato administrativo. Vincula entidade + fornecedor (+ processo de origem),
 * com vigência e itens. ItemContrato carrega quantidadeEmpenhada (saldo
 * materializado consumido pelos empenhos no PR-3). Itens via replace-all,
 * editáveis enquanto VIGENTE e sem empenho.
 */
export class ContratosService {
  constructor(private prisma: PrismaClient) {}

  listar(entidadeId: string) {
    return this.prisma.contrato.findMany({
      where: { entidadeId },
      orderBy: { criadoEm: 'desc' },
      include: { fornecedor: { select: { razaoSocial: true } }, _count: { select: { itens: true } } },
    })
  }

  buscarPorId(id: string) {
    return this.prisma.contrato.findUnique({
      where: { id },
      include: {
        entidade: true,
        fornecedor: true,
        processo: { select: { id: true, numero: true, ano: true } },
        itens: { include: { itemCatalogo: true }, orderBy: { criadoEm: 'asc' } },
      },
    })
  }

  async criar(entidadeId: string, dados: DadosContrato) {
    const cab = await this.validar(entidadeId, dados)
    const itens = await this.validarItens(dados.itens)
    try {
      return await this.prisma.$transaction(async (tx) => {
        const contrato = await tx.contrato.create({ data: { entidadeId, ...cab } })
        await tx.itemContrato.createMany({ data: itens.map((i) => ({ contratoId: contrato.id, ...i })) })
        return contrato
      })
    } catch (e) {
      throw traduzirNumero(e, dados.numero)
    }
  }

  async atualizar(id: string, dados: DadosContrato) {
    const existente = await this.carregarEditavel(id)
    const cab = await this.validar(existente.entidadeId, dados)
    const itens = await this.validarItens(dados.itens)
    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.itemContrato.deleteMany({ where: { contratoId: id } })
        const contrato = await tx.contrato.update({ where: { id }, data: cab })
        await tx.itemContrato.createMany({ data: itens.map((i) => ({ contratoId: id, ...i })) })
        return contrato
      })
    } catch (e) {
      throw traduzirNumero(e, dados.numero)
    }
  }

  async alterarStatus(id: string, novoStatus: StatusContrato) {
    const contrato = await this.prisma.contrato.findUnique({ where: { id } })
    if (!contrato) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Contrato não encontrado.')
    if (!TRANSICOES_VALIDAS[contrato.status].includes(novoStatus)) {
      throw new ErroNegocio('CONFLITO', `Transição inválida: ${contrato.status} → ${novoStatus}.`)
    }
    return this.prisma.contrato.update({ where: { id }, data: { status: novoStatus } })
  }

  async excluir(id: string) {
    const contrato = await this.prisma.contrato.findUnique({
      where: { id },
      include: { itens: { select: { quantidadeEmpenhada: true } } },
    })
    if (!contrato) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Contrato não encontrado.')
    if (contrato.itens.some((i) => !new Prisma.Decimal(i.quantidadeEmpenhada).isZero())) {
      throw new ErroNegocio('CONFLITO', 'Contrato com itens já empenhados não pode ser excluído.')
    }
    await this.prisma.contrato.delete({ where: { id } })
  }

  private async carregarEditavel(id: string) {
    const contrato = await this.prisma.contrato.findUnique({ where: { id } })
    if (!contrato) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Contrato não encontrado.')
    if (contrato.status !== 'VIGENTE') throw new ErroNegocio('CONFLITO', 'Apenas contrato VIGENTE pode ser editado.')
    return contrato
  }

  private async validar(entidadeId: string, dados: DadosContrato) {
    const numero = dados.numero?.trim()
    const objeto = dados.objeto?.trim()
    if (!numero) throw new ErroNegocio('REQUISICAO_INVALIDA', 'Número é obrigatório.')
    if (!objeto) throw new ErroNegocio('REQUISICAO_INVALIDA', 'Objeto é obrigatório.')

    const fornecedor = await this.prisma.fornecedor.findUnique({ where: { id: dados.fornecedorId } })
    if (!fornecedor || !fornecedor.ativo) throw new ErroNegocio('REQUISICAO_INVALIDA', 'Fornecedor inválido ou inativo.')

    const processoId = trimOuNull(dados.processoId)
    if (processoId) {
      const proc = await this.prisma.processo.findUnique({ where: { id: processoId } })
      if (!proc || proc.entidadeId !== entidadeId) {
        throw new ErroNegocio('REQUISICAO_INVALIDA', 'Processo inválido para esta entidade.')
      }
    }

    const inicio = parseData(dados.vigenciaInicio, 'Início da vigência')
    const fim = parseData(dados.vigenciaFim, 'Fim da vigência')
    if (fim < inicio) throw new ErroNegocio('REQUISICAO_INVALIDA', 'Fim da vigência anterior ao início.')

    return {
      processoId,
      fornecedorId: dados.fornecedorId,
      numero,
      objeto,
      vigenciaInicio: inicio,
      vigenciaFim: fim,
      valorTotal: parseDecimalNaoNegativo(dados.valorTotal, 'Valor total'),
    }
  }

  private async validarItens(itens: DadosItemContrato[]) {
    if (!Array.isArray(itens) || itens.length === 0) {
      throw new ErroNegocio('REQUISICAO_INVALIDA', 'Inclua ao menos um item.')
    }
    const normalizados = itens.map((i) => {
      if (!i.itemCatalogoId?.trim()) throw new ErroNegocio('REQUISICAO_INVALIDA', 'Item do catálogo é obrigatório.')
      return {
        itemCatalogoId: i.itemCatalogoId,
        quantidadeContratada: parseDecimalPositivo(i.quantidadeContratada, 'Quantidade contratada'),
        precoUnitario: parseDecimalNaoNegativo(i.precoUnitario, 'Preço unitário'),
      }
    })
    await garantirCatalogoExiste(this.prisma, normalizados.map((i) => i.itemCatalogoId))
    return normalizados
  }
}

function parseData(v: Date | string, rotulo: string): Date {
  if (v === null || v === undefined || v === '') throw new ErroNegocio('REQUISICAO_INVALIDA', `${rotulo} é obrigatório.`)
  const d = v instanceof Date ? v : new Date(v)
  if (Number.isNaN(d.getTime())) throw new ErroNegocio('REQUISICAO_INVALIDA', `${rotulo} inválido.`)
  return d
}

function traduzirNumero(e: unknown, numero: string) {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
    return new ErroNegocio('CONFLITO', `Já existe um contrato nº "${numero}" nesta entidade.`)
  }
  return e
}
