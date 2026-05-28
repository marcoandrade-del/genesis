import { randomUUID } from 'node:crypto'
import { PrismaClient, Prisma } from '@prisma/client'
import { ErroNegocio } from '../errors.js'
import { parseCSV, validar } from './importador-plano-contas.js'
import { NIVEL_MAX_DESPESA } from './contas-despesa.js'

/**
 * Importador do Plano de Contas da Despesa via CSV. Mesmo formato e validações
 * do importador contábil (colunas codigo/descricao/codigoPai/admiteMovimento),
 * com o teto de níveis próprio da despesa.
 */
export class ImportadorPlanoDespesaService {
  constructor(private prisma: PrismaClient) {}

  async importar(planoId: string, csv: string): Promise<{ criadas: number }> {
    const plano = await this.prisma.planoContasDespesa.findUnique({ where: { id: planoId } })
    if (!plano) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Plano de contas da despesa não encontrado.')

    const linhas = parseCSV(csv)
    if (linhas.length === 0) throw new ErroNegocio('REQUISICAO_INVALIDA', 'CSV não contém linhas de dados.')

    const niveis = validar(linhas, NIVEL_MAX_DESPESA)

    const idPorCodigo = new Map<string, string>(linhas.map((l) => [l.codigo, randomUUID()]))
    const dados = linhas.map((l) => ({
      id: idPorCodigo.get(l.codigo)!,
      planoId,
      codigo: l.codigo,
      descricao: l.descricao,
      nivel: niveis.get(l.codigo)!,
      admiteMovimento: l.admiteMovimento,
      parentId: l.codigoPai ? idPorCodigo.get(l.codigoPai)! : null,
    }))

    try {
      const { count } = await this.prisma.contaDespesa.createMany({ data: dados })
      return { criadas: count }
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ErroNegocio(
          'CONFLITO',
          'Um ou mais códigos do CSV já existem no plano. Remova os duplicados ou esvazie o plano antes de importar.',
        )
      }
      throw e
    }
  }
}
