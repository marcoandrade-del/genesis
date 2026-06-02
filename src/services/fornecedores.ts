import { PrismaClient, Prisma, type TipoPessoa } from '@prisma/client'
import { ErroNegocio } from '../errors.js'
import { trimOuNull } from './planos-contratacao.js'

export type DadosFornecedor = {
  tipoPessoa: TipoPessoa
  cnpj?: string | null
  cpf?: string | null
  razaoSocial: string
  nomeFantasia?: string | null
  email?: string | null
  telefone?: string | null
  ativo?: boolean
}

/**
 * Fornecedor — cadastro global (compartilhado entre entidades). Pessoa jurídica
 * (CNPJ) ou física (CPF, p/ MEI/autônomo em dispensas). Documento único conforme
 * o tipo, espelhando a regra de identificação única de Usuario.
 */
export class FornecedoresService {
  constructor(private prisma: PrismaClient) {}

  listar(filtro: { tipoPessoa?: TipoPessoa; apenasAtivos?: boolean } = {}) {
    return this.prisma.fornecedor.findMany({
      where: {
        ...(filtro.tipoPessoa ? { tipoPessoa: filtro.tipoPessoa } : {}),
        ...(filtro.apenasAtivos ? { ativo: true } : {}),
      },
      orderBy: { razaoSocial: 'asc' },
    })
  }

  buscarPorId(id: string) {
    return this.prisma.fornecedor.findUnique({ where: { id } })
  }

  async criar(dados: DadosFornecedor) {
    const limpos = this.validar(dados)
    try {
      return await this.prisma.fornecedor.create({ data: limpos })
    } catch (e) {
      throw this.traduzirConflito(e)
    }
  }

  async atualizar(id: string, dados: DadosFornecedor) {
    const existente = await this.prisma.fornecedor.findUnique({ where: { id } })
    if (!existente) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Fornecedor não encontrado.')
    const limpos = this.validar(dados)
    try {
      return await this.prisma.fornecedor.update({ where: { id }, data: { ...limpos, ativo: dados.ativo ?? existente.ativo } })
    } catch (e) {
      throw this.traduzirConflito(e)
    }
  }

  async excluir(id: string) {
    const existente = await this.prisma.fornecedor.findUnique({ where: { id } })
    if (!existente) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Fornecedor não encontrado.')
    try {
      await this.prisma.fornecedor.delete({ where: { id } })
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2003') {
        throw new ErroNegocio('CONFLITO', 'Fornecedor em uso por processo/contrato/ata — não pode ser excluído.')
      }
      throw e
    }
  }

  private validar(dados: DadosFornecedor) {
    if (dados.tipoPessoa !== 'PJ' && dados.tipoPessoa !== 'PF') {
      throw new ErroNegocio('REQUISICAO_INVALIDA', 'Tipo de pessoa deve ser PJ ou PF.')
    }
    const razaoSocial = dados.razaoSocial?.trim()
    if (!razaoSocial) throw new ErroNegocio('REQUISICAO_INVALIDA', 'Razão social / nome é obrigatório.')

    const cnpj = trimOuNull(dados.cnpj)
    const cpf = trimOuNull(dados.cpf)
    if (dados.tipoPessoa === 'PJ' && !cnpj) {
      throw new ErroNegocio('REQUISICAO_INVALIDA', 'CNPJ é obrigatório para pessoa jurídica.')
    }
    if (dados.tipoPessoa === 'PF' && !cpf) {
      throw new ErroNegocio('REQUISICAO_INVALIDA', 'CPF é obrigatório para pessoa física.')
    }

    // Mantém apenas o documento do tipo escolhido (evita CNPJ "órfão" em PF e vice-versa).
    return {
      tipoPessoa: dados.tipoPessoa,
      cnpj: dados.tipoPessoa === 'PJ' ? cnpj : null,
      cpf: dados.tipoPessoa === 'PF' ? cpf : null,
      razaoSocial,
      nomeFantasia: trimOuNull(dados.nomeFantasia),
      email: trimOuNull(dados.email),
      telefone: trimOuNull(dados.telefone),
      ativo: dados.ativo ?? true,
    }
  }

  private traduzirConflito(e: unknown) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      const campo = Array.isArray(e.meta?.['target']) ? (e.meta?.['target'] as string[]).join(', ') : 'documento'
      return new ErroNegocio('CONFLITO', `Já existe um fornecedor com este ${campo.includes('cpf') ? 'CPF' : 'CNPJ'}.`)
    }
    return e
  }
}
