import { PrismaClient, Prisma } from '@prisma/client'
import { ErroNegocio } from '../errors.js'

export type DadosOrgao = {
  codigo: string
  nome: string
  ativo?: boolean
}

/**
 * Órgão — nível máximo da classificação institucional (Órgão → Unidade
 * Orçamentária). Cadastrado por entidade; código único por entidade. Pai das
 * unidades orçamentárias (Portaria SOF/MPO 169/2024). Espelha o CRUD das UOs.
 */
export class OrgaosService {
  constructor(private prisma: PrismaClient) {}

  listar(entidadeId: string) {
    return this.prisma.orgao.findMany({ where: { entidadeId }, orderBy: { codigo: 'asc' } })
  }

  buscarPorId(id: string) {
    return this.prisma.orgao.findUnique({ where: { id } })
  }

  async criar(entidadeId: string, dados: DadosOrgao) {
    const codigo = dados.codigo.trim()
    const nome = dados.nome.trim()
    if (!codigo) throw new ErroNegocio('REQUISICAO_INVALIDA', 'Código é obrigatório.')
    if (!nome) throw new ErroNegocio('REQUISICAO_INVALIDA', 'Nome é obrigatório.')
    const entidade = await this.prisma.entidade.findUnique({ where: { id: entidadeId } })
    if (!entidade) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Entidade não encontrada.')
    try {
      return await this.prisma.orgao.create({ data: { entidadeId, codigo, nome, ativo: dados.ativo ?? true } })
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ErroNegocio('CONFLITO', `Já existe um órgão com o código "${codigo}" nesta entidade.`)
      }
      throw e
    }
  }

  async atualizar(id: string, dados: DadosOrgao) {
    const codigo = dados.codigo.trim()
    const nome = dados.nome.trim()
    if (!codigo) throw new ErroNegocio('REQUISICAO_INVALIDA', 'Código é obrigatório.')
    if (!nome) throw new ErroNegocio('REQUISICAO_INVALIDA', 'Nome é obrigatório.')
    const orgao = await this.prisma.orgao.findUnique({ where: { id } })
    if (!orgao) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Órgão não encontrado.')
    try {
      return await this.prisma.orgao.update({ where: { id }, data: { codigo, nome, ativo: dados.ativo ?? orgao.ativo } })
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ErroNegocio('CONFLITO', `Já existe um órgão com o código "${codigo}" nesta entidade.`)
      }
      throw e
    }
  }

  async excluir(id: string) {
    const orgao = await this.prisma.orgao.findUnique({ where: { id }, include: { _count: { select: { unidades: true } } } })
    if (!orgao) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Órgão não encontrado.')
    if (orgao._count.unidades > 0) {
      throw new ErroNegocio('CONFLITO', `Órgão com ${orgao._count.unidades} unidade(s) vinculada(s) não pode ser excluído.`)
    }
    await this.prisma.orgao.delete({ where: { id } })
  }
}
