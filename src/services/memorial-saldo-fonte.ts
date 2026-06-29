import { PrismaClient } from '@prisma/client'
import { ArrecadacoesService, type LinhaFinalidade } from './arrecadacoes.js'
import { SaldoOrcamentarioService, type LinhaSaldoFinalidade } from './saldo-orcamentario.js'

export interface MemorialSaldoFonte {
  entidade: { id: string; nome: string; municipio: string; estado: string }
  ano: number
  metodologia: string // nome da classificação de fonte aplicada (default ou config do Estado)
  receita: { temOrcamento: boolean; porFinalidade: LinhaFinalidade[]; total: number }
  despesa: { temOrcamento: boolean; porFinalidade: LinhaSaldoFinalidade[]; total: number }
}

/**
 * Memorial do SALDO POR FONTE/FINALIDADE (eixo da prestação de contas): receita
 * prevista×arrecadada e despesa autorizada, agregadas por finalidade da fonte
 * (MDE/ASPS/FUNDEB/livres/…). O Gênesis calcula; o Oxy exibe. Ver
 * [[oxy-dashboards-integracao]] e [[contabil-regras-orcamentario]].
 *
 * ⚠️ A receita traz a finalidade real; a despesa de entidades importadas sem
 * fonte por dotação cai em "Não classificada" (fonte 9999) até o QDD entrar.
 */
export class MemorialSaldoFonteService {
  constructor(private prisma: PrismaClient) {}

  async saldoFonte(entidadeId: string, ano: number): Promise<MemorialSaldoFonte | null> {
    const ent = await this.prisma.entidade.findUnique({
      where: { id: entidadeId },
      select: { id: true, nome: true, municipio: { select: { nome: true, estado: { select: { sigla: true } } } } },
    })
    if (!ent) return null

    const [rec, desp] = await Promise.all([
      new ArrecadacoesService(this.prisma).resumo(entidadeId, ano),
      new SaldoOrcamentarioService(this.prisma).calcular(entidadeId, ano),
    ])

    return {
      entidade: { id: ent.id, nome: ent.nome, municipio: ent.municipio.nome, estado: ent.municipio.estado.sigla },
      ano,
      metodologia: rec.metodologiaFonte,
      receita: { temOrcamento: rec.temOrcamento, porFinalidade: rec.porFinalidade, total: rec.resumo.previsto },
      despesa: { temOrcamento: desp.temOrcamento, porFinalidade: desp.porFinalidade, total: desp.resumo.autorizado },
    }
  }
}
