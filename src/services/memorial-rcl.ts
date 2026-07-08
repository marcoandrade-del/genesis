import { PrismaClient } from '@prisma/client'
import { RclService, resolverComposicao } from './rcl.js'
import { RclConsolidadaService } from './rcl-consolidada.js'
import { ConsolidacaoService } from './consolidacao.js'

const n = (d: { toNumber(): number }) => d.toNumber()

export interface MemorialDespesaConsolidada {
  municipio: string
  estado: string
  ano: number
  entidades: { nome: string; empenhado: number; intraEmpenhado: number }[]
  empenhadoBruto: number
  intraEliminada: number
  empenhadoConsolidado: number
}

export interface MemorialReceitaConsolidada {
  municipio: string
  estado: string
  ano: number
  entidades: { nome: string; arrecadado: number; intraArrecadado: number }[]
  arrecadadoBruto: number
  intraEliminada: number
  arrecadadoConsolidado: number
}

export interface LinhaMemorial {
  codigo?: string
  rotulo: string
  valor: number // previsto (LOA)
  valorRealizado: number // arrecadado (execução)
}

export interface MemorialRcl {
  entidade: { id: string; nome: string; municipio: string; estado: string }
  ano: number
  metodologia: string
  temOrcamento: boolean
  correntes: LinhaMemorial[]
  correntesTotal: number
  deducoes: LinhaMemorial[]
  deducoesTotal: number
  rcl: number
  // RCL EXECUTADA (arrecadado), ao lado da prevista. Aditivo.
  correntesRealizadoTotal: number
  deducoesRealizadoTotal: number
  rclRealizado: number
}

export interface MemorialRclConsolidada {
  municipio: string
  estado: string
  ano: number
  metodologia: string
  entidades: { nome: string; correntes: number; deducoes: number; rcl: number; temOrcamento: boolean }[]
  correntesTotal: number
  deducoesTotal: number
  intra: number
  rclTotal: number
}

/**
 * Memorial da RCL no formato "pronto para exibir": inputs (receitas correntes),
 * demonstrativo (deduções nomeadas) e o resultado. O cálculo é ÚNICO (RclService
 * + composição do Estado) — o Gênesis calcula, o Oxy só exibe, garantindo
 * consistência nos dois lados. Ver [[oxy-dashboards-integracao]].
 */
export class MemorialRclService {
  constructor(private prisma: PrismaClient) {}

  async rcl(entidadeId: string, ano: number): Promise<MemorialRcl | null> {
    const ent = await this.prisma.entidade.findUnique({
      where: { id: entidadeId },
      select: {
        id: true,
        nome: true,
        municipio: { select: { nome: true, estado: { select: { sigla: true, rclComposicao: true, modeloContabil: { select: { rclComposicao: true } } } } } },
      },
    })
    if (!ent) return null
    const comp = resolverComposicao(ent.municipio.estado.sigla, ent.municipio.estado.rclComposicao, ent.municipio.estado.modeloContabil?.rclComposicao)
    const r = await new RclService(this.prisma).calcular(entidadeId, ano, comp)
    return {
      entidade: { id: ent.id, nome: ent.nome, municipio: ent.municipio.nome, estado: ent.municipio.estado.sigla },
      ano,
      metodologia: comp.nome,
      temOrcamento: r.temOrcamento,
      correntes: r.correntes.map((l) => ({ codigo: l.codigo, rotulo: l.rotulo, valor: n(l.valor), valorRealizado: n(l.valorRealizado) })),
      correntesTotal: n(r.correntesTotal),
      deducoes: r.deducoes.map((l) => ({ rotulo: l.rotulo, valor: n(l.valor), valorRealizado: n(l.valorRealizado) })),
      deducoesTotal: n(r.deducoesTotal),
      rcl: n(r.rcl),
      correntesRealizadoTotal: n(r.correntesRealizadoTotal),
      deducoesRealizadoTotal: n(r.deducoesRealizadoTotal),
      rclRealizado: n(r.rclRealizado),
    }
  }

  async rclConsolidada(entidadeId: string, ano: number): Promise<MemorialRclConsolidada | null> {
    const ent = await this.prisma.entidade.findUnique({
      where: { id: entidadeId },
      select: { municipioId: true, municipio: { select: { nome: true, estado: { select: { sigla: true } } } } },
    })
    if (!ent) return null
    const cons = await new RclConsolidadaService(this.prisma).calcular(ent.municipioId, ano)
    return {
      municipio: ent.municipio.nome,
      estado: ent.municipio.estado.sigla,
      ano,
      metodologia: cons.metodologia,
      entidades: cons.entidades.map((e) => ({
        nome: e.nome,
        correntes: n(e.correntes),
        deducoes: n(e.deducoes),
        rcl: n(e.rcl),
        temOrcamento: e.temOrcamento,
      })),
      correntesTotal: n(cons.correntesTotal),
      deducoesTotal: n(cons.deducoesTotal),
      intra: n(cons.intra),
      rclTotal: n(cons.rclTotal),
    }
  }

  /** Despesa consolidada do ENTE — soma das entidades com eliminação da
   *  parcela intra-orçamentária (modalidade 91). Recebe uma entidade qualquer
   *  do município e devolve o consolidado. */
  async despesaConsolidada(entidadeId: string, ano: number): Promise<MemorialDespesaConsolidada | null> {
    const ent = await this.prisma.entidade.findUnique({
      where: { id: entidadeId },
      select: { municipioId: true, municipio: { select: { nome: true, estado: { select: { sigla: true } } } } },
    })
    if (!ent) return null
    const cons = await new ConsolidacaoService(this.prisma).despesa(ent.municipioId, ano)
    return {
      municipio: ent.municipio.nome,
      estado: ent.municipio.estado.sigla,
      ano,
      entidades: cons.entidades.map((e) => ({ nome: e.nome, empenhado: n(e.empenhado), intraEmpenhado: n(e.intraEmpenhado) })),
      empenhadoBruto: n(cons.empenhadoBruto),
      intraEliminada: n(cons.intraEliminada),
      empenhadoConsolidado: n(cons.empenhadoConsolidado),
    }
  }

  /** Receita consolidada do ENTE — soma das entidades − receita intra (cat 7/8). */
  async receitaConsolidada(entidadeId: string, ano: number): Promise<MemorialReceitaConsolidada | null> {
    const ent = await this.prisma.entidade.findUnique({
      where: { id: entidadeId },
      select: { municipioId: true, municipio: { select: { nome: true, estado: { select: { sigla: true } } } } },
    })
    if (!ent) return null
    const cons = await new ConsolidacaoService(this.prisma).receita(ent.municipioId, ano)
    return {
      municipio: ent.municipio.nome,
      estado: ent.municipio.estado.sigla,
      ano,
      entidades: cons.entidades.map((e) => ({ nome: e.nome, arrecadado: n(e.arrecadado), intraArrecadado: n(e.intraArrecadado) })),
      arrecadadoBruto: n(cons.arrecadadoBruto),
      intraEliminada: n(cons.intraEliminada),
      arrecadadoConsolidado: n(cons.arrecadadoConsolidado),
    }
  }
}
