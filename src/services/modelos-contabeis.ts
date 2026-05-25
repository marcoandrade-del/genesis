import { PrismaClient, Prisma } from '@prisma/client'
import { ErroNegocio } from '../errors.js'

export type DadosCriarModelo = { descricao: string; ativo?: boolean }
export type DadosAtualizarModelo = { descricao?: string; ativo?: boolean }

export class ModelosContabeisService {
  constructor(private prisma: PrismaClient) {}

  listar() {
    return this.prisma.modeloContabil.findMany({ orderBy: { descricao: 'asc' } })
  }

  buscarPorId(id: string) {
    return this.prisma.modeloContabil.findUnique({ where: { id } })
  }

  async criar(dados: DadosCriarModelo) {
    try {
      return await this.prisma.modeloContabil.create({ data: dados })
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ErroNegocio('CONFLITO', `Já existe um modelo contábil com a descrição "${dados.descricao}".`)
      }
      throw e
    }
  }

  async atualizar(id: string, dados: DadosAtualizarModelo) {
    try {
      return await this.prisma.modeloContabil.update({ where: { id }, data: dados })
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError) {
        if (e.code === 'P2002') throw new ErroNegocio('CONFLITO', 'Já existe um modelo contábil com essa descrição.')
        if (e.code === 'P2025') throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Modelo contábil não encontrado.')
      }
      throw e
    }
  }

  /** Excluir só é permitido se nenhum Estado, Município ou PlanoDeContas referencia o modelo. */
  async excluir(id: string) {
    const modelo = await this.prisma.modeloContabil.findUnique({ where: { id } })
    if (!modelo) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Modelo contábil não encontrado.')

    const [estados, municipios, planos] = await Promise.all([
      this.prisma.estado.count({ where: { modeloContabilId: id } }),
      this.prisma.municipio.count({ where: { modeloContabilId: id } }),
      this.prisma.planoDeContas.count({ where: { modeloContabilId: id } }),
    ])
    if (estados + municipios + planos > 0) {
      throw new ErroNegocio(
        'CONFLITO',
        `Modelo contábil em uso (estados=${estados}, municípios=${municipios}, planos=${planos}). Remova as referências antes de excluir.`,
      )
    }

    await this.prisma.modeloContabil.delete({ where: { id } })
  }
}
