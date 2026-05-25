import { PrismaClient, Prisma } from '@prisma/client'
import { ErroNegocio } from '../errors.js'

export type DadosCriarMunicipio = { nome: string; estadoId: string; modeloContabilId?: string }
export type DadosAtualizarMunicipio = { nome?: string; modeloContabilId?: string | null }

export type MunicipioComModeloEfetivo = {
  id: string
  nome: string
  estadoId: string
  modeloContabilId: string | null
  modeloContabilEfetivoId: string | null  // próprio se != null; senão herdado do estado
  herdaDoEstado: boolean
}

export class MunicipiosService {
  constructor(private prisma: PrismaClient) {}

  async listar(estadoId?: string) {
    return this.prisma.municipio.findMany({
      where: estadoId ? { estadoId } : undefined,
      orderBy: { nome: 'asc' },
    })
  }

  buscarPorId(id: string) {
    return this.prisma.municipio.findUnique({ where: { id } })
  }

  /**
   * Retorna o município com o modelo contábil efetivo (próprio ou herdado do estado).
   * Regra: município sem modeloContabilId herda o do estado.
   */
  async buscarComModeloEfetivo(id: string): Promise<MunicipioComModeloEfetivo | null> {
    const m = await this.prisma.municipio.findUnique({
      where: { id },
      include: { estado: { select: { modeloContabilId: true } } },
    })
    if (!m) return null
    const proprio = m.modeloContabilId
    const herdado = m.estado.modeloContabilId
    return {
      id: m.id,
      nome: m.nome,
      estadoId: m.estadoId,
      modeloContabilId: proprio,
      modeloContabilEfetivoId: proprio ?? herdado,
      herdaDoEstado: proprio === null,
    }
  }

  async criar(dados: DadosCriarMunicipio) {
    const estado = await this.prisma.estado.findUnique({ where: { id: dados.estadoId } })
    if (!estado) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Estado não encontrado.')

    if (dados.modeloContabilId) {
      const modelo = await this.prisma.modeloContabil.findUnique({ where: { id: dados.modeloContabilId } })
      if (!modelo) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Modelo contábil não encontrado.')
    }

    try {
      return await this.prisma.municipio.create({ data: dados })
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ErroNegocio('CONFLITO', `Já existe um município "${dados.nome}" neste estado.`)
      }
      throw e
    }
  }

  /**
   * `modeloContabilId: null` restaura a herança do estado (campo passa a null no banco).
   * Não passar a chave deixa o valor atual.
   */
  async atualizar(id: string, dados: DadosAtualizarMunicipio) {
    if (dados.modeloContabilId) {
      const modelo = await this.prisma.modeloContabil.findUnique({ where: { id: dados.modeloContabilId } })
      if (!modelo) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Modelo contábil não encontrado.')
    }
    try {
      return await this.prisma.municipio.update({ where: { id }, data: dados })
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError) {
        if (e.code === 'P2002') throw new ErroNegocio('CONFLITO', 'Já existe um município com esse nome neste estado.')
        if (e.code === 'P2025') throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Município não encontrado.')
      }
      throw e
    }
  }

  /** Excluir só é permitido se não há lançamentos, resumos mensais ou saldos iniciais. */
  async excluir(id: string) {
    const municipio = await this.prisma.municipio.findUnique({ where: { id } })
    if (!municipio) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Município não encontrado.')

    const [lancs, resumos, saldos] = await Promise.all([
      this.prisma.lancamento.count({ where: { municipioId: id } }),
      this.prisma.resumoMensalConta.count({ where: { municipioId: id } }),
      this.prisma.saldoInicialAno.count({ where: { municipioId: id } }),
    ])
    if (lancs + resumos + saldos > 0) {
      throw new ErroNegocio(
        'CONFLITO',
        `Município com movimentação contábil não pode ser excluído (lançamentos=${lancs}, resumos=${resumos}, saldos=${saldos}).`,
      )
    }

    await this.prisma.municipio.delete({ where: { id } })
  }
}
