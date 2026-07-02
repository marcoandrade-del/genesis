import type { PrismaClient } from '@prisma/client'
import { ContasBancariasService } from './contas-bancarias.js'

/**
 * RGF Anexo 5 — Demonstrativo da Disponibilidade de Caixa e dos Restos a Pagar,
 * por FONTE de recurso (LRF art. 55, III):
 *
 *   disponibilidade líquida = caixa bruta − obrigações (restos a pagar)
 *   - Caixa bruta: saldo acumulado (CRÉDITO−DÉBITO) das contas bancárias da
 *     fonte até o fim do exercício (`ContaBancaria.fonteCodigo`).
 *   - RP processados: liquidado − pago (obrigação líquida e certa).
 *   - RP não processados: empenhado − liquidado.
 *     Ambos do razão `MovimentoEmpenho`, com a fonte REAL da dotação (QDD).
 *
 * Aproximação de LOA em andamento: sem execução da despesa lançada os RP são
 * zero e o demonstrativo mostra só o caixa por fonte — honesto, e passa a
 * refletir a execução automaticamente quando os empenhos entrarem.
 * Ver [[lrf-despesa-epico-plano]].
 */

const r2 = (n: number) => Math.round(n * 100) / 100

export interface LinhaDisponibilidade {
  fonte: string
  nomenclatura: string
  caixa: number
  rpProcessados: number
  rpNaoProcessados: number
  disponibilidade: number // caixa − RP
}
export interface ResultadoDisponibilidade {
  temDados: boolean
  linhas: LinhaDisponibilidade[]
  totais: { caixa: number; rpProcessados: number; rpNaoProcessados: number; disponibilidade: number }
}

export class DisponibilidadeFonteService {
  constructor(private prisma: PrismaClient) {}

  async calcular(entidadeId: string, ano: number): Promise<ResultadoDisponibilidade> {
    const corte = new Date(Date.UTC(ano, 11, 31))

    // caixa por fonte: saldo acumulado de cada conta bancária até o corte
    const contas = await new ContasBancariasService(this.prisma).listar(entidadeId, ano)
    const porFonte = new Map<string, LinhaDisponibilidade>()
    const linha = (fonte: string, nomenclatura?: string | null): LinhaDisponibilidade => {
      let l = porFonte.get(fonte)
      if (!l) {
        l = { fonte, nomenclatura: nomenclatura ?? '', caixa: 0, rpProcessados: 0, rpNaoProcessados: 0, disponibilidade: 0 }
        porFonte.set(fonte, l)
      }
      if (nomenclatura && !l.nomenclatura) l.nomenclatura = nomenclatura
      return l
    }

    for (const c of contas) {
      const agg = await this.prisma.movimentoBancario.groupBy({
        by: ['sentido'],
        where: { contaBancariaId: c.id, data: { lte: corte } },
        _sum: { valor: true },
      })
      let saldo = 0
      for (const a of agg) saldo += (a.sentido === 'CREDITO' ? 1 : -1) * Number(a._sum.valor ?? 0)
      if (saldo !== 0) linha(c.fonteCodigo, c.fonteNomenclatura).caixa += saldo
    }

    // restos a pagar por fonte: razão do empenho × fonte real da dotação
    const movimentos = await this.prisma.movimentoEmpenho.findMany({
      where: { entidadeId, data: { lte: corte } },
      select: {
        tipo: true,
        valor: true,
        empenho: { select: { dotacaoDespesa: { select: { fonteRecurso: { select: { codigo: true, nomenclatura: true } } } } } },
      },
    })
    const sinais: Record<string, [keyof Pick<LinhaDisponibilidade, 'rpProcessados' | 'rpNaoProcessados'>, number][]> = {
      // empenhado entra em não-processados; a liquidação migra o valor para processados; o pagamento baixa.
      EMPENHO: [['rpNaoProcessados', 1]],
      ESTORNO_EMPENHO: [['rpNaoProcessados', -1]],
      LIQUIDACAO: [['rpNaoProcessados', -1], ['rpProcessados', 1]],
      ESTORNO_LIQUIDACAO: [['rpNaoProcessados', 1], ['rpProcessados', -1]],
      PAGAMENTO: [['rpProcessados', -1]],
      ESTORNO_PAGAMENTO: [['rpProcessados', 1]],
    }
    for (const m of movimentos) {
      const f = m.empenho.dotacaoDespesa.fonteRecurso
      const l = linha(f.codigo, f.nomenclatura)
      for (const [campo, sinal] of sinais[m.tipo] ?? []) l[campo] += sinal * Number(m.valor)
    }

    const linhas = [...porFonte.values()]
      .map((l) => ({
        ...l,
        caixa: r2(l.caixa),
        rpProcessados: r2(l.rpProcessados),
        rpNaoProcessados: r2(l.rpNaoProcessados),
        disponibilidade: r2(l.caixa - l.rpProcessados - l.rpNaoProcessados),
      }))
      .filter((l) => l.caixa !== 0 || l.rpProcessados !== 0 || l.rpNaoProcessados !== 0)
      .sort((a, b) => a.fonte.localeCompare(b.fonte))

    const soma = (campo: 'caixa' | 'rpProcessados' | 'rpNaoProcessados' | 'disponibilidade') =>
      r2(linhas.reduce((s, l) => s + l[campo], 0))
    return {
      temDados: linhas.length > 0,
      linhas,
      totais: {
        caixa: soma('caixa'),
        rpProcessados: soma('rpProcessados'),
        rpNaoProcessados: soma('rpNaoProcessados'),
        disponibilidade: soma('disponibilidade'),
      },
    }
  }
}
