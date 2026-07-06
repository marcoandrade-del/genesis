import { PrismaClient, Prisma } from '@prisma/client'
import { MemorialRclService } from './memorial-rcl.js'
import { DespesaPessoalService, resolverComposicaoPessoal, type ComposicaoPessoal } from './despesa-pessoal.js'
import { IndiceConstitucionalService, composicaoIndicesDoEstado, type ResultadoIndice } from './indice-constitucional.js'
import { ROTULO_META } from './metas-fiscais.js'
import { DclService } from './dcl.js'
import { RgfCadastrosService } from './rgf-cadastros.js'

const n = (d: { toNumber(): number }) => d.toNumber()
const D0 = () => new Prisma.Decimal(0)
const r1 = (x: number): number => Math.round(x * 10) / 10

export interface LinhaMemorialGuardiao {
  item: string
  valor: number
}

export interface IndicadorGuardiao {
  indicador: string
  unidade: string
  valor: number // R$
  base: number // R$
  percentual: number // %
  limite: number | null
  prudencial: number | null
  alerta: number | null
  nivel: string // ok | alerta | prudencial | estouro
  memorial: { descricao: string; baseLegal: string; linhas: LinhaMemorialGuardiao[] }
}

export interface Guardiao {
  entidade: { id: string; nome: string; municipio: string; estado: string }
  ano: number
  metodologia: string
  temOrcamento: boolean
  indicadores: IndicadorGuardiao[]
}

function nivelDe(pct: number, limite: number | null, prudencial: number, alerta: number): string {
  if (limite == null) return 'ok'
  if (pct >= limite) return 'estouro'
  if (pct >= prudencial) return 'prudencial'
  if (pct >= alerta) return 'alerta'
  return 'ok'
}

/** Indicador INFORMATIVO de aplicação por função (não é o índice constitucional). */
function aplicacaoFuncao(nome: string, valor: number, total: number, descFuncao: string, nota: string): IndicadorGuardiao {
  return {
    indicador: nome,
    unidade: '% da despesa',
    valor,
    base: total,
    percentual: total ? r1((valor / total) * 100) : 0,
    limite: null,
    prudencial: null,
    alerta: null,
    nivel: 'ok',
    memorial: {
      descricao: `Despesa autorizada na ${descFuncao} ÷ despesa total autorizada (informativo).`,
      baseLegal: nota,
      linhas: [
        { item: `Despesa na ${descFuncao}`, valor },
        { item: 'Despesa total autorizada', valor: total },
      ],
    },
  }
}

/**
 * Guardião LRF — os indicadores fiscais calculados NO GÊNESIS (fonte única),
 * prontos pra exibir no Oxy. Hoje: RCL (base) + Despesa com Pessoal (% da RCL,
 * limite 54%) + Aplicação em Educação/Saúde (informativo — participação por
 * função; NÃO é o índice constitucional, que exige vinculação por fonte).
 * Dívida/Restos a Pagar entram quando o Gênesis tiver execução/passivo.
 * Ver [[oxy-dashboards-integracao]].
 */
export class MemorialGuardiaoService {
  constructor(private prisma: PrismaClient) {}

  async guardiao(entidadeId: string, ano: number): Promise<Guardiao | null> {
    const rcl = await new MemorialRclService(this.prisma).rcl(entidadeId, ano)
    if (!rcl) return null

    const indicadores: IndicadorGuardiao[] = []
    if (rcl.temOrcamento) {
      // 1) RCL — base dos limites (informativa, sem limite próprio).
      indicadores.push({
        indicador: 'Receita Corrente Líquida',
        unidade: 'R$',
        valor: rcl.rcl,
        base: rcl.correntesTotal,
        percentual: rcl.correntesTotal ? r1((rcl.rcl / rcl.correntesTotal) * 100) : 0,
        limite: null,
        prudencial: null,
        alerta: null,
        nivel: 'ok',
        memorial: {
          descricao: `RCL = Receitas Correntes − Deduções (${rcl.metodologia}).`,
          baseLegal: 'LRF art. 2º, IV; RREO Anexo 3.',
          linhas: [
            ...rcl.correntes.map((c) => ({ item: c.rotulo, valor: c.valor })),
            ...rcl.deducoes.map((d) => ({ item: '(−) ' + d.rotulo, valor: d.valor })),
          ],
        },
      })

      // 2) Despesa com Pessoal (% da RCL) — DTP fiel (inclusões − exclusões, RGF Anexo 1).
      // Base: dotação autorizada (execução não lançada).
      if (rcl.rcl > 0) {
        const compPessoal = await this.composicaoPessoal(entidadeId)
        const dtp = await new DespesaPessoalService(this.prisma).calcular(entidadeId, ano, compPessoal)
        const pessoal = dtp.despesaLiquida
        const pct = r1((pessoal / rcl.rcl) * 100)
        indicadores.push({
          indicador: 'Despesa com Pessoal',
          unidade: '% da RCL',
          valor: pessoal,
          base: rcl.rcl,
          percentual: pct,
          limite: 54,
          prudencial: 51.3,
          alerta: 48.6,
          nivel: nivelDe(pct, 54, 51.3, 48.6),
          memorial: {
            descricao: `Despesa Total com Pessoal (inclusões − exclusões, ${dtp.metodologia}) ÷ RCL. Base: dotação autorizada — execução ainda não lançada.`,
            baseLegal: 'LRF arts. 18-20 (limite 54% Executivo), 22 (prudencial) e 59 (alerta do TCE).',
            linhas: [
              ...dtp.inclusoes.map((l) => ({ item: l.rotulo, valor: l.valor })),
              ...dtp.exclusoes.map((l) => ({ item: l.rotulo, valor: l.valor })),
              { item: '= Despesa com Pessoal (líquida)', valor: pessoal },
              { item: 'RCL', valor: rcl.rcl },
            ],
          },
        })
      }

      // 3) Aplicação em Educação e Saúde (informativo) — despesa por função ÷ despesa total.
      // Participação de cada função na despesa; o índice constitucional fiel é o item 4.
      const df = await this.despesaFuncoes(entidadeId, ano)
      if (df.total > 0) {
        indicadores.push(
          aplicacaoFuncao(
            'Aplicação em Educação',
            df.educacao,
            df.total,
            'função 12 (Educação)',
            'Informativo (participação da função na despesa). O índice constitucional é o "Índice MDE" abaixo.',
          ),
        )
        indicadores.push(
          aplicacaoFuncao(
            'Aplicação em Saúde',
            df.saude,
            df.total,
            'função 10 (Saúde)',
            'Informativo (participação da função na despesa). O índice constitucional é o "Índice ASPS" abaixo.',
          ),
        )
      }

      // 4) Índices constitucionais FIÉIS (MDE 25% / ASPS 15%) — função × FONTE
      // real (QDD aplicado) ÷ impostos + transferências. Limites MÍNIMOS:
      // nivel "abaixo_minimo" quando não atende (semântica inversa do Pessoal).
      const compIndices = composicaoIndicesDoEstado(rcl.entidade.estado)
      const idx = await new IndiceConstitucionalService(this.prisma).calcular(entidadeId, ano, compIndices)
      if (idx.baseTotal > 0) {
        const indiceReal = (nome: string, r: ResultadoIndice, descBase: string, baseLegal: string): IndicadorGuardiao => ({
          indicador: nome,
          unidade: '% dos impostos',
          valor: r.total,
          base: idx.baseTotal,
          percentual: r.percentual,
          limite: r.minimo,
          prudencial: null,
          alerta: null,
          nivel: r.atende ? 'ok' : 'abaixo_minimo',
          memorial: {
            descricao: `${descBase} ÷ receita de impostos e transferências (${idx.metodologia}). Limite MÍNIMO de ${r.minimo}%. Base: dotação autorizada.`,
            baseLegal,
            linhas: [
              ...r.linhas.map((l) => ({ item: l.rotulo, valor: l.valor })),
              { item: '= Aplicação total', valor: r.total },
              ...idx.base.map((b) => ({ item: `Base: ${b.rotulo}`, valor: b.valor })),
              { item: '= Base de impostos', valor: idx.baseTotal },
            ],
          },
        })
        indicadores.push(
          indiceReal(
            'Índice MDE',
            idx.mde,
            'Despesa na função 12 financiada pelas fontes de impostos vinculados à educação e FUNDEB',
            'CF art. 212 (mínimo 25% dos impostos em manutenção e desenvolvimento do ensino).',
          ),
        )
        indicadores.push(
          indiceReal(
            'Índice ASPS',
            idx.asps,
            'Despesa na função 10 financiada pela fonte de recursos próprios da saúde',
            'CF art. 198 / LC 141 art. 7º (mínimo 15% dos impostos em ações e serviços públicos de saúde).',
          ),
        )
      }

      // 5) Dívida Consolidada Líquida (% da RCL, limite 120% — Res. Senado 40/2001).
      // Agora VIVA (RGF Anexo 2): DC do cadastro − deduções de caixa/RP. A DCL
      // informada na LDO fica no memorial como comparativo — o Δ mostra o que a
      // base ainda não captura (ex.: saldos bancários reais). Negativa = caixa
      // supera a dívida.
      if (rcl.rcl > 0) {
        const dcl = await new DclService(this.prisma).calcular(entidadeId, ano)
        const pct = r1((dcl.dcl / rcl.rcl) * 100)
        indicadores.push({
          indicador: ROTULO_META.DIVIDA_CONSOLIDADA_LIQUIDA,
          unidade: '% da RCL',
          valor: dcl.dcl,
          base: rcl.rcl,
          percentual: pct,
          limite: 120,
          prudencial: null,
          alerta: 108,
          nivel: nivelDe(pct, 120, 120, 108),
          memorial: {
            descricao:
              'DCL apurada ao vivo (RGF Anexo 2): dívida consolidada do cadastro − (disponibilidade de caixa − RP processados). A DCL informada na LDO aparece abaixo como comparativo. Negativa = caixa supera a dívida.',
            baseLegal: 'Resolução do Senado nº 40/2001 (limite de 120% da RCL para municípios); LRF art. 30; alerta LRF art. 59 §1º, III.',
            linhas: [
              { item: 'Dívida Consolidada (cadastro)', valor: dcl.dividaTotal },
              { item: '(−) Deduções (caixa − RP processados)', valor: dcl.deducoes.total },
              { item: 'DCL apurada', valor: dcl.dcl },
              ...(dcl.metaLdo != null ? [{ item: 'DCL informada na LDO (comparativo)', valor: dcl.metaLdo }] : []),
              { item: 'RCL', valor: rcl.rcl },
            ],
          },
        })

        // 6) Garantias concedidas (% da RCL, limite 22% — Res. Senado 43/2001 art. 9º).
        // 7) Operações de crédito sujeitas (16%) e ARO (7%) — Res. Senado 43/2001.
        const totais = await new RgfCadastrosService(this.prisma).totais(entidadeId, ano)
        const pctGar = r1((totais.garantias.total / rcl.rcl) * 100)
        indicadores.push({
          indicador: 'Garantias de valores',
          unidade: '% da RCL',
          valor: totais.garantias.total,
          base: rcl.rcl,
          percentual: pctGar,
          limite: 22,
          prudencial: null,
          alerta: 19.8,
          nivel: nivelDe(pctGar, 22, 22, 19.8),
          memorial: {
            descricao: 'Garantias concedidas (RGF Anexo 3, cadastro do RGF) ÷ RCL. Contragarantias recebidas no memorial do anexo.',
            baseLegal: 'Resolução do Senado nº 43/2001, art. 9º (22% da RCL); alerta LRF art. 59 §1º.',
            linhas: [
              { item: 'Garantias concedidas', valor: totais.garantias.total },
              { item: 'Contragarantias recebidas', valor: totais.garantias.contragarantias },
              { item: 'RCL', valor: rcl.rcl },
            ],
          },
        })
        const pctOp = r1((totais.operacoes.sujeitas / rcl.rcl) * 100)
        const pctAro = r1((totais.operacoes.aro / rcl.rcl) * 100)
        indicadores.push({
          indicador: 'Operações de crédito',
          unidade: '% da RCL',
          valor: totais.operacoes.sujeitas,
          base: rcl.rcl,
          percentual: pctOp,
          limite: 16,
          prudencial: null,
          alerta: 14.4,
          nivel: pctAro >= 7 ? 'estouro' : nivelDe(pctOp, 16, 16, 14.4),
          memorial: {
            descricao: 'Operações de crédito sujeitas ao limite (RGF Anexo 4, cadastro do RGF) ÷ RCL. A ARO tem limite próprio de 7% e contamina a situação quando estoura.',
            baseLegal: 'Resolução do Senado nº 43/2001 (16% da RCL; ARO 7%); alerta LRF art. 59 §1º.',
            linhas: [
              { item: 'Sujeitas ao limite (16%)', valor: totais.operacoes.sujeitas },
              { item: 'ARO (limite próprio 7%)', valor: totais.operacoes.aro },
              { item: 'Não sujeitas', valor: totais.operacoes.naoSujeitas },
              { item: 'RCL', valor: rcl.rcl },
            ],
          },
        })
      }
    }

    return { entidade: rcl.entidade, ano, metodologia: rcl.metodologia, temOrcamento: rcl.temOrcamento, indicadores }
  }

  /** Despesa autorizada total e por função (12 = Educação, 10 = Saúde). */
  private async despesaFuncoes(entidadeId: string, ano: number): Promise<{ total: number; educacao: number; saude: number }> {
    const orc = await this.prisma.orcamento.findUnique({
      where: { entidadeId_ano: { entidadeId, ano } },
      select: { id: true },
    })
    if (!orc) return { total: 0, educacao: 0, saude: 0 }
    const somaAutorizado = async (where: object) => {
      const agg = await this.prisma.dotacaoDespesa.aggregate({ where: { orcamentoId: orc.id, ...where }, _sum: { valorAutorizado: true } })
      return n(agg._sum.valorAutorizado ?? D0())
    }
    const [total, educacao, saude] = await Promise.all([
      somaAutorizado({}),
      somaAutorizado({ funcao: { codigo: '12' } }),
      somaAutorizado({ funcao: { codigo: '10' } }),
    ])
    return { total, educacao, saude }
  }

  /** Composição de Despesa com Pessoal efetiva do Estado da entidade (override do banco > default). */
  private async composicaoPessoal(entidadeId: string): Promise<ComposicaoPessoal> {
    const ent = await this.prisma.entidade.findUnique({
      where: { id: entidadeId },
      select: { municipio: { select: { estado: { select: { sigla: true, pessoalComposicao: true, modeloContabil: { select: { pessoalComposicao: true } } } } } } },
    })
    return resolverComposicaoPessoal(ent?.municipio?.estado?.sigla, ent?.municipio?.estado?.pessoalComposicao, ent?.municipio?.estado?.modeloContabil?.pessoalComposicao)
  }
}
