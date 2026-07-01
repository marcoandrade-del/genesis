import { PrismaClient } from '@prisma/client'
import { RclService, resolverComposicao, parseComposicao } from './rcl.js'
import { DespesaPessoalService, resolverComposicaoPessoal, parsePessoal } from './despesa-pessoal.js'
import { ArrecadacoesService, type LinhaFinalidade } from './arrecadacoes.js'
import { resolverClassificacaoFonte, parseClassificacaoFonte } from './fonte-classificacao.js'

const n = (d: { toNumber(): number }) => d.toNumber()

/**
 * Bancada de memoriais — calcula os 3 memoriais (RCL, Despesa com Pessoal,
 * classificação de fonte) com a composição PROPOSTA (editada) e a EFETIVA (do
 * Estado hoje), lado a lado, contra os dados reais de um município. READ-ONLY:
 * nunca grava — o preview só recalcula; persistência é a solicitação (PR-C).
 * Ver [[contabil-rcl-lrf-plano]].
 */

export interface EntradaPreview {
  entidadeId: string
  ano: number
  rcl?: unknown // composição editada (crua); ausente/inválida → usa a efetiva
  fonte?: unknown
  pessoal?: unknown
}

export interface RclPreview {
  metodologia: string
  correntesTotal: number
  deducoesTotal: number
  rcl: number
  deducoes: { rotulo: string; valor: number }[]
}
export interface PessoalPreview {
  metodologia: string
  inclusoesTotal: number
  exclusoesTotal: number
  despesaLiquida: number
  percentualRcl: number
}
export interface FontePreview {
  metodologia: string
  porFinalidade: LinhaFinalidade[]
}
export interface PreviewMemoriais {
  entidade: { nome: string; municipio: string; estado: string }
  ano: number
  temOrcamento: boolean
  rcl: { efetivo: RclPreview; proposto: RclPreview }
  pessoal: { efetivo: PessoalPreview; proposto: PessoalPreview }
  fonte: { efetivo: FontePreview; proposto: FontePreview }
  // Composições EFETIVAS (cruas) do Estado — para pré-preencher os editores na bancada.
  efetivas: { rcl: unknown; fonte: unknown; pessoal: unknown }
}

export class PreviewMemoriaisService {
  constructor(private prisma: PrismaClient) {}

  async calcular(e: EntradaPreview): Promise<PreviewMemoriais | null> {
    const ent = await this.prisma.entidade.findUnique({
      where: { id: e.entidadeId },
      select: {
        nome: true,
        municipio: {
          select: { nome: true, estado: { select: { sigla: true, rclComposicao: true, fonteClassificacao: true, pessoalComposicao: true } } },
        },
      },
    })
    if (!ent) return null
    const est = ent.municipio.estado

    // Efetivos (Estado override > default do código). Modelo entra no PR-D.
    const rclEf = resolverComposicao(est.sigla, est.rclComposicao)
    const fonteEf = resolverClassificacaoFonte(est.sigla, est.fonteClassificacao)
    const pessoalEf = resolverComposicaoPessoal(est.sigla, est.pessoalComposicao)
    // Propostos: a composição crua editada, se válida; senão cai no efetivo.
    const rclPr = parseComposicao(e.rcl) ?? rclEf
    const fontePr = parseClassificacaoFonte(e.fonte) ?? fonteEf
    const pessoalPr = parsePessoal(e.pessoal) ?? pessoalEf

    const rclSvc = new RclService(this.prisma)
    const pesSvc = new DespesaPessoalService(this.prisma)
    const arrSvc = new ArrecadacoesService(this.prisma)

    const [rE, rP, pE, pP, fE, fP] = await Promise.all([
      rclSvc.calcular(e.entidadeId, e.ano, rclEf),
      rclSvc.calcular(e.entidadeId, e.ano, rclPr),
      pesSvc.calcular(e.entidadeId, e.ano, pessoalEf),
      pesSvc.calcular(e.entidadeId, e.ano, pessoalPr),
      arrSvc.resumo(e.entidadeId, e.ano, fonteEf),
      arrSvc.resumo(e.entidadeId, e.ano, fontePr),
    ])

    const rcl = (r: typeof rE) => ({
      correntesTotal: n(r.correntesTotal),
      deducoesTotal: n(r.deducoesTotal),
      rcl: n(r.rcl),
      deducoes: r.deducoes.map((d) => ({ rotulo: d.rotulo, valor: n(d.valor) })),
    })
    const pct = (dtp: typeof pE, rclVal: number) => (rclVal > 0 ? Math.round((dtp.despesaLiquida / rclVal) * 10000) / 100 : 0)
    const pessoal = (dtp: typeof pE, comp: { nome: string }, rclVal: number): PessoalPreview => ({
      metodologia: comp.nome,
      inclusoesTotal: dtp.inclusoesTotal,
      exclusoesTotal: dtp.exclusoesTotal,
      despesaLiquida: dtp.despesaLiquida,
      percentualRcl: pct(dtp, rclVal),
    })
    const fonte = (res: typeof fE): FontePreview => ({ metodologia: res.metodologiaFonte, porFinalidade: res.porFinalidade })

    return {
      entidade: { nome: ent.nome, municipio: ent.municipio.nome, estado: est.sigla },
      ano: e.ano,
      temOrcamento: rE.temOrcamento,
      rcl: { efetivo: { ...rcl(rE), metodologia: rclEf.nome }, proposto: { ...rcl(rP), metodologia: rclPr.nome } },
      pessoal: { efetivo: pessoal(pE, pessoalEf, n(rE.rcl)), proposto: pessoal(pP, pessoalPr, n(rP.rcl)) },
      fonte: { efetivo: fonte(fE), proposto: fonte(fP) },
      efetivas: { rcl: rclEf, fonte: fonteEf, pessoal: pessoalEf },
    }
  }
}
