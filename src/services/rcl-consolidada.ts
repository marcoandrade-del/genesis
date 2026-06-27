import { PrismaClient, Prisma } from '@prisma/client'
import { RclService, resolverComposicao } from './rcl.js'

const D0 = () => new Prisma.Decimal(0)

export type RclEntidade = {
  entidadeId: string
  nome: string
  correntes: Prisma.Decimal
  deducoes: Prisma.Decimal
  rcl: Prisma.Decimal
  temOrcamento: boolean
}

export type RclConsolidada = {
  entidades: RclEntidade[]
  correntesTotal: Prisma.Decimal
  deducoesTotal: Prisma.Decimal
  intra: Prisma.Decimal // transferências intragovernamentais (duplicidades) deduzidas
  rclTotal: Prisma.Decimal
  metodologia: string
}

/**
 * RCL consolidada do MUNICÍPIO (o "ente"): soma as receitas correntes e as
 * deduções de TODAS as entidades do município (Prefeitura, Câmara, RPPS,
 * autarquias) — assim a contribuição ao RPPS, que é receita da entidade de
 * previdência, entra como dedução do conjunto. Reusa o RclService por entidade
 * com a composição do Estado.
 *
 * ⚠️ As transferências intragovernamentais (duplicidades — ex.: duodécimo da
 * Prefeitura para a Câmara) ainda não são deduzidas: exigem rastrear a origem
 * do repasse, que o cadastro de receita não traz. Ficam em `intra = 0` até lá.
 * Ver [[contabil-rcl-lrf-plano]].
 */
export class RclConsolidadaService {
  constructor(private prisma: PrismaClient) {}

  async calcular(municipioId: string, ano: number): Promise<RclConsolidada> {
    const municipio = await this.prisma.municipio.findUnique({
      where: { id: municipioId },
      select: {
        estado: { select: { sigla: true, rclComposicao: true } },
        entidades: { where: { ativo: true }, orderBy: { nome: 'asc' }, select: { id: true, nome: true } },
      },
    })
    const comp = resolverComposicao(municipio?.estado.sigla, municipio?.estado.rclComposicao)
    const rclSvc = new RclService(this.prisma)

    const entidades: RclEntidade[] = []
    for (const e of municipio?.entidades ?? []) {
      const r = await rclSvc.calcular(e.id, ano, comp)
      entidades.push({
        entidadeId: e.id,
        nome: e.nome,
        correntes: r.correntesTotal,
        deducoes: r.deducoesTotal,
        rcl: r.rcl,
        temOrcamento: r.temOrcamento,
      })
    }

    const correntesTotal = entidades.reduce((a, e) => a.plus(e.correntes), D0())
    const deducoesTotal = entidades.reduce((a, e) => a.plus(e.deducoes), D0())
    const intra = D0() // duplicidades intragovernamentais — a apurar
    return {
      entidades,
      correntesTotal,
      deducoesTotal,
      intra,
      rclTotal: correntesTotal.minus(deducoesTotal).minus(intra),
      metodologia: comp.nome,
    }
  }
}
