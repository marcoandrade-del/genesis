import { PrismaClient, Prisma } from '@prisma/client'

export type PrefeituraCatalogo = {
  id: string
  nome: string
  cnpj: string | null
  anosComOrcamento: number[]
}

export type MunicipioCatalogo = {
  id: string
  nome: string
  estado: string
  prefeitura: PrefeituraCatalogo
}

/**
 * Catálogo de municípios "com base rodando" para o BI (OXY Dashboards).
 *
 * Critério de inclusão: município com ≥1 entidade PREFEITURA `ativo=true` e com
 * plano contábil copiado (`contasContabil`). É o mesmo critério de "municípios
 * ativos" do admin (`src/admin/municipios.ts`), acrescido do tipo PREFEITURA — o
 * BI escolhe o MUNICÍPIO e o sistema usa a PREFEITURA. Read-only, projeção do que
 * já existe (nenhuma tabela nova). Contrato próprio `municipios` na data-API.
 */
export class MunicipiosAtivosService {
  constructor(private prisma: PrismaClient) {}

  async listar(): Promise<{ municipios: MunicipioCatalogo[] }> {
    const prefeituraAtiva: Prisma.EntidadeWhereInput = {
      tipo: 'PREFEITURA',
      ativo: true,
      contasContabil: { some: {} },
    }

    const municipios = await this.prisma.municipio.findMany({
      where: { entidades: { some: prefeituraAtiva } },
      orderBy: { nome: 'asc' },
      include: {
        estado: { select: { sigla: true } },
        entidades: {
          where: prefeituraAtiva,
          select: { id: true, nome: true, cnpj: true, orcamentos: { select: { ano: true } } },
        },
      },
    })

    return {
      municipios: municipios.flatMap((m) => {
        const prefeitura = m.entidades[0]
        if (!prefeitura) return [] // não ocorre (o where garante ≥1 prefeitura); guarda só p/ o tipo
        if (m.entidades.length > 1) {
          console.warn(
            `[municipios-ativos] município ${m.nome} (${m.id}) tem ${m.entidades.length} prefeituras ativas; usando a primeira.`,
          )
        }
        const anos = [...new Set(prefeitura.orcamentos.map((o) => o.ano))].sort((a, b) => a - b)
        return [
          {
            id: m.id,
            nome: m.nome,
            estado: m.estado.sigla,
            prefeitura: { id: prefeitura.id, nome: prefeitura.nome, cnpj: prefeitura.cnpj, anosComOrcamento: anos },
          },
        ]
      }),
    }
  }
}
