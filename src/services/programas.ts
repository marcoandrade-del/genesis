import { PrismaClient, Prisma, type TipoPrograma } from '@prisma/client'
import { ErroNegocio } from '../errors.js'

const TIPOS_VALIDOS: ReadonlyArray<TipoPrograma> = ['FINALISTICO', 'GESTAO', 'OPERACOES_ESPECIAIS']

export type DadosPrograma = {
  codigo: string
  nome: string
  tipo: TipoPrograma | string
  objetivo?: string | null
  ativo?: boolean
}

/**
 * Programa do PPA-LOA (por entidade × ano). Articula um conjunto de Ações em
 * torno de um objetivo de governo. Código único por (entidade, ano).
 */
export class ProgramasService {
  constructor(private prisma: PrismaClient) {}

  listar(entidadeId: string, ano: number) {
    return this.prisma.programa.findMany({
      where: { entidadeId, ano },
      orderBy: { codigo: 'asc' },
      include: { _count: { select: { acoes: true } } },
    })
  }

  buscarPorId(id: string) {
    return this.prisma.programa.findUnique({
      where: { id },
      include: { acoes: { orderBy: { codigo: 'asc' } } },
    })
  }

  async criar(entidadeId: string, ano: number, dados: DadosPrograma) {
    const { codigo, nome, tipo } = this.validar(dados)

    const entidade = await this.prisma.entidade.findUnique({ where: { id: entidadeId } })
    if (!entidade) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Entidade não encontrada.')

    try {
      return await this.prisma.programa.create({
        data: {
          entidadeId,
          ano,
          codigo,
          nome,
          tipo,
          objetivo: trimOuNull(dados.objetivo),
          ativo: dados.ativo ?? true,
        },
      })
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ErroNegocio('CONFLITO', `Já existe um programa "${codigo}" nesta entidade para ${ano}.`)
      }
      throw e
    }
  }

  async atualizar(id: string, dados: DadosPrograma) {
    const { codigo, nome, tipo } = this.validar(dados)
    const existente = await this.prisma.programa.findUnique({ where: { id } })
    if (!existente) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Programa não encontrado.')

    try {
      return await this.prisma.programa.update({
        where: { id },
        data: {
          codigo,
          nome,
          tipo,
          objetivo: trimOuNull(dados.objetivo),
          ativo: dados.ativo ?? existente.ativo,
        },
      })
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ErroNegocio(
          'CONFLITO',
          `Já existe um programa "${codigo}" nesta entidade para ${existente.ano}.`,
        )
      }
      throw e
    }
  }

  async excluir(id: string) {
    const prog = await this.prisma.programa.findUnique({
      where: { id },
      include: { _count: { select: { acoes: true } } },
    })
    if (!prog) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Programa não encontrado.')
    if (prog._count.acoes > 0) {
      throw new ErroNegocio(
        'CONFLITO',
        `Não é possível excluir: programa tem ${prog._count.acoes} ação(ões) vinculada(s).`,
      )
    }
    await this.prisma.programa.delete({ where: { id } })
  }

  private validar(dados: DadosPrograma): { codigo: string; nome: string; tipo: TipoPrograma } {
    const codigo = dados.codigo?.trim() ?? ''
    const nome = dados.nome?.trim() ?? ''
    if (!codigo) throw new ErroNegocio('REQUISICAO_INVALIDA', 'Código é obrigatório.')
    if (!nome) throw new ErroNegocio('REQUISICAO_INVALIDA', 'Nome é obrigatório.')
    if (!TIPOS_VALIDOS.includes(dados.tipo as TipoPrograma)) {
      throw new ErroNegocio(
        'REQUISICAO_INVALIDA',
        `Tipo inválido: "${dados.tipo}". Use FINALISTICO, GESTAO ou OPERACOES_ESPECIAIS.`,
      )
    }
    return { codigo, nome, tipo: dados.tipo as TipoPrograma }
  }
}

function trimOuNull(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null
  const t = v.trim()
  return t === '' ? null : t
}
