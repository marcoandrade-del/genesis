import { PrismaClient, Prisma } from '@prisma/client'
import { ehDespesaIntra } from './natureza-intra.js'

/**
 * Consolidação das contas do ENTE (Município) — soma das entidades com
 * ELIMINAÇÃO das transações intragovernamentais (intra-OFSS).
 *
 * O total consolidado do ente NÃO é a soma pura das entidades: operações
 * entre elas (ex.: contribuição patronal da Prefeitura ao RPPS, duodécimo à
 * Câmara) apareceriam duas vezes. A consolidação soma e desconta a parcela
 * intra (LRF art. 50 §1º; MCASP). O marcador é derivado da classificação —
 * despesa modalidade 91 — via [[natureza-intra]] (sem campo no schema).
 *
 * MVP: lado DESPESA (empenhado/liquidado/pago), a partir do razão
 * `MovimentoEmpenho` (a fonte da verdade da execução). Retorna bruto (soma),
 * intra (parcela a eliminar) e líquido (consolidado do ente).
 */

const D0 = () => new Prisma.Decimal(0)

export type DespesaEntidade = {
  entidadeId: string
  nome: string
  empenhado: Prisma.Decimal
  intraEmpenhado: Prisma.Decimal // modalidade 91 desta entidade
}

export type DespesaConsolidada = {
  entidades: DespesaEntidade[]
  empenhadoBruto: Prisma.Decimal // Σ das entidades (conta a intra em duplicidade)
  intraEliminada: Prisma.Decimal // Σ das despesas modalidade 91
  empenhadoConsolidado: Prisma.Decimal // bruto − intra = despesa do ente
}

const SINAL: Record<string, number> = { EMPENHO: 1, ESTORNO_EMPENHO: -1 }

export class ConsolidacaoService {
  constructor(private prisma: PrismaClient) {}

  async despesa(municipioId: string, ano: number): Promise<DespesaConsolidada> {
    const municipio = await this.prisma.municipio.findUnique({
      where: { id: municipioId },
      select: { entidades: { where: { ativo: true }, orderBy: { nome: 'asc' }, select: { id: true, nome: true } } },
    })

    const inicio = new Date(Date.UTC(ano, 0, 1))
    const fim = new Date(Date.UTC(ano, 11, 31))
    const entidades: DespesaEntidade[] = []
    let empenhadoBruto = D0()
    let intraEliminada = D0()

    for (const e of municipio?.entidades ?? []) {
      // razão da despesa da entidade, com a natureza da dotação p/ marcar a intra
      const movs = await this.prisma.movimentoEmpenho.findMany({
        where: { entidadeId: e.id, tipo: { in: ['EMPENHO', 'ESTORNO_EMPENHO'] }, data: { gte: inicio, lte: fim } },
        select: { tipo: true, valor: true, empenho: { select: { dotacaoDespesa: { select: { contaDespesa: { select: { codigo: true } } } } } } },
      })
      let empenhado = D0()
      let intra = D0()
      for (const mv of movs) {
        const v = new Prisma.Decimal(mv.valor).mul(SINAL[mv.tipo] ?? 0)
        empenhado = empenhado.plus(v)
        if (ehDespesaIntra(mv.empenho.dotacaoDespesa.contaDespesa.codigo)) intra = intra.plus(v)
      }
      entidades.push({ entidadeId: e.id, nome: e.nome, empenhado, intraEmpenhado: intra })
      empenhadoBruto = empenhadoBruto.plus(empenhado)
      intraEliminada = intraEliminada.plus(intra)
    }

    return {
      entidades,
      empenhadoBruto,
      intraEliminada,
      empenhadoConsolidado: empenhadoBruto.minus(intraEliminada),
    }
  }
}
