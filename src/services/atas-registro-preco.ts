import { PrismaClient, Prisma, type StatusAta } from '@prisma/client'
import { ErroNegocio } from '../errors.js'
import { trimOuNull, parseDecimalPositivo, parseDecimalNaoNegativo, garantirCatalogoExiste } from './planos-contratacao.js'

export type DadosItemAta = {
  itemCatalogoId: string
  quantidadeRegistrada: string | number
  precoUnitario: string | number
}

export type DadosAta = {
  processoId?: string | null
  fornecedorId: string
  numero: string
  objeto: string
  vigenciaInicio: Date | string
  vigenciaFim: Date | string
  itens: DadosItemAta[]
}

/**
 * Ata de Registro de Preços (ARP). Registra preços de um fornecedor por item,
 * com vigência. ItemAtaRegistroPreco carrega quantidadeUtilizada (saldo
 * materializado consumido por contratos/empenhos no PR-3). Itens via replace-all,
 * editáveis enquanto VIGENTE e sem utilização.
 */
export class AtasRegistroPrecoService {
  constructor(private prisma: PrismaClient) {}

  listar(entidadeId: string) {
    return this.prisma.ataRegistroPreco.findMany({
      where: { entidadeId },
      orderBy: { criadoEm: 'desc' },
      include: { fornecedor: { select: { razaoSocial: true } }, _count: { select: { itens: true } } },
    })
  }

  buscarPorId(id: string) {
    return this.prisma.ataRegistroPreco.findUnique({
      where: { id },
      include: {
        entidade: true,
        fornecedor: true,
        processo: { select: { id: true, numero: true, ano: true } },
        itens: { include: { itemCatalogo: true }, orderBy: { criadoEm: 'asc' } },
      },
    })
  }

  async criar(entidadeId: string, dados: DadosAta) {
    const cab = await this.validar(entidadeId, dados)
    const itens = await this.validarItens(dados.itens)
    try {
      return await this.prisma.$transaction(async (tx) => {
        const ata = await tx.ataRegistroPreco.create({ data: { entidadeId, ...cab } })
        await tx.itemAtaRegistroPreco.createMany({ data: itens.map((i) => ({ ataId: ata.id, ...i })) })
        return ata
      })
    } catch (e) {
      throw traduzirNumero(e, dados.numero)
    }
  }

  async atualizar(id: string, dados: DadosAta) {
    const existente = await this.carregarEditavel(id)
    const cab = await this.validar(existente.entidadeId, dados)
    const itens = await this.validarItens(dados.itens)
    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.itemAtaRegistroPreco.deleteMany({ where: { ataId: id } })
        const ata = await tx.ataRegistroPreco.update({ where: { id }, data: cab })
        await tx.itemAtaRegistroPreco.createMany({ data: itens.map((i) => ({ ataId: id, ...i })) })
        return ata
      })
    } catch (e) {
      throw traduzirNumero(e, dados.numero)
    }
  }

  async alterarStatus(id: string, novoStatus: StatusAta) {
    const ata = await this.prisma.ataRegistroPreco.findUnique({ where: { id } })
    if (!ata) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Ata não encontrada.')
    if (ata.status === novoStatus) return ata
    if (novoStatus !== 'VIGENTE' && novoStatus !== 'ENCERRADA') {
      throw new ErroNegocio('REQUISICAO_INVALIDA', 'Status inválido.')
    }
    return this.prisma.ataRegistroPreco.update({ where: { id }, data: { status: novoStatus } })
  }

  async excluir(id: string) {
    const ata = await this.prisma.ataRegistroPreco.findUnique({
      where: { id },
      include: { itens: { select: { quantidadeUtilizada: true } } },
    })
    if (!ata) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Ata não encontrada.')
    if (ata.itens.some((i) => !new Prisma.Decimal(i.quantidadeUtilizada).isZero())) {
      throw new ErroNegocio('CONFLITO', 'Ata com itens já utilizados não pode ser excluída.')
    }
    await this.prisma.ataRegistroPreco.delete({ where: { id } })
  }

  private async carregarEditavel(id: string) {
    const ata = await this.prisma.ataRegistroPreco.findUnique({ where: { id } })
    if (!ata) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Ata não encontrada.')
    if (ata.status !== 'VIGENTE') throw new ErroNegocio('CONFLITO', 'Apenas ata VIGENTE pode ser editada.')
    return ata
  }

  private async validar(entidadeId: string, dados: DadosAta) {
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

    return { processoId, fornecedorId: dados.fornecedorId, numero, objeto, vigenciaInicio: inicio, vigenciaFim: fim }
  }

  private async validarItens(itens: DadosItemAta[]) {
    if (!Array.isArray(itens) || itens.length === 0) {
      throw new ErroNegocio('REQUISICAO_INVALIDA', 'Inclua ao menos um item.')
    }
    const normalizados = itens.map((i) => {
      if (!i.itemCatalogoId?.trim()) throw new ErroNegocio('REQUISICAO_INVALIDA', 'Item do catálogo é obrigatório.')
      return {
        itemCatalogoId: i.itemCatalogoId,
        quantidadeRegistrada: parseDecimalPositivo(i.quantidadeRegistrada, 'Quantidade registrada'),
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
    return new ErroNegocio('CONFLITO', `Já existe uma ata nº "${numero}" nesta entidade.`)
  }
  return e
}
