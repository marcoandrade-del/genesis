/**
 * Núcleo PURO do import/sync de decretos (créditos adicionais) da API
 * Elotech `/api/creditosadicionais` — extraído de
 * scripts/importar_decretos_2026.ts para servir também à sincronização
 * automática (SincronizacaoDecretosService). Sem I/O: recebe itens do portal
 * e o estado do banco por callbacks/valores.
 *
 * MODELO DA API (decifrado 2026-07-03, ver memória decretos-import-aprendizados):
 *  - `saldoAtualizado` = valor ATUAL da dotação (constante nos registros dela).
 *  - Cada registro traz o par {delta do decreto, atual − delta} nos campos
 *    (valorInicial, valor) EM ORDEM AMBÍGUA. Reduzida = delta negativo.
 *  - Desambiguação por EQUAÇÃO: por dotação, Σ deltas pendentes = atual − banco
 *    (retomada INCREMENTAL, 2026-07-08: decretos já lançados saem da equação —
 *    re-resolver a história completa redistribuía flips entre lançados e
 *    pendentes e atribuía o valor errado do par a um pendente).
 *
 * Valores em CENTAVOS em todo o módulo.
 */

export type ItemPortalDecreto = {
  despesa: string
  valorInicial: number
  valor: number
  saldoAtualizado: number
  decreto: string
  natureza: 'Suplementar' | 'Reduzida'
  fonteRecurso: number
  sequencia: number
}

export type DimsDecreto = { uo: string; funcao: string; subfuncao: string; programa: string; acao: string; conta: string }

export type RegDecreto = {
  dec: string
  dims: DimsDecreto
  fonte: string
  std: number // delta padrão (centavos): Supl→+val, Red→−ini
  alt: number // delta alternativo:      Supl→+ini, Red→−val
  atual: number
  deltaFinal?: number
}

export type MovDecreto = { kf: string; dims: DimsDecreto; fonte: string; operacao: 'REFORCO' | 'ANULACAO'; valor: number }

export type AjusteConciliacao = { kf: string; dims: DimsDecreto; fonte: string; residuo: number }

export const centavosDecreto = (n: number) => Math.round(n * 100)

/** "08.010.10.302.0012.2.024.3.3.71.70.00.00" → dimensões (ação junta os 2 segmentos). */
export function parseDespesaDecreto(despesa: string): DimsDecreto | null {
  const p = despesa.split('.')
  if (p.length !== 13) return null
  return {
    uo: `${p[0]}.${p[1]}`,
    funcao: p[2]!,
    subfuncao: p[3]!,
    programa: p[4]!,
    acao: `${p[5]}${p[6]!.padStart(3, '0')}`,
    conta: p.slice(7).join('.'),
  }
}

/**
 * Agrupa os itens do portal por dotação-fonte (`kf` = "despesa|fonte").
 * Itens sem número de decreto ("null/null") recebem `snRotulo`.
 * Lança se alguma programática não parsear (dado inesperado ⇒ não adivinhar).
 */
export function montarRegistrosPorDotacao(itens: ItemPortalDecreto[], snRotulo: string): Map<string, RegDecreto[]> {
  const c = centavosDecreto
  const porDot = new Map<string, RegDecreto[]>()
  for (const i of itens) {
    const dec = !i.decreto || i.decreto === 'null/null' ? snRotulo : i.decreto
    const dims = parseDespesaDecreto(i.despesa)
    if (!dims) throw new Error(`programática inesperada: ${i.despesa}`)
    const reg: RegDecreto = {
      dec,
      dims,
      fonte: String(i.fonteRecurso),
      std: i.natureza === 'Suplementar' ? c(i.valor) : -c(i.valorInicial),
      alt: i.natureza === 'Suplementar' ? c(i.valorInicial) : -c(i.valor),
      atual: c(i.saldoAtualizado),
    }
    if (reg.std === 0 && reg.alt === 0) continue
    const kf = `${i.despesa}|${reg.fonte}`
    const l = porDot.get(kf) ?? []
    l.push(reg)
    porDot.set(kf, l)
  }
  return porDot
}

/** Retomada incremental: remove os registros de decretos já lançados (in-place). */
export function filtrarPendentes(porDot: Map<string, RegDecreto[]>, jaLancados: Set<string>): void {
  for (const [kf, regs] of porDot) {
    const pend = regs.filter((r) => !jaLancados.has(r.dec))
    if (pend.length) porDot.set(kf, pend)
    else porDot.delete(kf)
  }
}

/**
 * Solver por dotação: escolhe delta ∈ {±std, ±alt} por registro para fechar
 * Σ deltas = atual − base (DFS custo-mínimo; custos 0/1/2/2 — flip do par
 * custa 1, sinal invertido/estorno custa 2). Dotações sem combinação exata
 * usam os deltas padrão e viram AjusteConciliacao com o resíduo EXPLÍCITO.
 */
export function resolverDeltasPendentes(
  porDot: Map<string, RegDecreto[]>,
  baseAtual: (kf: string) => number,
): { fechaStd: number; fechaFlip: number; ajustes: AjusteConciliacao[] } {
  let fechaStd = 0
  let fechaFlip = 0
  const ajustes: AjusteConciliacao[] = []
  for (const [kf, regs] of porDot) {
    const alvo = regs[0]!.atual - baseAtual(kf)
    const somaStd = regs.reduce((s, r) => s + r.std, 0)
    if (somaStd === alvo) {
      for (const r of regs) r.deltaFinal = r.std
      fechaStd++
      continue
    }
    const n = regs.length
    const OPCOES = regs.map((r) => {
      const cand = [
        { d: r.std, c: 0 },
        { d: r.alt, c: 1 },
        { d: -r.std, c: 2 },
        { d: -r.alt, c: 2 },
      ]
      const vistos = new Map<number, number>()
      for (const o of cand) if (!vistos.has(o.d) || vistos.get(o.d)! > o.c) vistos.set(o.d, o.c)
      return [...vistos.entries()].map(([d, c]) => ({ d, c })).sort((a, b) => a.c - b.c)
    })
    const sufMin: number[] = new Array(n + 1).fill(0)
    const sufMax: number[] = new Array(n + 1).fill(0)
    for (let i = n - 1; i >= 0; i--) {
      sufMin[i] = sufMin[i + 1]! + Math.min(...OPCOES[i]!.map((o) => o.d))
      sufMax[i] = sufMax[i + 1]! + Math.max(...OPCOES[i]!.map((o) => o.d))
    }
    let melhor: { escolha: number[]; custo: number } | null = null
    const escolha: number[] = new Array(n).fill(0)
    let nos = 0
    const LIMITE_NOS = 3_000_000
    const dfs = (i: number, resto: number, custo: number) => {
      if (nos++ > LIMITE_NOS) return
      if (melhor && custo >= melhor.custo) return
      if (i === n) {
        if (resto === 0) melhor = { escolha: [...escolha], custo }
        return
      }
      if (resto < sufMin[i]! || resto > sufMax[i]!) return
      for (let oi = 0; oi < OPCOES[i]!.length; oi++) {
        escolha[i] = oi
        dfs(i + 1, resto - OPCOES[i]![oi]!.d, custo + OPCOES[i]![oi]!.c)
      }
    }
    if (n <= 22) dfs(0, alvo, 0)
    if (melhor) {
      const m = melhor as { escolha: number[]; custo: number }
      regs.forEach((r, i) => (r.deltaFinal = OPCOES[i]![m.escolha[i]!]!.d))
      fechaFlip++
    } else {
      for (const r of regs) r.deltaFinal = r.std
      ajustes.push({ kf, dims: regs[0]!.dims, fonte: regs[0]!.fonte, residuo: alvo - somaStd })
    }
  }
  return { fechaStd, fechaFlip, ajustes }
}

/**
 * Monta os movimentos por decreto a partir dos deltas resolvidos, com NETTING
 * por dotação dentro de cada decreto (o service de créditos valida anulação
 * contra o saldo pré-documento). `ajustes` (se houver) entram no decreto
 * `snNumero` — a sincronização automática NÃO deve passá-los (guard).
 */
export function montarMovimentosPorDecreto(
  porDot: Map<string, RegDecreto[]>,
  ajustes: AjusteConciliacao[],
  snNumero: string,
): Map<string, MovDecreto[]> {
  const movPorDecreto = new Map<string, MovDecreto[]>()
  for (const [kf, regs] of porDot) {
    for (const r of regs) {
      if (!r.deltaFinal) continue
      const l = movPorDecreto.get(r.dec) ?? []
      l.push({ kf, dims: r.dims, fonte: r.fonte, operacao: r.deltaFinal > 0 ? 'REFORCO' : 'ANULACAO', valor: Math.abs(r.deltaFinal) })
      movPorDecreto.set(r.dec, l)
    }
  }
  for (const a of ajustes) {
    if (a.residuo === 0) continue
    const l = movPorDecreto.get(snNumero) ?? []
    l.push({ kf: a.kf, dims: a.dims, fonte: a.fonte, operacao: a.residuo > 0 ? 'REFORCO' : 'ANULACAO', valor: Math.abs(a.residuo) })
    movPorDecreto.set(snNumero, l)
  }
  for (const [dec, movs] of movPorDecreto) {
    const porKf = new Map<string, MovDecreto>()
    for (const m of movs) {
      const ex = porKf.get(m.kf)
      if (!ex) {
        porKf.set(m.kf, { ...m })
        continue
      }
      const liq = (ex.operacao === 'REFORCO' ? ex.valor : -ex.valor) + (m.operacao === 'REFORCO' ? m.valor : -m.valor)
      ex.operacao = liq >= 0 ? 'REFORCO' : 'ANULACAO'
      ex.valor = Math.abs(liq)
    }
    movPorDecreto.set(dec, [...porKf.values()].filter((m) => m.valor > 0))
  }
  return movPorDecreto
}

/** Dentro de um decreto, reforços antes das anulações (saldo pré-documento). */
export const ordenarItensDecreto = (movs: MovDecreto[]): MovDecreto[] =>
  [...movs].sort((a, b) => (a.operacao === b.operacao ? 0 : a.operacao === 'REFORCO' ? -1 : 1))

/**
 * Simulação sequencial com reordenação por viabilidade: decretos cuja
 * anulação ainda não cabe são adiados até os reforços de outros chegarem.
 * Retorna a ordem viável, ou null se algum decreto NUNCA cabe (saldo negativo).
 */
export function ordenarPorViabilidade(
  pendentes: string[],
  movPorDecreto: Map<string, MovDecreto[]>,
  abre: (kf: string) => number,
): string[] | null {
  const saldoSim = new Map<string, number>()
  const cabe = (movs: MovDecreto[]) => {
    const tmp = new Map<string, number>()
    for (const m of ordenarItensDecreto(movs)) {
      const s = tmp.get(m.kf) ?? saldoSim.get(m.kf) ?? abre(m.kf)
      const novo = s + (m.operacao === 'REFORCO' ? m.valor : -m.valor)
      if (novo < 0) return false
      tmp.set(m.kf, novo)
    }
    for (const [k, v] of tmp) saldoSim.set(k, v)
    return true
  }
  const ordemFinal: string[] = []
  let fila = [...pendentes]
  let adiadosUltima = -1
  while (fila.length) {
    const adiados: string[] = []
    for (const dec of fila) {
      if (cabe(movPorDecreto.get(dec)!)) ordemFinal.push(dec)
      else adiados.push(dec)
    }
    if (adiados.length === fila.length || adiados.length === adiadosUltima) return null
    adiadosUltima = adiados.length
    fila = adiados
  }
  return ordemFinal
}
