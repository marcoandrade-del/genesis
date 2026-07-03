import { PrismaClient } from '@prisma/client'

/**
 * Sincronização automática com o Portal da Transparência (Elotech/OXY) —
 * nível 2 do plano de conectores (decisão do Marco, 2026-07-03).
 *
 * v1: ARRECADAÇÃO do mês (natureza×fonte, valor bruto) — a mesma captura do
 * script manual (importar_arrecadacao_portal_2026.ts, que segue como
 * backfill). A DESPESA seguirá o MESMO esquema (sempre DEPOIS da receita do
 * ciclo — regra de ordem); decretos-sync é a fase 2.
 *
 * Princípios (ver memória alteracoes-orcamentarias-dinamica):
 *  - grava EXECUÇÃO CAPTURADA (painéis/indicadores) — nunca escrituração
 *    contábil automática;
 *  - VALIDA contra o dashboard do portal ANTES de gravar: divergência acima
 *    da tolerância ⇒ registra log DIVERGENTE e NÃO grava;
 *  - toda execução (OK, DIVERGENTE ou ERRO) fica no log `SincronizacaoPortal`;
 *  - idempotente por mês (substitui os movimentos do próprio mês — permite
 *    re-sincronizar o mês corrente diariamente, parcial e crescente).
 */

const BASE = process.env['PORTAL_MARINGA_URL'] ?? 'https://transparencia.maringa.pr.gov.br/portaltransparencia-api'
const ENTIDADE_PORTAL = '1'
/** Divergência máxima tolerada entre a soma capturada e o dashboard (0,5%). */
const TOLERANCIA = 0.005

// mesmos agrupamentos de código do plano de receita (12 grupos)
const GRUPOS = [1, 1, 1, 1, 2, 1, 1, 2, 2, 2, 2, 2]
function agruparDigitos(raw: string): string {
  const partes: string[] = []
  let i = 0
  for (const g of GRUPOS) {
    if (i >= raw.length) break
    partes.push(raw.slice(i, i + g))
    i += g
  }
  return partes.join('.')
}
function pad12(codigo: string): string {
  const partes = codigo.replace(/\.+$/, '').split('.')
  for (let i = partes.length; i < 12; i++) partes.push('0'.repeat(GRUPOS[i]!))
  return partes.join('.')
}
const c2 = (n: number) => Math.round(n * 100) / 100

type LinhaPortal = { receita: string; valorArrecadado: number }
type DashboardMes = { mes: number; valorArrecadado: number }

export interface ResultadoSincronizacao {
  status: 'OK' | 'DIVERGENTE' | 'ERRO'
  mensagem: string
  valorPortal: number
  valorGravado: number
}

export class SincronizacaoPortalService {
  constructor(private prisma: PrismaClient) {}

  private async getJson<T>(path: string, headers: Record<string, string> = {}): Promise<T> {
    for (let tentativa = 1; ; tentativa++) {
      try {
        const res = await fetch(`${BASE}${path}`, { headers })
        if (!res.ok) throw new Error(`HTTP ${res.status} em ${path}`)
        return (await res.json()) as T
      } catch (e) {
        if (tentativa >= 3) throw e
        await new Promise((r) => setTimeout(r, 1000 * tentativa))
      }
    }
  }

  /** Sincroniza a arrecadação de um mês; retorna o resultado já logado. */
  async arrecadacaoMes(entidadeId: string, ano: number, mes: number): Promise<ResultadoSincronizacao> {
    const registrar = async (r: ResultadoSincronizacao) => {
      await this.prisma.sincronizacaoPortal.create({
        data: {
          entidadeId,
          tipo: 'ARRECADACAO',
          ano,
          mes,
          status: r.status,
          mensagem: r.mensagem,
          valorPortal: r.valorPortal,
          valorGravado: r.valorGravado,
        },
      })
      return r
    }

    try {
      const orcamento = await this.prisma.orcamento.findUnique({ where: { entidadeId_ano: { entidadeId, ano } }, select: { id: true } })
      if (!orcamento) return registrar({ status: 'ERRO', mensagem: `Sem orçamento ${ano}.`, valorPortal: 0, valorGravado: 0 })

      const previsoes = await this.prisma.previsaoReceita.findMany({
        where: { orcamentoId: orcamento.id },
        select: { id: true, contaReceita: { select: { codigo: true } }, fonteRecurso: { select: { codigo: true } } },
      })
      const previsaoDe = new Map<string, string>()
      for (const p of previsoes) previsaoDe.set(`${pad12(p.contaReceita.codigo)}|${p.fonteRecurso.codigo}`, p.id)

      // captura: fontes → naturezas do período (só folhas do retorno)
      const ultimoDia = new Date(Date.UTC(ano, mes, 0)).getUTCDate()
      const dataIni = `${ano}-${String(mes).padStart(2, '0')}-01`
      const dataFim = `${ano}-${String(mes).padStart(2, '0')}-${String(ultimoDia).padStart(2, '0')}`
      const fontes = await this.getJson<{ receita: string }[]>(`/api/receitas/fonte-recursos?entidade=${ENTIDADE_PORTAL}&exercicio=${ano}`)

      const movs: { previsaoId: string; valor: number }[] = []
      let totalBruto = 0
      let semPrevisao = 0
      for (const f of fontes) {
        const linhas = await this.getJson<LinhaPortal[]>(
          `/api/receitas/fonte-recursos/detalhes?entidade=${ENTIDADE_PORTAL}&exercicio=${ano}&fonteRecurso=${f.receita}&dataInicial=${dataIni}&dataFinal=${dataFim}`,
        )
        const codigos = linhas.map((l) => l.receita.replace(/\./g, ''))
        for (let i = 0; i < linhas.length; i++) {
          const l = linhas[i]!
          if (!l.valorArrecadado) continue
          const raw = codigos[i]!
          const ehFolha = !codigos.some((cod, j) => j !== i && cod.startsWith(raw) && cod.length > raw.length)
          if (!ehFolha) continue
          const bruto = c2(l.valorArrecadado)
          totalBruto = c2(totalBruto + bruto)
          const pid = previsaoDe.get(`${pad12(agruparDigitos(raw))}|${f.receita}`)
          if (!pid) {
            semPrevisao = c2(semPrevisao + bruto)
            continue
          }
          movs.push({ previsaoId: pid, valor: bruto })
        }
      }
      const atribuido = c2(movs.reduce((s, m) => s + m.valor, 0))

      // validação ANTES de gravar: dashboard do portal (header `entidade`)
      const dash = await this.getJson<DashboardMes[]>(`/api/dashboard/arrecadacao-despesa?exercicio=${ano}`, { entidade: ENTIDADE_PORTAL, exercicio: String(ano) })
      const doMes = dash.find((m) => m.mes === mes)?.valorArrecadado ?? 0
      const divergencia = doMes > 0 ? Math.abs(totalBruto - doMes) / doMes : totalBruto > 0 ? 1 : 0
      if (divergencia > TOLERANCIA) {
        return registrar({
          status: 'DIVERGENTE',
          mensagem: `Captura R$ ${totalBruto.toFixed(2)} × dashboard R$ ${doMes.toFixed(2)} (${(divergencia * 100).toFixed(2)}%) — nada gravado.`,
          valorPortal: doMes,
          valorGravado: 0,
        })
      }

      // grava (idempotente por histórico mensal) + rematerializa
      const historico = `Importação execução portal (arrecadada ${String(mes).padStart(2, '0')}/${ano})`
      const dataMov = new Date(Date.UTC(ano, mes, 0))
      const previsaoIds = previsoes.map((p) => p.id)
      await this.prisma.$transaction(async (tx) => {
        await tx.arrecadacao.deleteMany({ where: { previsaoId: { in: previsaoIds }, historico } })
        await tx.arrecadacao.createMany({
          data: movs.map((m) => ({ previsaoId: m.previsaoId, tipo: 'ARRECADACAO' as const, data: dataMov, valor: m.valor, historico })),
        })
        for (const pid of previsaoIds) {
          const ag = await tx.arrecadacao.groupBy({ by: ['tipo'], where: { previsaoId: pid }, _sum: { valor: true } })
          let total = 0
          for (const g of ag) total += (g.tipo === 'ESTORNO' ? -1 : 1) * Number(g._sum.valor ?? 0)
          await tx.previsaoReceita.update({ where: { id: pid }, data: { valorArrecadado: c2(total) } })
        }
      })
      return registrar({
        status: 'OK',
        mensagem: `${movs.length} movimentos; sem previsão R$ ${semPrevisao.toFixed(2)} (${totalBruto ? ((100 * atribuido) / totalBruto).toFixed(2) : '0'}% cobertura).`,
        valorPortal: doMes,
        valorGravado: atribuido,
      })
    } catch (e) {
      return registrar({
        status: 'ERRO',
        mensagem: e instanceof Error ? e.message : String(e),
        valorPortal: 0,
        valorGravado: 0,
      })
    }
  }
}

/**
 * Agendador: roda a sincronização diariamente de madrugada (mês corrente;
 * até o dia 3, também garante o mês anterior). Ativado por env
 * SINCRONIZAR_PORTAL_MARINGA=1 — desligado em testes/CI por padrão.
 */
export function agendarSincronizacaoPortal(prisma: PrismaClient, log: (msg: string) => void = console.log): NodeJS.Timeout | null {
  if (process.env['SINCRONIZAR_PORTAL_MARINGA'] !== '1') return null
  const HORA = 4 // 04:00 local
  const svc = new SincronizacaoPortalService(prisma)

  const rodar = async () => {
    try {
      const ent = await prisma.entidade.findFirst({
        where: { tipo: 'PREFEITURA', municipio: { is: { nome: { contains: 'Maring', mode: 'insensitive' }, estado: { is: { sigla: 'PR' } } } } },
        select: { id: true },
      })
      if (!ent) return log('[sync-portal] entidade de Maringá não encontrada — pulei.')
      const agora = new Date()
      const ano = agora.getFullYear()
      const mes = agora.getMonth() + 1
      const r1 = await svc.arrecadacaoMes(ent.id, ano, mes)
      log(`[sync-portal] arrecadação ${mes}/${ano}: ${r1.status} — ${r1.mensagem}`)
      if (agora.getDate() <= 3) {
        const mAnt = mes === 1 ? 12 : mes - 1
        const aAnt = mes === 1 ? ano - 1 : ano
        const r2 = await svc.arrecadacaoMes(ent.id, aAnt, mAnt)
        log(`[sync-portal] arrecadação ${mAnt}/${aAnt} (fechamento): ${r2.status} — ${r2.mensagem}`)
      }
    } catch (e) {
      log(`[sync-portal] falha: ${e instanceof Error ? e.message : e}`)
    }
  }

  const proxima = () => {
    const agora = new Date()
    const alvo = new Date(agora)
    alvo.setHours(HORA, 0, 0, 0)
    if (alvo <= agora) alvo.setDate(alvo.getDate() + 1)
    return alvo.getTime() - agora.getTime()
  }
  let timer: NodeJS.Timeout
  const agendar = () => {
    timer = setTimeout(async () => {
      await rodar()
      agendar()
    }, proxima())
    timer.unref?.()
  }
  agendar()
  log(`[sync-portal] agendado (diário às ${String(HORA).padStart(2, '0')}h).`)
  return timer!
}
