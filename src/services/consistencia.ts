import { PrismaClient, Prisma } from '@prisma/client'
import { DespesaPessoalService, resolverComposicaoPessoal } from './despesa-pessoal.js'
import { DclService } from './dcl.js'
import { RgfSimplificadoService } from './rgf-simplificado.js'
import { quadrimestreCorrente } from './quadrimestre.js'

/**
 * SELO DE CONSISTÊNCIA — bateria de identidades contábeis verificadas por
 * máquina sobre a base da entidade/exercício. É a versão-feature da auditoria
 * manual de 2026-07-07 (Maringá): cada verificação cruza DOIS CAMINHOS
 * INDEPENDENTES até o mesmo número; divergência vira status DIVERGENTE com o
 * Δ exposto — nunca escondido. O OXY exibe o selo ("N de M verificações")
 * antes de qualquer análise de IA. Regra do resíduo: Δ explicado é Δ somado.
 */

export type StatusVerificacao = 'OK' | 'DIVERGENTE' | 'NAO_APLICAVEL'

export interface Verificacao {
  codigo: string
  titulo: string
  status: StatusVerificacao
  esperado: number | null
  obtido: number | null
  delta: number | null
  detalhe: string
}

export interface ResultadoConsistencia {
  verificacoes: Verificacao[]
  selo: { aprovadas: number; avaliadas: number; total: number }
}

const n = (d: Prisma.Decimal | number | null | undefined) => (d == null ? 0 : Number(d))
const r2 = (x: number) => Math.round(x * 100) / 100
const TOLERANCIA = 0.01 // centavo

export class ConsistenciaService {
  constructor(private prisma: PrismaClient) {}

  async verificar(entidadeId: string, ano: number): Promise<ResultadoConsistencia> {
    const ini = new Date(Date.UTC(ano, 0, 1))
    const fim = new Date(Date.UTC(ano, 12, 0))
    const orcamento = await this.prisma.orcamento.findUnique({ where: { entidadeId_ano: { entidadeId, ano } }, select: { id: true } })

    const verificacoes: Verificacao[] = []
    const compara = (codigo: string, titulo: string, esperado: number, obtido: number, detalhe: string): Verificacao => {
      const delta = r2(obtido - esperado)
      return { codigo, titulo, status: Math.abs(delta) <= TOLERANCIA ? 'OK' : 'DIVERGENTE', esperado: r2(esperado), obtido: r2(obtido), delta, detalhe }
    }
    const na = (codigo: string, titulo: string, detalhe: string): Verificacao => ({ codigo, titulo, status: 'NAO_APLICAVEL', esperado: null, obtido: null, delta: null, detalhe })

    if (!orcamento) {
      return { verificacoes: [na('SEM_ORCAMENTO', 'Orçamento do exercício', 'Entidade sem orçamento no exercício — nada a verificar.')], selo: { aprovadas: 0, avaliadas: 0, total: 1 } }
    }

    // V1 — Arrecadação: razão (movimentos) × materializado (previsões)
    {
      const [movs, mat] = await Promise.all([
        this.prisma.arrecadacao.findMany({
          where: { previsao: { orcamentoId: orcamento.id }, data: { gte: ini, lte: fim } },
          select: { tipo: true, valor: true },
        }),
        this.prisma.previsaoReceita.aggregate({ where: { orcamentoId: orcamento.id }, _sum: { valorArrecadado: true } }),
      ])
      const razao = r2(movs.reduce((a, m) => a + (m.tipo === 'ESTORNO' ? -1 : 1) * n(m.valor), 0))
      verificacoes.push(compara('V1_ARRECADACAO', 'Arrecadação: movimentos × materializado',
        razao, r2(n(mat._sum.valorArrecadado)),
        'Σ arrecadações − estornos (razão) deve igualar o Σ de PrevisaoReceita.valorArrecadado (campo materializado).'))
    }

    // V2 — Empenhado: razão (MovimentoEmpenho) × ficha (Empenho.valor)
    // V3 — Liquidado: razão × ficha (Empenho.valorLiquidado)
    {
      const [movs, fichas] = await Promise.all([
        this.prisma.movimentoEmpenho.findMany({
          where: { entidadeId, data: { gte: ini, lte: fim } },
          select: { tipo: true, valor: true },
        }),
        this.prisma.empenho.aggregate({
          where: { entidadeId, data: { gte: ini, lte: new Date(Date.UTC(ano, 11, 31, 23, 59, 59)) }, status: 'ATIVO' },
          _sum: { valor: true, valorLiquidado: true },
        }),
      ])
      const sinais: Record<string, number> = { EMPENHO: 1, ESTORNO_EMPENHO: -1 }
      const sinaisLiq: Record<string, number> = { LIQUIDACAO: 1, ESTORNO_LIQUIDACAO: -1 }
      const razaoEmp = r2(movs.reduce((a, m) => a + (sinais[m.tipo] ?? 0) * n(m.valor), 0))
      const razaoLiq = r2(movs.reduce((a, m) => a + (sinaisLiq[m.tipo] ?? 0) * n(m.valor), 0))
      verificacoes.push(compara('V2_EMPENHADO', 'Empenhado: razão × ficha',
        razaoEmp, r2(n(fichas._sum.valor)),
        'Σ EMPENHO − ESTORNO_EMPENHO (razão) deve igualar o Σ Empenho.valor das fichas ativas do exercício.'))
      verificacoes.push(compara('V3_LIQUIDADO', 'Liquidado: razão × ficha',
        razaoLiq, r2(n(fichas._sum.valorLiquidado)),
        'Σ LIQUIDACAO − ESTORNO_LIQUIDACAO (razão) deve igualar o Σ Empenho.valorLiquidado das fichas ativas.'))
    }

    // V4 — Empenhado: ficha × dotação (materializado)
    {
      const [fichas, dot] = await Promise.all([
        this.prisma.empenho.aggregate({
          where: { entidadeId, data: { gte: ini, lte: new Date(Date.UTC(ano, 11, 31, 23, 59, 59)) }, status: 'ATIVO' },
          _sum: { valor: true },
        }),
        this.prisma.dotacaoDespesa.aggregate({ where: { orcamentoId: orcamento.id }, _sum: { valorEmpenhado: true } }),
      ])
      verificacoes.push(compara('V4_EMPENHADO_DOTACAO', 'Empenhado: ficha × dotação',
        r2(n(fichas._sum.valor)), r2(n(dot._sum.valorEmpenhado)),
        'Σ Empenho.valor deve igualar o Σ DotacaoDespesa.valorEmpenhado (saldo materializado por dotação).'))
    }

    // V5 — Equilíbrio da LOA do MUNICÍPIO + créditos: a identidade da Lei
    // 4.320 vale no ORÇAMENTO (Σ das entidades do ente), não em cada entidade
    // isolada — a LOA oficial de Maringá mostra a Prefeitura sozinha
    // desequilibrada (receita 3.170,2mi × QDD 2.842,7mi) e o TOTAL fechado
    // (3.582,0 = 3.582,0, INCLUINDO as intra: o equilíbrio legal é bruto).
    {
      const ent = await this.prisma.entidade.findUnique({ where: { id: entidadeId }, select: { municipioId: true } })
      const orcs = ent?.municipioId
        ? await this.prisma.orcamento.findMany({
            where: { ano, entidade: { is: { municipioId: ent.municipioId, ativo: true } } },
            select: { id: true },
          })
        : [{ id: orcamento.id }]
      const ids = orcs.map((o) => o.id)
      const [dot, rec, itens] = await Promise.all([
        this.prisma.dotacaoDespesa.aggregate({ where: { orcamentoId: { in: ids } }, _sum: { valorAutorizado: true } }),
        this.prisma.previsaoReceita.aggregate({ where: { orcamentoId: { in: ids } }, _sum: { valorPrevisto: true } }),
        this.prisma.creditoAdicionalItem.findMany({
          where: { credito: { orcamentoId: { in: ids } } },
          select: { operacao: true, valor: true },
        }),
      ])
      const creditosLiquidos = r2(itens.reduce((a, i) => a + (i.operacao === 'REFORCO' ? 1 : -1) * n(i.valor), 0))
      verificacoes.push(compara('V5_EQUILIBRIO_CREDITOS', 'Equilíbrio da LOA do município + créditos adicionais',
        r2(n(rec._sum.valorPrevisto)), r2(n(dot._sum.valorAutorizado) - creditosLiquidos),
        `Σ despesa autorizada das ${ids.length} entidade(s) do município (${r2(n(dot._sum.valorAutorizado)).toLocaleString('pt-BR')}) − créditos líquidos (${creditosLiquidos.toLocaleString('pt-BR')}) deve voltar à despesa inicial da LOA = receita prevista total (equilíbrio, Lei 4.320 art. 3º — identidade do orçamento do ente, não de cada entidade).`))
    }

    // V6 — Nenhuma dotação estourada (empenhado + reservado ≤ autorizado)
    {
      const dotacoes = await this.prisma.dotacaoDespesa.findMany({
        where: { orcamentoId: orcamento.id },
        select: { valorAutorizado: true, valorEmpenhado: true, valorReservado: true },
      })
      const estouradas = dotacoes.filter((d) => n(d.valorEmpenhado) + n(d.valorReservado) > n(d.valorAutorizado) + TOLERANCIA)
      verificacoes.push({
        codigo: 'V6_SEM_ESTOURO', titulo: 'Nenhuma dotação estourada',
        status: estouradas.length === 0 ? 'OK' : 'DIVERGENTE',
        esperado: 0, obtido: estouradas.length, delta: estouradas.length,
        detalhe: estouradas.length === 0
          ? `${dotacoes.length} dotações verificadas: empenhado + reservado ≤ autorizado em todas.`
          : `${estouradas.length} dotação(ões) com empenhado + reservado acima do autorizado — execução sem cobertura (LRF art. 15).`,
      })
    }

    // V7 — Anexo 6 (Simplificado) × anexos-fonte: DTP e DCL pelos dois caminhos
    {
      const ent = await this.prisma.entidade.findUnique({
        where: { id: entidadeId },
        select: { municipio: { select: { estado: { select: { sigla: true, pessoalComposicao: true, modeloContabil: { select: { pessoalComposicao: true } } } } } } },
      })
      const estado = ent?.municipio?.estado
      const q = quadrimestreCorrente(ano, new Date())
      const [simples, dtp, dcl] = await Promise.all([
        new RgfSimplificadoService(this.prisma).calcular(entidadeId, ano, q),
        new DespesaPessoalService(this.prisma).calcularExecutado(entidadeId, ano, resolverComposicaoPessoal(estado?.sigla, estado?.pessoalComposicao, estado?.modeloContabil?.pessoalComposicao), new Date(Date.UTC(ano, q * 4, 0))),
        new DclService(this.prisma).calcular(entidadeId, ano),
      ])
      const dtpSimples = simples.linhas.find((l) => l.rotulo.includes('Pessoal'))?.valor ?? 0
      const dclSimples = simples.linhas.find((l) => l.rotulo.includes('DCL'))?.valor ?? 0
      const deltaDtp = r2(dtpSimples - dtp.dtp)
      const deltaDcl = r2(dclSimples - dcl.dcl)
      const ok = Math.abs(deltaDtp) <= TOLERANCIA && Math.abs(deltaDcl) <= TOLERANCIA
      verificacoes.push({
        codigo: 'V7_ANEXO6_FONTES', titulo: 'RGF Anexo 6 × anexos-fonte',
        status: ok ? 'OK' : 'DIVERGENTE',
        esperado: r2(dtp.dtp), obtido: r2(dtpSimples), delta: ok ? 0 : r2(Math.abs(deltaDtp) + Math.abs(deltaDcl)),
        detalhe: ok
          ? 'DTP e DCL idênticos entre o Demonstrativo Simplificado e os Anexos 1/2 (composição sem recálculo).'
          : `Δ DTP ${deltaDtp.toLocaleString('pt-BR')} · Δ DCL ${deltaDcl.toLocaleString('pt-BR')} entre o Simplificado e os anexos-fonte.`,
      })
    }

    // V8 — Sincronização com o portal: últimas execuções sem divergência
    {
      const ultimas = await this.prisma.sincronizacaoPortal.findMany({
        where: { entidadeId, ano, tipo: { in: ['ARRECADACAO', 'DESPESA_EXECUCAO'] } },
        orderBy: { criadoEm: 'desc' },
        take: 10,
        select: { tipo: true, status: true, criadoEm: true },
      })
      if (ultimas.length === 0) {
        verificacoes.push(na('V8_SINCRONIZACAO', 'Sincronização com o portal', 'Sem execuções de sincronização registradas no exercício.'))
      } else {
        const ultimaPorTipo = new Map<string, { status: string; criadoEm: Date }>()
        for (const u of ultimas) if (!ultimaPorTipo.has(u.tipo)) ultimaPorTipo.set(u.tipo, u)
        const problemas = [...ultimaPorTipo.entries()].filter(([, u]) => u.status !== 'OK')
        const carimbo = [...ultimaPorTipo.entries()].map(([t, u]) => `${t}: ${u.status} em ${u.criadoEm.toLocaleDateString('pt-BR')}`).join(' · ')
        verificacoes.push({
          codigo: 'V8_SINCRONIZACAO', titulo: 'Sincronização com o portal',
          status: problemas.length === 0 ? 'OK' : 'DIVERGENTE',
          esperado: 0, obtido: problemas.length, delta: problemas.length,
          detalhe: `Última execução por tipo — ${carimbo}. Divergência >0,5% contra o painel oficial não grava e fica registrada.`,
        })
      }
    }

    const avaliadas = verificacoes.filter((v) => v.status !== 'NAO_APLICAVEL').length
    const aprovadas = verificacoes.filter((v) => v.status === 'OK').length
    return { verificacoes, selo: { aprovadas, avaliadas, total: verificacoes.length } }
  }
}
