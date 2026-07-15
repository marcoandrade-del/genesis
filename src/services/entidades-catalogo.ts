import { PrismaClient, Prisma } from '@prisma/client'

export type EntidadeCatalogo = {
  id: string
  nome: string
  tipo: string // PREFEITURA | CAMARA | ADM_INDIRETA (rótulo curto na UI do OXY)
  municipio: { id: string; nome: string; uf: string }
  anosComOrcamento: number[]
}

/**
 * Catálogo de ENTIDADES "com base rodando" para o BI (OXY Dashboards) importar.
 *
 * No OXY, cada ENTIDADE é uma unidade de BI (prefeitura, câmara ou adm. indireta):
 * o usuário escolhe na tela `ImportarEntidades` quais entidades leva para o seu
 * catálogo. Este service é o produtor de `fonte.entidades()` do OXY — o passo PR-C
 * que substitui o fake atual ("1 prefeitura por município") pela descoberta real de
 * TODAS as entidades. Difere do `MunicipiosAtivosService` (que é município→prefeitura):
 * aqui a granularidade é a ENTIDADE, de qualquer tipo.
 *
 * Critério de inclusão: entidade `ativo=true` com plano contábil copiado
 * (`contasContabil`). Read-only, projeção do que já existe (nenhuma tabela nova).
 * Ordenada por município, depois tipo (PREFEITURA→CAMARA→ADM_INDIRETA) e nome.
 * Contrato próprio `entidades` na data-API. Ver `oxy-repo/INTEGRACAO-GENESIS.md`.
 */
export class EntidadesCatalogoService {
  constructor(private prisma: PrismaClient) {}

  async listar(): Promise<{ entidades: EntidadeCatalogo[] }> {
    const where: Prisma.EntidadeWhereInput = {
      ativo: true,
      contasContabil: { some: {} },
    }

    const entidades = await this.prisma.entidade.findMany({
      where,
      orderBy: [{ municipio: { nome: 'asc' } }, { tipo: 'asc' }, { nome: 'asc' }],
      select: {
        id: true,
        nome: true,
        tipo: true,
        municipio: { select: { id: true, nome: true, estado: { select: { sigla: true } } } },
        orcamentos: { select: { ano: true } },
      },
    })

    return {
      entidades: entidades.map((e) => ({
        id: e.id,
        nome: e.nome,
        tipo: e.tipo,
        municipio: { id: e.municipio.id, nome: e.municipio.nome, uf: e.municipio.estado.sigla },
        anosComOrcamento: [...new Set(e.orcamentos.map((o) => o.ano))].sort((a, b) => a - b),
      })),
    }
  }
}
