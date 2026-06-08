import { PrismaClient, Prisma } from '@prisma/client'
import { ErroNegocio } from '../errors.js'
import { SincronizadorContas } from './sincronizador-contas.js'

export type DadosCriarFonteRecurso = {
  modeloContabilId: string
  ano: number
  codigo: string
  nomenclatura: string
  especificacao?: string
  vinculada?: boolean
  grupo?: string
}

export type DadosAtualizarFonteRecurso = {
  nomenclatura?: string
  especificacao?: string
  vinculada?: boolean
  grupo?: string
}

export type FiltrosFonteRecurso = { modeloContabilId?: string; ano?: number }

/**
 * Fonte ou Destinação de Recursos (FR) — lista plana versionada por modelo
 * contábil × ano (NÃO é árvore). `codigo` (3 dígitos) único por modelo×ano.
 * O modelo/ano/código formam a identidade; só nomenclatura, especificação,
 * vinculada e grupo são editáveis.
 */
export class FontesRecursoService {
  constructor(private prisma: PrismaClient) {}

  private readonly sync = new SincronizadorContas()

  listar(filtros: FiltrosFonteRecurso = {}) {
    const where: Prisma.FonteRecursoWhereInput = {}
    if (filtros.modeloContabilId) where.modeloContabilId = filtros.modeloContabilId
    if (filtros.ano !== undefined) where.ano = filtros.ano
    return this.prisma.fonteRecurso.findMany({ where, orderBy: [{ ano: 'desc' }, { codigo: 'asc' }] })
  }

  buscarPorId(id: string) {
    return this.prisma.fonteRecurso.findUnique({ where: { id } })
  }

  async criar(dados: DadosCriarFonteRecurso) {
    const modelo = await this.prisma.modeloContabil.findUnique({ where: { id: dados.modeloContabilId } })
    if (!modelo) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Modelo contábil não encontrado.')

    try {
      return await this.prisma.$transaction(async (tx) => {
        const fonte = await tx.fonteRecurso.create({
          data: {
            modeloContabilId: dados.modeloContabilId,
            ano: dados.ano,
            codigo: dados.codigo,
            nomenclatura: dados.nomenclatura,
            vinculada: dados.vinculada ?? true,
            ...(dados.especificacao ? { especificacao: dados.especificacao } : {}),
            ...(dados.grupo ? { grupo: dados.grupo } : {}),
          },
        })
        await this.sync.fonteCriada(tx, fonte)
        return fonte
      })
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ErroNegocio('CONFLITO', `Já existe a fonte de recurso "${dados.codigo}" neste modelo e ano.`)
      }
      throw e
    }
  }

  async atualizar(id: string, dados: DadosAtualizarFonteRecurso) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const fonte = await tx.fonteRecurso.update({ where: { id }, data: dados })
        await this.sync.fonteAtualizada(tx, fonte)
        return fonte
      })
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
        throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Fonte de recurso não encontrada.')
      }
      throw e
    }
  }

  async excluir(id: string) {
    const fonte = await this.prisma.fonteRecurso.findUnique({ where: { id } })
    if (!fonte) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Fonte de recurso não encontrada.')
    await this.prisma.$transaction(async (tx) => {
      await this.sync.fonteExcluida(tx, id)
      await tx.fonteRecurso.delete({ where: { id } })
    })
  }
}
