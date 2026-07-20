import { PrismaClient } from '@prisma/client'
import { CreditosAdicionaisService } from './creditos-adicionais.js'
import {
  centavosDecreto as cent,
  filtrarPendentes,
  montarMovimentosPorDecreto,
  montarRegistrosPorDotacao,
  ordenarItensDecreto,
  ordenarPorViabilidade,
  resolverDeltasPendentes,
  type ItemPortalDecreto,
} from './decretos-solver.js'
import type { ResultadoSincronizacao } from './sincronizacao-portal.js'

/**
 * Sincronização automática dos DECRETOS (créditos adicionais) com o portal —
 * fase 2 dos conectores. Usa o solver incremental (decretos-solver.ts): só os
 * PENDENTES entram na equação, contra o autorizado ATUAL do banco.
 *
 * Guards (qualquer um ⇒ DIVERGENTE, nada gravado — o script manual
 * scripts/importar_decretos_2026.ts cobre os casos recusados):
 *  - equação não fecha em alguma dotação (item de conciliação seria preciso);
 *  - itens sem número de decreto ("null/null") pendentes ficam FORA da
 *    equação — se o estado não fechar sem eles, cai no guard acima;
 *  - dotação movimentada no portal SEM pendência numerada cujo banco ≠ atual
 *    (drift — alguém editou fora da máquina, ou S/N novo não conciliado);
 *  - nenhuma ordem de lançamento viável (saldo ficaria negativo).
 *
 * Lança via CreditosAdicionaisService (nunca edita valorAutorizado na mão),
 * criando fontes/dotações-fonte que os decretos dotam. Log em
 * SincronizacaoPortal tipo DECRETOS. Idempotente por número do decreto.
 */

const BASE_MARINGA = process.env['PORTAL_MARINGA_URL'] ?? 'https://transparencia.maringa.pr.gov.br/portaltransparencia-api'
/** Rótulo dos itens sem número — nunca lançado pelo sync (exclusivo do script manual). */
const SN_MANUAL = 'S/N-SYNC-NUNCA-LANCA'

export class SincronizacaoDecretosService {
  private readonly base: string
  private readonly entidadePortal: string
  /**
   * `opts` torna o sync reusável por QUALQUER município Elotech (não só Maringá):
   * `portalUrl` = base da API do portal; `entidadePortal` = id da entidade no portal
   * (o `/api/creditosadicionais?entidade=`). Default = Maringá (Prefeitura, '1').
   */
  constructor(private prisma: PrismaClient, opts: { portalUrl?: string; entidadePortal?: string } = {}) {
    this.base = opts.portalUrl ?? BASE_MARINGA
    this.entidadePortal = opts.entidadePortal ?? '1'
  }

  private async getJson<T>(path: string): Promise<T> {
    for (let tentativa = 1; ; tentativa++) {
      try {
        const res = await fetch(`${this.base}${path}`)
        if (!res.ok) throw new Error(`HTTP ${res.status} em ${path}`)
        return (await res.json()) as T
      } catch (e) {
        if (tentativa >= 3) throw e
        await new Promise((r) => setTimeout(r, 1000 * tentativa))
      }
    }
  }

  async sincronizar(entidadeId: string, ano: number): Promise<ResultadoSincronizacao> {
    const registrar = async (r: ResultadoSincronizacao) => {
      await this.prisma.sincronizacaoPortal.create({
        data: { entidadeId, tipo: 'DECRETOS', ano, mes: new Date().getMonth() + 1, status: r.status, mensagem: r.mensagem, valorPortal: r.valorPortal, valorGravado: r.valorGravado },
      })
      return r
    }
    try {
      const orcamento = await this.prisma.orcamento.findUnique({ where: { entidadeId_ano: { entidadeId, ano } }, select: { id: true } })
      if (!orcamento) return registrar({ status: 'ERRO', mensagem: `Sem orçamento ${ano}.`, valorPortal: 0, valorGravado: 0 })

      const corpo = await this.getJson<{ content: ItemPortalDecreto[] }>(`/api/creditosadicionais?entidade=${this.entidadePortal}&exercicio=${ano}&size=5000`)
      const porDot = montarRegistrosPorDotacao(corpo.content, SN_MANUAL)
      const atualPorKf = new Map<string, number>()
      for (const [kf, regs] of porDot) atualPorKf.set(kf, regs[0]!.atual)

      // estado do banco: dotações por chave + decretos já lançados
      const dots = await this.prisma.dotacaoDespesa.findMany({
        where: { orcamentoId: orcamento.id },
        select: {
          id: true,
          valorAutorizado: true,
          unidadeOrcamentaria: { select: { codigo: true } },
          funcao: { select: { codigo: true } },
          subfuncao: { select: { codigo: true } },
          programa: { select: { codigo: true } },
          acao: { select: { codigo: true } },
          contaDespesa: { select: { codigo: true } },
          fonteRecurso: { select: { codigo: true } },
        },
      })
      const dotPorChave = new Map<string, { id: string; autorizado: number }>()
      for (const d of dots) {
        const a = d.acao.codigo
        const despesa = `${d.unidadeOrcamentaria.codigo}.${d.funcao.codigo}.${d.subfuncao.codigo}.${d.programa.codigo}.${a[0]}.${a.slice(1)}.${d.contaDespesa.codigo}`
        dotPorChave.set(`${despesa}|${d.fonteRecurso.codigo}`, { id: d.id, autorizado: cent(Number(d.valorAutorizado)) })
      }
      const jaLancados = new Set(
        (await this.prisma.creditoAdicional.findMany({ where: { orcamentoId: orcamento.id }, select: { numero: true } })).map((c) => c.numero),
      )
      filtrarPendentes(porDot, jaLancados)
      // itens sem número ficam fora da equação (exclusivos do script manual)
      for (const [kf, regs] of porDot) {
        const numerados = regs.filter((r) => r.dec !== SN_MANUAL)
        if (numerados.length) porDot.set(kf, numerados)
        else porDot.delete(kf)
      }

      // guard de drift: dotação movimentada no portal SEM pendência numerada
      // precisa já espelhar o portal (senão S/N novo ou edição fora da máquina)
      const drift: string[] = []
      for (const [kf, atual] of atualPorKf) {
        if (porDot.has(kf)) continue
        const banco = dotPorChave.get(kf)?.autorizado ?? 0
        if (banco !== atual) drift.push(kf)
      }
      if (drift.length) {
        return registrar({
          status: 'DIVERGENTE',
          mensagem: `${drift.length} dotação(ões) sem pendência numerada com banco ≠ portal (ex.: ${drift[0]}) — S/N novo ou drift; rodar o import manual.`,
          valorPortal: 0,
          valorGravado: 0,
        })
      }

      if (porDot.size === 0) {
        return registrar({ status: 'OK', mensagem: `Decretos em dia (${jaLancados.size} lançados; 0 pendentes).`, valorPortal: 0, valorGravado: 0 })
      }

      const baseAtual = (kf: string) => dotPorChave.get(kf)?.autorizado ?? 0
      const { ajustes } = resolverDeltasPendentes(porDot, baseAtual)
      if (ajustes.length) {
        return registrar({
          status: 'DIVERGENTE',
          mensagem: `${ajustes.length} dotação(ões) sem combinação exata do par ambíguo (precisariam de conciliação) — rodar o import manual.`,
          valorPortal: 0,
          valorGravado: 0,
        })
      }
      const movPorDecreto = montarMovimentosPorDecreto(porDot, [], SN_MANUAL)
      const pendentes = [...movPorDecreto.keys()].sort((a, b) => parseInt(a) - parseInt(b))
      const ordem = ordenarPorViabilidade(pendentes, movPorDecreto, baseAtual)
      if (!ordem) {
        return registrar({
          status: 'DIVERGENTE',
          mensagem: 'Nenhuma ordem de lançamento viável (anulação deixaria saldo negativo) — rodar o import manual.',
          valorPortal: 0,
          valorGravado: 0,
        })
      }

      // fontes/dotações-fonte que os decretos dotam (criadas com autorizado 0)
      const novasDot = [...porDot.keys()].filter((kf) => !dotPorChave.has(kf))
      const idPorKf = new Map([...dotPorChave].map(([kf, d]) => [kf, d.id]))
      if (novasDot.length) {
        const fontesDb = new Map(
          (await this.prisma.fonteRecursoEntidade.findMany({ where: { entidadeId, ano }, select: { id: true, codigo: true } })).map((f) => [f.codigo, f.id]),
        )
        const novasFontes = [...new Set(novasDot.map((kf) => kf.split('|')[1]!))].filter((f) => !fontesDb.has(f))
        if (novasFontes.length) {
          await this.prisma.fonteRecursoEntidade.createMany({
            data: novasFontes.map((codigo) => ({ entidadeId, ano, codigo, nomenclatura: `Fonte ${codigo} (via decreto)`, vinculada: true, origem: 'DESDOBRAMENTO' as const })),
          })
          for (const f of await this.prisma.fonteRecursoEntidade.findMany({ where: { entidadeId, ano, codigo: { in: novasFontes } } })) fontesDb.set(f.codigo, f.id)
        }
        const [uosDb, funcoesDb, subfDb, progsDb, acoesDb, contasDb] = await Promise.all([
          this.prisma.unidadeOrcamentaria.findMany({ where: { entidadeId }, select: { id: true, codigo: true } }),
          this.prisma.funcao.findMany({ select: { id: true, codigo: true } }),
          this.prisma.subfuncao.findMany({ select: { id: true, codigo: true } }),
          this.prisma.programa.findMany({ where: { entidadeId, ano }, select: { id: true, codigo: true } }),
          this.prisma.acao.findMany({ where: { programa: { entidadeId, ano } }, select: { id: true, codigo: true, programa: { select: { codigo: true } } } }),
          this.prisma.contaDespesaEntidade.findMany({ where: { entidadeId, ano }, select: { id: true, codigo: true } }),
        ])
        const uoId = new Map(uosDb.map((x) => [x.codigo, x.id]))
        const funcaoId = new Map(funcoesDb.map((x) => [x.codigo, x.id]))
        const subfId = new Map(subfDb.map((x) => [x.codigo, x.id]))
        const progId = new Map(progsDb.map((x) => [x.codigo, x.id]))
        const acaoId = new Map(acoesDb.map((a) => [`${a.programa.codigo}|${a.codigo}`, a.id]))
        const contaId = new Map(contasDb.map((x) => [x.codigo, x.id]))
        for (const kf of novasDot) {
          const { dims, fonte } = porDot.get(kf)![0]!
          const ids = {
            unidadeOrcamentariaId: uoId.get(dims.uo),
            funcaoId: funcaoId.get(dims.funcao),
            subfuncaoId: subfId.get(dims.subfuncao),
            programaId: progId.get(dims.programa),
            acaoId: acaoId.get(`${dims.programa}|${dims.acao}`),
            contaDespesaEntidadeId: contaId.get(dims.conta),
            fonteRecursoEntidadeId: fontesDb.get(fonte),
          }
          const falta = Object.entries(ids).find(([, v]) => !v)
          if (falta) {
            return registrar({
              status: 'DIVERGENTE',
              mensagem: `Dotação nova ${kf} exige dimensão inexistente (${falta[0]}) — rodar o import manual.`,
              valorPortal: 0,
              valorGravado: 0,
            })
          }
          const nova = await this.prisma.dotacaoDespesa.create({
            data: { orcamentoId: orcamento.id, ...(ids as Record<string, string>), esfera: 'FISCAL', valorAutorizado: 0 },
            select: { id: true },
          })
          idPorKf.set(kf, nova.id)
        }
      }

      // lançamento sequencial (idempotente por número; retomada segura)
      const svc = new CreditosAdicionaisService(this.prisma)
      const hoje = new Date().toISOString().slice(0, 10)
      let somaDeltas = 0
      for (const dec of ordem) {
        const itens = ordenarItensDecreto(movPorDecreto.get(dec)!).map((m) => {
          somaDeltas += (m.operacao === 'REFORCO' ? 1 : -1) * m.valor
          return { dotacaoId: idPorKf.get(m.kf)!, operacao: m.operacao, valor: (m.valor / 100).toFixed(2) }
        })
        await svc.criar(orcamento.id, {
          tipo: 'SUPLEMENTAR',
          numero: dec,
          data: hoje,
          atoLegal: `Decreto nº ${dec}`,
          justificativa: `Sincronizado da API do Portal da Transparência em ${hoje}; a data oficial não é publicada pela API — ordem oficial pelo número do decreto.`,
          itens,
        })
      }

      // verificação final: cada dotação movimentada espelha o portal
      const depois = await this.prisma.dotacaoDespesa.findMany({
        where: { id: { in: [...idPorKf.entries()].filter(([kf]) => atualPorKf.has(kf)).map(([, id]) => id) } },
        select: { id: true, valorAutorizado: true },
      })
      const autorizadoPorId = new Map(depois.map((d) => [d.id, cent(Number(d.valorAutorizado))]))
      let divergentes = 0
      for (const [kf, atual] of atualPorKf) {
        const id = idPorKf.get(kf)
        if (id && autorizadoPorId.has(id) && autorizadoPorId.get(id) !== atual) divergentes++
      }
      const somaPortal = [...atualPorKf.values()].reduce((s, v) => s + v, 0) / 100
      if (divergentes) {
        return registrar({
          status: 'DIVERGENTE',
          mensagem: `${ordem.length} decretos lançados, mas ${divergentes} dotação(ões) não espelham o portal na verificação final — investigar.`,
          valorPortal: somaPortal,
          valorGravado: somaDeltas / 100,
        })
      }
      // os NÚMEROS lançados ficam no log — é o histórico que o usuário confere
      const lista = ordem.length > 15 ? `${ordem.slice(0, 15).join(', ')} … (+${ordem.length - 15})` : ordem.join(', ')
      return registrar({
        status: 'OK',
        mensagem: `${ordem.length} decreto(s) lançado(s): ${lista} (Σ deltas R$ ${(somaDeltas / 100).toFixed(2)}); banco espelha o portal.`,
        valorPortal: somaPortal,
        valorGravado: somaDeltas / 100,
      })
    } catch (e) {
      return registrar({ status: 'ERRO', mensagem: e instanceof Error ? e.message : String(e), valorPortal: 0, valorGravado: 0 })
    }
  }
}
