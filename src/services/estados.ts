import { PrismaClient, Prisma } from '@prisma/client'
import { ErroNegocio } from '../errors.js'

export class EstadosService {
  constructor(private prisma: PrismaClient) {}

  listar() {
    return this.prisma.estado.findMany({ orderBy: { nome: 'asc' } })
  }

  buscarPorId(id: string) {
    return this.prisma.estado.findUnique({ where: { id } })
  }

  /**
   * Altera o modelo contábil do estado e PROPAGA para todos os municípios.
   * Conforme spec: "Se alterar o modelo no estado, deve atualizar todos os municípios".
   * Sobrescreve customizações locais — comportamento intencional.
   */
  async definirModelo(estadoId: string, modeloContabilId: string | null) {
    const estado = await this.prisma.estado.findUnique({ where: { id: estadoId } })
    if (!estado) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Estado não encontrado.')

    if (modeloContabilId !== null) {
      const modelo = await this.prisma.modeloContabil.findUnique({ where: { id: modeloContabilId } })
      if (!modelo) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Modelo contábil não encontrado.')
    }

    return this.prisma.$transaction(async (tx) => {
      const atualizado = await tx.estado.update({
        where: { id: estadoId },
        data: { modeloContabilId },
      })
      const { count } = await tx.municipio.updateMany({
        where: { estadoId },
        data: { modeloContabilId },
      })
      return { estado: atualizado, municipiosAtualizados: count }
    })
  }

  /** Garante que o estado existe (usado por services que dependem de estado). */
  async garantirExistencia(id: string) {
    const estado = await this.prisma.estado.findUnique({ where: { id } })
    if (!estado) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Estado não encontrado.')
    return estado
  }
}

/** Os 27 UFs do Brasil (26 estados + DF), com sigla normalizada em CHAR(2). */
export const ESTADOS_BRASIL: ReadonlyArray<{ sigla: string; nome: string }> = [
  { sigla: 'AC', nome: 'Acre' },
  { sigla: 'AL', nome: 'Alagoas' },
  { sigla: 'AP', nome: 'Amapá' },
  { sigla: 'AM', nome: 'Amazonas' },
  { sigla: 'BA', nome: 'Bahia' },
  { sigla: 'CE', nome: 'Ceará' },
  { sigla: 'DF', nome: 'Distrito Federal' },
  { sigla: 'ES', nome: 'Espírito Santo' },
  { sigla: 'GO', nome: 'Goiás' },
  { sigla: 'MA', nome: 'Maranhão' },
  { sigla: 'MT', nome: 'Mato Grosso' },
  { sigla: 'MS', nome: 'Mato Grosso do Sul' },
  { sigla: 'MG', nome: 'Minas Gerais' },
  { sigla: 'PA', nome: 'Pará' },
  { sigla: 'PB', nome: 'Paraíba' },
  { sigla: 'PR', nome: 'Paraná' },
  { sigla: 'PE', nome: 'Pernambuco' },
  { sigla: 'PI', nome: 'Piauí' },
  { sigla: 'RJ', nome: 'Rio de Janeiro' },
  { sigla: 'RN', nome: 'Rio Grande do Norte' },
  { sigla: 'RS', nome: 'Rio Grande do Sul' },
  { sigla: 'RO', nome: 'Rondônia' },
  { sigla: 'RR', nome: 'Roraima' },
  { sigla: 'SC', nome: 'Santa Catarina' },
  { sigla: 'SP', nome: 'São Paulo' },
  { sigla: 'SE', nome: 'Sergipe' },
  { sigla: 'TO', nome: 'Tocantins' },
]

/**
 * Idempotente: cria os 27 UFs se ainda não existirem (chave: sigla única).
 * Usado pelo seed e pode ser chamado por testes de integração.
 */
export async function semearEstados(prisma: PrismaClient): Promise<number> {
  let inseridos = 0
  for (const { sigla, nome } of ESTADOS_BRASIL) {
    try {
      await prisma.estado.create({ data: { sigla, nome } })
      inseridos++
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') continue
      throw e
    }
  }
  return inseridos
}
