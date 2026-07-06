import { PrismaClient } from '@prisma/client'
import { RclService, resolverComposicao } from './rcl.js'
import { DespesaPessoalService, resolverComposicaoPessoal } from './despesa-pessoal.js'
import { DclService } from './dcl.js'
import { RgfCadastrosService } from './rgf-cadastros.js'
import { DisponibilidadeFonteService } from './disponibilidade-fonte.js'
import { periodoQuadrimestre, type NumeroQuadrimestre } from './quadrimestre.js'

/**
 * RGF Anexo 6 — Demonstrativo Simplificado (MDF 9ª ed.): o quadro-resumo do
 * relatório. NÃO recalcula nada — compõe os mesmos services dos Anexos 1–5,
 * garantindo consistência entre o simplificado e os anexos-fonte. O bloco de
 * disponibilidade de caixa × RP só integra o RGF do 3º quadrimestre.
 */

export interface LinhaSimplificado {
  rotulo: string
  valor: number
  pctRcl: number | null
  limitePct: number | null
  limiteValor: number | null
  nivel: 'ok' | 'alerta' | 'prudencial' | 'estouro'
}

export interface ResultadoRgfSimplificado {
  temOrcamento: boolean
  rcl: number
  rclRealizada: number
  linhas: LinhaSimplificado[]
  disponibilidade: { caixaLiquida: number; rpNaoProcessados: number } | null // só q=3
}

const r2 = (n: number) => Math.round(n * 100) / 100
const pct = (v: number, rcl: number) => (rcl > 0 ? Math.round((v / rcl) * 10000) / 100 : 0)

export class RgfSimplificadoService {
  constructor(private prisma: PrismaClient) {}

  async calcular(entidadeId: string, ano: number, q: NumeroQuadrimestre): Promise<ResultadoRgfSimplificado> {
    const ent = await this.prisma.entidade.findUnique({
      where: { id: entidadeId },
      select: {
        municipio: {
          select: {
            estado: {
              select: {
                sigla: true,
                rclComposicao: true,
                pessoalComposicao: true,
                modeloContabil: { select: { rclComposicao: true, pessoalComposicao: true } },
              },
            },
          },
        },
      },
    })
    const estado = ent?.municipio?.estado
    const per = periodoQuadrimestre(ano, q)

    const [rclR, dtp, dcl, totais, disp] = await Promise.all([
      new RclService(this.prisma).calcular(entidadeId, ano, resolverComposicao(estado?.sigla, estado?.rclComposicao, estado?.modeloContabil?.rclComposicao)),
      new DespesaPessoalService(this.prisma).calcularExecutado(entidadeId, ano, resolverComposicaoPessoal(estado?.sigla, estado?.pessoalComposicao, estado?.modeloContabil?.pessoalComposicao), per.fim),
      new DclService(this.prisma).calcular(entidadeId, ano),
      new RgfCadastrosService(this.prisma).totais(entidadeId, ano, per.fim),
      q === 3 ? new DisponibilidadeFonteService(this.prisma).calcular(entidadeId, ano) : Promise.resolve(null),
    ])
    const rcl = rclR.rcl.toNumber()

    const nivelDe = (p: number, limites: { estouro: number; prudencial?: number; alerta: number }): LinhaSimplificado['nivel'] =>
      p >= limites.estouro ? 'estouro' : limites.prudencial != null && p >= limites.prudencial ? 'prudencial' : p >= limites.alerta ? 'alerta' : 'ok'

    const linha = (rotulo: string, valor: number, limitePct: number | null, nivel: LinhaSimplificado['nivel']): LinhaSimplificado => ({
      rotulo,
      valor: r2(valor),
      pctRcl: rcl > 0 ? pct(valor, rcl) : null,
      limitePct,
      limiteValor: limitePct != null && rcl > 0 ? r2((rcl * limitePct) / 100) : null,
      nivel,
    })

    const pDtp = pct(dtp.dtp, rcl)
    const pDcl = pct(dcl.dcl, rcl)
    const pGar = pct(totais.garantias.total, rcl)
    const pOp = pct(totais.operacoes.sujeitas, rcl)
    const pAro = pct(totais.operacoes.aro, rcl)

    return {
      temOrcamento: rcl > 0,
      rcl: r2(rcl),
      rclRealizada: r2(rclR.rclRealizado.toNumber()),
      linhas: [
        linha('Despesa Total com Pessoal — DTP (executada)', dtp.dtp, 54, nivelDe(pDtp, { estouro: 54, prudencial: 51.3, alerta: 48.6 })),
        linha('Dívida Consolidada Líquida — DCL', dcl.dcl, 120, nivelDe(pDcl, { estouro: 120, alerta: 108 })),
        linha('Garantias de valores', totais.garantias.total, 22, nivelDe(pGar, { estouro: 22, alerta: 19.8 })),
        linha('Operações de crédito (sujeitas ao limite)', totais.operacoes.sujeitas, 16, nivelDe(pOp, { estouro: 16, alerta: 14.4 })),
        linha('Operações de crédito por ARO', totais.operacoes.aro, 7, nivelDe(pAro, { estouro: 7, alerta: 7 })),
      ],
      disponibilidade: disp
        ? {
            caixaLiquida: r2(disp.totais.caixa - disp.totais.rpProcessados),
            rpNaoProcessados: r2(disp.totais.rpNaoProcessados),
          }
        : null,
    }
  }
}
