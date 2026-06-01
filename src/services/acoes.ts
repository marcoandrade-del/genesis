import { PrismaClient, Prisma, type TipoAcao } from '@prisma/client'
import { ErroNegocio } from '../errors.js'

const TIPOS_VALIDOS: ReadonlyArray<TipoAcao> = ['PROJETO', 'ATIVIDADE', 'OPERACAO_ESPECIAL']

export type DadosAcao = {
  codigo: string
  nome: string
  tipo: TipoAcao | string
  unidadeMedida?: string | null
  metaFisica?: string | number | null
  ativa?: boolean
}

/**
 * Ação do PPA-LOA. Filha de Programa. Tipos: PROJETO (1xxx), ATIVIDADE (2xxx),
 * OPERACAO_ESPECIAL (0xxx/9xxx). Código único por programa.
 */
export class AcoesService {
  constructor(private prisma: PrismaClient) {}

  listar(programaId: string) {
    return this.prisma.acao.findMany({
      where: { programaId },
      orderBy: { codigo: 'asc' },
    })
  }

  buscarPorId(id: string) {
    return this.prisma.acao.findUnique({ where: { id } })
  }

  async criar(programaId: string, dados: DadosAcao) {
    const { codigo, nome, tipo, metaFisica } = this.validar(dados)
    const programa = await this.prisma.programa.findUnique({ where: { id: programaId } })
    if (!programa) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Programa não encontrado.')

    try {
      return await this.prisma.acao.create({
        data: {
          programaId,
          codigo,
          nome,
          tipo,
          unidadeMedida: trimOuNull(dados.unidadeMedida),
          metaFisica,
          ativa: dados.ativa ?? true,
        },
      })
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ErroNegocio('CONFLITO', `Já existe uma ação "${codigo}" neste programa.`)
      }
      throw e
    }
  }

  async atualizar(id: string, dados: DadosAcao) {
    const { codigo, nome, tipo, metaFisica } = this.validar(dados)
    const existente = await this.prisma.acao.findUnique({ where: { id } })
    if (!existente) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Ação não encontrada.')

    try {
      return await this.prisma.acao.update({
        where: { id },
        data: {
          codigo,
          nome,
          tipo,
          unidadeMedida: trimOuNull(dados.unidadeMedida),
          metaFisica,
          ativa: dados.ativa ?? existente.ativa,
        },
      })
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ErroNegocio('CONFLITO', `Já existe uma ação "${codigo}" neste programa.`)
      }
      throw e
    }
  }

  async excluir(id: string) {
    const acao = await this.prisma.acao.findUnique({ where: { id } })
    if (!acao) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Ação não encontrada.')
    // Quando dotações apontarem para Ação (PR3), bloquear aqui.
    await this.prisma.acao.delete({ where: { id } })
  }

  private validar(dados: DadosAcao): {
    codigo: string
    nome: string
    tipo: TipoAcao
    metaFisica: Prisma.Decimal | null
  } {
    const codigo = dados.codigo?.trim() ?? ''
    const nome = dados.nome?.trim() ?? ''
    if (!codigo) throw new ErroNegocio('REQUISICAO_INVALIDA', 'Código é obrigatório.')
    if (!nome) throw new ErroNegocio('REQUISICAO_INVALIDA', 'Nome é obrigatório.')
    if (!TIPOS_VALIDOS.includes(dados.tipo as TipoAcao)) {
      throw new ErroNegocio(
        'REQUISICAO_INVALIDA',
        `Tipo inválido: "${dados.tipo}". Use PROJETO, ATIVIDADE ou OPERACAO_ESPECIAL.`,
      )
    }

    let metaFisica: Prisma.Decimal | null = null
    if (dados.metaFisica !== null && dados.metaFisica !== undefined && dados.metaFisica !== '') {
      try {
        metaFisica = new Prisma.Decimal(dados.metaFisica as Prisma.Decimal.Value)
      } catch {
        throw new ErroNegocio('REQUISICAO_INVALIDA', `Meta física inválida: "${dados.metaFisica}".`)
      }
      if (metaFisica.isNegative()) {
        throw new ErroNegocio('REQUISICAO_INVALIDA', 'Meta física não pode ser negativa.')
      }
    }

    return { codigo, nome, tipo: dados.tipo as TipoAcao, metaFisica }
  }
}

function trimOuNull(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null
  const t = v.trim()
  return t === '' ? null : t
}
