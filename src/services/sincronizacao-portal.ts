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

/**
 * Divide `valor` (em CENTAVOS) entre os alvos proporcionalmente ao peso, sem
 * ultrapassar o teto individual: o que excederia o teto de um alvo é
 * redistribuído entre os que ainda têm saldo; esgotados todos os tetos do
 * grupo, o resíduo volta a ser proporcional ao peso — o estouro REAL continua
 * visível (V6 do selo), só o estouro ARTIFICIAL do rateio é evitado.
 * Valor negativo (estorno líquido do mês) não tem teto: proporcional ao peso,
 * resto no último. Σ do retorno = valor, sempre.
 */
export function distribuirComTeto(valor: number, pesos: number[], tetos: number[]): number[] {
  const n = pesos.length
  const out: number[] = new Array(n).fill(0)
  const proporcional = (v: number) => {
    const somaP = pesos.reduce((s, p) => s + p, 0)
    let resto = v
    pesos.forEach((p, i) => {
      const q = i === n - 1 ? resto : Math.round(v * (somaP > 0 ? p / somaP : 1 / n))
      out[i]! += q
      resto -= q
    })
  }
  if (valor <= 0) {
    if (valor < 0) proporcional(valor)
    return out
  }
  let resto = valor
  // cada rodada zera o resto ou satura ao menos um teto ⇒ termina em ≤ n rodadas
  for (let rodada = 0; resto > 0 && rodada < n; rodada++) {
    const abertos = [...Array(n).keys()].filter((i) => out[i]! < tetos[i]!)
    if (abertos.length === 0) break
    const somaP = abertos.reduce((s, i) => s + pesos[i]!, 0)
    const base = resto
    abertos.forEach((i, j) => {
      const quota = j === abertos.length - 1 ? resto : Math.min(resto, Math.round(base * (somaP > 0 ? pesos[i]! / somaP : 1 / abertos.length)))
      const v = Math.min(quota, tetos[i]! - out[i]!)
      out[i]! += v
      resto -= v
    })
  }
  if (resto > 0) proporcional(resto) // grupo sem capacidade — estouro real
  return out
}

type LinhaPortal = { receita: string; valorArrecadado: number }
type DashboardMes = { mes: number; valorArrecadado: number; valorEmpenhado: number; valorPago: number }
type LinhaDespesa = { programatica: string; nivel: number; valorEmpenhado: number; valorLiquidado: number; valorPago: number }

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

  /**
   * Sincroniza a EXECUÇÃO DA DESPESA de um mês (empenhado/liquidado/pago) —
   * mesmo esquema da receita (decisão do Marco: despesa SEMPRE depois da
   * receita do ciclo). Fonte: despesapornivel/detalhada (nível 11 =
   * programática+elemento; a API ignora filtro de fonte, então o valor é
   * RATEADO entre as fontes-dotação proporcionalmente ao autorizado, COM TETO
   * no disponível de cada uma (autorizado − reservado − executado acumulado):
   * o rateio nunca cria estouro artificial de dotação (V6 do selo) — exato
   * quando a programática tem fonte única, aproximação documentada nas
   * demais; o balancete mensal oficial faz o true-up).
   *
   * Escrita = EXECUÇÃO CAPTURADA: 1 empenho sintético de captura por
   * dotação-fonte (fornecedor "CAPTURA PORTAL", numero CAP-…, marcado) +
   * MovimentoEmpenho com os deltas do mês (idempotente por histórico mensal).
   * Alimenta valores-mensais/OXY, RP do Anexo 5 e RREO — não é escrituração.
   */
  async despesaMes(entidadeId: string, ano: number, mes: number): Promise<ResultadoSincronizacao> {
    const registrar = async (r: ResultadoSincronizacao) => {
      await this.prisma.sincronizacaoPortal.create({
        data: { entidadeId, tipo: 'DESPESA_EXECUCAO', ano, mes, status: r.status, mensagem: r.mensagem, valorPortal: r.valorPortal, valorGravado: r.valorGravado },
      })
      return r
    }
    try {
      const orcamento = await this.prisma.orcamento.findUnique({ where: { entidadeId_ano: { entidadeId, ano } }, select: { id: true } })
      if (!orcamento) return registrar({ status: 'ERRO', mensagem: `Sem orçamento ${ano}.`, valorPortal: 0, valorGravado: 0 })

      const dots = await this.prisma.dotacaoDespesa.findMany({
        where: { orcamentoId: orcamento.id },
        select: {
          id: true,
          valorAutorizado: true,
          valorReservado: true,
          unidadeOrcamentaria: { select: { codigo: true } },
          funcao: { select: { codigo: true } },
          subfuncao: { select: { codigo: true } },
          programa: { select: { codigo: true } },
          acao: { select: { codigo: true } },
          contaDespesa: { select: { codigo: true } },
        },
      })
      const porChave = new Map<string, { id: string; autorizado: number; reservado: number }[]>()
      for (const d of dots) {
        const k = `${d.unidadeOrcamentaria.codigo}|${d.funcao.codigo}|${d.subfuncao.codigo}|${d.programa.codigo}|${d.acao.codigo}|${d.contaDespesa.codigo}`
        const l = porChave.get(k) ?? []
        l.push({ id: d.id, autorizado: Number(d.valorAutorizado), reservado: Number(d.valorReservado ?? 0) })
        porChave.set(k, l)
      }

      // execução acumulada por dotação ANTES do mês (em centavos) — é o teto do
      // rateio; movimentos do próprio mês ficam de fora (a captura os reescreve)
      const movsAnteriores = await this.prisma.movimentoEmpenho.findMany({
        where: { entidadeId, data: { gte: new Date(Date.UTC(ano, 0, 1)), lt: new Date(Date.UTC(ano, mes - 1, 1)) } },
        select: { tipo: true, valor: true, empenho: { select: { dotacaoDespesaId: true } } },
      })
      const SINAL: Record<string, { k: 'emp' | 'liq' | 'pag'; s: number }> = {
        EMPENHO: { k: 'emp', s: 1 },
        ESTORNO_EMPENHO: { k: 'emp', s: -1 },
        LIQUIDACAO: { k: 'liq', s: 1 },
        ESTORNO_LIQUIDACAO: { k: 'liq', s: -1 },
        PAGAMENTO: { k: 'pag', s: 1 },
        ESTORNO_PAGAMENTO: { k: 'pag', s: -1 },
      }
      const acumPorDot = new Map<string, { emp: number; liq: number; pag: number }>()
      for (const m of movsAnteriores) {
        const alvo = SINAL[m.tipo]
        if (!alvo) continue
        const v = acumPorDot.get(m.empenho.dotacaoDespesaId) ?? { emp: 0, liq: 0, pag: 0 }
        v[alvo.k] += alvo.s * Math.round(Number(m.valor) * 100)
        acumPorDot.set(m.empenho.dotacaoDespesaId, v)
      }

      const ultimoDia = new Date(Date.UTC(ano, mes, 0)).getUTCDate()
      const linhas = await this.getJson<LinhaDespesa[]>(
        `/despesapornivel/detalhada?dataInicial=${ano}-${String(mes).padStart(2, '0')}-01&dataFinal=${ano}-${String(mes).padStart(2, '0')}-${String(ultimoDia).padStart(2, '0')}`,
        { entidade: ENTIDADE_PORTAL, exercicio: String(ano) },
      )
      // "02.010.04.122.0002.2001.3.1.90.07" → chave programática+elemento
      const parse = (prog: string) => {
        const p = prog.split('.')
        if (p.length !== 10) return null
        return `${p[0]}.${p[1]}|${p[2]}|${p[3]}|${p[4]}|${p[5]}|${p[6]}.${p[7]}.${p[8]}.${p[9]}.00.00`
      }

      type Delta = { dotacaoId: string; empenhado: number; liquidado: number; pago: number }
      const deltas = new Map<string, Delta>()
      let totalEmp = 0
      let totalPago = 0
      let semDotacao = 0
      for (const l of linhas) {
        if (l.nivel !== 11) continue
        if (!l.valorEmpenhado && !l.valorLiquidado && !l.valorPago) continue
        totalEmp = c2(totalEmp + l.valorEmpenhado)
        totalPago = c2(totalPago + l.valorPago)
        const k = parse(l.programatica)
        const alvos = k ? porChave.get(k) : undefined
        if (!alvos || alvos.length === 0) {
          semDotacao = c2(semDotacao + l.valorEmpenhado)
          continue
        }
        // rateio proporcional ao autorizado com teto no disponível de cada
        // fonte-dotação; liquidado ≤ empenhado e pago ≤ liquidado acumulados,
        // pela mesma régua (tudo em centavos)
        const pesos = alvos.map((a) => Math.round(a.autorizado * 100))
        const acums = alvos.map((a) => {
          let v = acumPorDot.get(a.id)
          if (!v) acumPorDot.set(a.id, (v = { emp: 0, liq: 0, pag: 0 }))
          return v
        })
        const empC = distribuirComTeto(Math.round(l.valorEmpenhado * 100), pesos, alvos.map((a, i) => Math.round((a.autorizado - a.reservado) * 100) - acums[i]!.emp))
        const liqC = distribuirComTeto(Math.round(l.valorLiquidado * 100), pesos, alvos.map((_, i) => acums[i]!.emp + empC[i]! - acums[i]!.liq))
        const pagC = distribuirComTeto(Math.round(l.valorPago * 100), pesos, alvos.map((_, i) => acums[i]!.liq + liqC[i]! - acums[i]!.pag))
        alvos.forEach((a, i) => {
          acums[i]!.emp += empC[i]!
          acums[i]!.liq += liqC[i]!
          acums[i]!.pag += pagC[i]!
          if (!empC[i] && !liqC[i] && !pagC[i]) return
          const d = deltas.get(a.id) ?? { dotacaoId: a.id, empenhado: 0, liquidado: 0, pago: 0 }
          d.empenhado = c2(d.empenhado + empC[i]! / 100)
          d.liquidado = c2(d.liquidado + liqC[i]! / 100)
          d.pago = c2(d.pago + pagC[i]! / 100)
          deltas.set(a.id, d)
        })
      }

      // validação ANTES de gravar: dashboard (empenhado do mês)
      const dash = await this.getJson<DashboardMes[]>(`/api/dashboard/arrecadacao-despesa?exercicio=${ano}`, { entidade: ENTIDADE_PORTAL, exercicio: String(ano) })
      const doMes = dash.find((m) => m.mes === mes)?.valorEmpenhado ?? 0
      const divergencia = doMes > 0 ? Math.abs(totalEmp - doMes) / doMes : totalEmp > 0 ? 1 : 0
      if (divergencia > TOLERANCIA) {
        return registrar({
          status: 'DIVERGENTE',
          mensagem: `Empenhado capturado R$ ${totalEmp.toFixed(2)} × dashboard R$ ${doMes.toFixed(2)} (${(divergencia * 100).toFixed(2)}%) — nada gravado.`,
          valorPortal: doMes,
          valorGravado: 0,
        })
      }

      // infra de captura: fornecedor sintético + usuário do sistema
      let fornecedor = await this.prisma.fornecedor.findFirst({ where: { razaoSocial: 'CAPTURA PORTAL DA TRANSPARÊNCIA' }, select: { id: true } })
      if (!fornecedor) {
        fornecedor = await this.prisma.fornecedor.create({
          data: { tipoPessoa: 'PJ', razaoSocial: 'CAPTURA PORTAL DA TRANSPARÊNCIA', nomeFantasia: 'Execução capturada do portal (não é credor real)' },
          select: { id: true },
        })
      }
      const usuario = await this.prisma.usuario.findFirst({ orderBy: { criadoEm: 'asc' }, select: { id: true } })
      if (!usuario) return registrar({ status: 'ERRO', mensagem: 'Sem usuário para criadoPorId.', valorPortal: doMes, valorGravado: 0 })

      const historico = `CAPTURA PORTAL despesa ${String(mes).padStart(2, '0')}/${ano}`
      const dataMov = new Date(Date.UTC(ano, mes, 0))
      await this.prisma.$transaction(async (tx) => {
        // empenho de captura por dotação (numero estável CAP-{id8})
        const ids = [...deltas.keys()]
        const existentes = await tx.empenho.findMany({
          where: { entidadeId, dotacaoDespesaId: { in: ids }, numero: { startsWith: 'CAP-' } },
          select: { id: true, dotacaoDespesaId: true },
        })
        const empPorDot = new Map(existentes.map((e) => [e.dotacaoDespesaId, e.id]))
        for (const id of ids) {
          if (empPorDot.has(id)) continue
          const novo = await tx.empenho.create({
            data: {
              entidadeId,
              dotacaoDespesaId: id,
              fornecedorId: fornecedor!.id,
              numero: `CAP-${id.slice(0, 8)}`,
              tipo: 'ESTIMATIVO',
              data: dataMov,
              valor: 0,
              historico: 'Empenho de CAPTURA da execução do portal (não é escrituração).',
            },
            select: { id: true },
          })
          empPorDot.set(id, novo.id)
        }
        // movimentos do mês (idempotente por histórico); quem TINHA movimento
        // neste mês também rematerializa — um re-run pode tirar todo o
        // movimento de uma dotação e ela não pode ficar com o valor velho
        const anteriores = await tx.movimentoEmpenho.findMany({
          where: { entidadeId, historico },
          distinct: ['empenhoId'],
          select: { empenhoId: true, empenho: { select: { dotacaoDespesaId: true } } },
        })
        for (const a of anteriores) {
          if (!empPorDot.has(a.empenho.dotacaoDespesaId)) empPorDot.set(a.empenho.dotacaoDespesaId, a.empenhoId)
        }
        await tx.movimentoEmpenho.deleteMany({ where: { entidadeId, historico } })
        const movRows: { entidadeId: string; empenhoId: string; tipo: 'EMPENHO' | 'ESTORNO_EMPENHO' | 'LIQUIDACAO' | 'ESTORNO_LIQUIDACAO' | 'PAGAMENTO' | 'ESTORNO_PAGAMENTO'; valor: number; data: Date; criadoPorId: string; historico: string }[] = []
        for (const d of deltas.values()) {
          const eId = empPorDot.get(d.dotacaoId)!
          const push = (v: number, pos: 'EMPENHO' | 'LIQUIDACAO' | 'PAGAMENTO', neg: 'ESTORNO_EMPENHO' | 'ESTORNO_LIQUIDACAO' | 'ESTORNO_PAGAMENTO') => {
            if (!v) return
            movRows.push({ entidadeId, empenhoId: eId, tipo: v > 0 ? pos : neg, valor: Math.abs(v), data: dataMov, criadoPorId: usuario!.id, historico })
          }
          push(d.empenhado, 'EMPENHO', 'ESTORNO_EMPENHO')
          push(d.liquidado, 'LIQUIDACAO', 'ESTORNO_LIQUIDACAO')
          push(d.pago, 'PAGAMENTO', 'ESTORNO_PAGAMENTO')
        }
        await tx.movimentoEmpenho.createMany({ data: movRows })
        // rematerializa: empenho.valor/valorLiquidado e dotacao.valorEmpenhado
        for (const [dotId, empId] of empPorDot) {
          const ag = await tx.movimentoEmpenho.groupBy({ by: ['tipo'], where: { empenhoId: empId }, _sum: { valor: true } })
          const soma = (t: string) => Number(ag.find((g) => g.tipo === t)?._sum.valor ?? 0)
          const emp = c2(soma('EMPENHO') - soma('ESTORNO_EMPENHO'))
          const liq = c2(soma('LIQUIDACAO') - soma('ESTORNO_LIQUIDACAO'))
          await tx.empenho.update({ where: { id: empId }, data: { valor: emp, valorLiquidado: liq } })
          await tx.dotacaoDespesa.update({ where: { id: dotId }, data: { valorEmpenhado: emp } })
        }
      }, { timeout: 120000 })

      return registrar({
        status: 'OK',
        mensagem: `${deltas.size} dotações; empenhado R$ ${totalEmp.toFixed(2)}, pago R$ ${totalPago.toFixed(2)}; sem dotação R$ ${semDotacao.toFixed(2)}.`,
        valorPortal: doMes,
        valorGravado: totalEmp,
      })
    } catch (e) {
      return registrar({ status: 'ERRO', mensagem: e instanceof Error ? e.message : String(e), valorPortal: 0, valorGravado: 0 })
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
      // ordem do Marco: RECEITA sempre antes da DESPESA no ciclo
      const r1 = await svc.arrecadacaoMes(ent.id, ano, mes)
      log(`[sync-portal] arrecadação ${mes}/${ano}: ${r1.status} — ${r1.mensagem}`)
      const d1 = await svc.despesaMes(ent.id, ano, mes)
      log(`[sync-portal] despesa ${mes}/${ano}: ${d1.status} — ${d1.mensagem}`)
      if (agora.getDate() <= 3) {
        const mAnt = mes === 1 ? 12 : mes - 1
        const aAnt = mes === 1 ? ano - 1 : ano
        const r2 = await svc.arrecadacaoMes(ent.id, aAnt, mAnt)
        log(`[sync-portal] arrecadação ${mAnt}/${aAnt} (fechamento): ${r2.status} — ${r2.mensagem}`)
        const d2 = await svc.despesaMes(ent.id, aAnt, mAnt)
        log(`[sync-portal] despesa ${mAnt}/${aAnt} (fechamento): ${d2.status} — ${d2.mensagem}`)
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
