import { PrismaClient, Prisma } from '@prisma/client'
import type { Verificacao } from './consistencia.js'

/**
 * EMISSOR DA MATRIZ DE SALDOS CONTÁBEIS (MSC) — keystone do alvo ICF/Ranking
 * Siconfi. A MSC é uma projeção do razão único do Gênesis no leiaute da STN
 * (Portaria STN/MF 642/2019): por CONTA ANALÍTICA do PCASP estendido, quatro
 * tipos de valor no período — SI (saldo inicial), MD (movimento devedor), MC
 * (movimento credor) e SF (saldo final) — mais a natureza do saldo.
 *
 * Fase 1 (backbone): só o balancete analítico mês a mês. As informações
 * complementares da MSC (poder/órgão, fonte/destinação, natureza da receita/
 * despesa, função/subfunção) entram nas fases seguintes, quebrando cada linha
 * pelas dimensões já gravadas no LancamentoItem. Como todo o razão sai do MESMO
 * lançamento que gera RREO/RGF, a MSC fecha por construção (é a vantagem do ICF).
 */

export type NaturezaSaldoMsc = 'DEVEDORA' | 'CREDORA' | 'MISTA'

export interface LinhaMsc {
  conta: string // código PCASP estendido (conta analítica)
  naturezaSaldo: NaturezaSaldoMsc | null
  // SI e SF vêm em "saldo devedor COM SINAL": positivo = devedor, negativo =
  // credor (o mesmo padrão do balancete em saldo-contabil).
  saldoInicial: number // SI — no início do mês
  movimentoDevedor: number // MD — Σ débitos do mês (≥ 0)
  movimentoCredor: number // MC — Σ créditos do mês (≥ 0)
  saldoFinal: number // SF — no fim do mês
}

export interface MatrizSaldosContabeis {
  entidade: { id: string; nome: string; municipio: string; estado: string }
  ano: number
  mes: number // período (1..12)
  tipo: 'AGREGADA' // encerramento (dezembro) vem em fase posterior
  metodologia: string
  linhas: LinhaMsc[]
  verificacoes: Verificacao[]
  selo: { aprovadas: number; avaliadas: number; total: number }
}

const n = (d: Prisma.Decimal | number | null | undefined) => (d == null ? 0 : Number(d))
const r2 = (x: number) => Math.round(x * 100) / 100
const TOLERANCIA = 0.01 // centavo

const METODOLOGIA =
  'MSC agregada (Portaria STN/MF 642/2019): contas analíticas do PCASP estendido; ' +
  'SI/MD/MC/SF do período em saldo devedor com sinal; movimentos do mês lidos de ' +
  'ResumoMensalConta e saldo de abertura de SaldoInicialAno. Informações complementares ' +
  '(poder/órgão, fonte, natureza da receita/despesa, função) entram nas próximas fases.'

export class MatrizSaldosContabeisService {
  constructor(private prisma: PrismaClient) {}

  /** MSC agregada da entidade no mês (período 1..12). `null` se a entidade não existe. */
  async emitir(entidadeId: string, ano: number, mes: number): Promise<MatrizSaldosContabeis | null> {
    const ent = await this.prisma.entidade.findUnique({
      where: { id: entidadeId },
      select: { id: true, nome: true, municipio: { select: { nome: true, estado: { select: { sigla: true } } } } },
    })
    if (!ent) return null

    // Contas ANALÍTICAS (admiteMovimento) da entidade/exercício — a MSC só usa
    // as contas de último nível do PCASP estendido.
    const contas = await this.prisma.contaContabilEntidade.findMany({
      where: { entidadeId, ano, admiteMovimento: true },
      select: { id: true, codigo: true, modeloContaId: true },
    })

    // Natureza do saldo vem do modelo padrão (ContaContabilEntidade não a guarda).
    const modeloIds = [...new Set(contas.map((c) => c.modeloContaId).filter((x): x is string => !!x))]
    const modelos = modeloIds.length
      ? await this.prisma.conta.findMany({ where: { id: { in: modeloIds } }, select: { id: true, naturezaSaldo: true } })
      : []
    const natPorModelo = new Map(modelos.map((m) => [m.id, (m.naturezaSaldo as NaturezaSaldoMsc | null) ?? null]))

    const iniciais = await this.prisma.saldoInicialAno.findMany({
      where: { entidadeId, ano },
      select: { contaId: true, valor: true },
    })
    const inicialPorConta = new Map(iniciais.map((s) => [s.contaId, n(s.valor)]))

    // Débito/crédito por conta e mês, até o mês pedido (o resto do ano não importa).
    const resumos = await this.prisma.resumoMensalConta.findMany({
      where: { entidadeId, ano, mes: { lte: mes } },
      select: { contaId: true, mes: true, totalDebito: true, totalCredito: true },
    })
    const antes = new Map<string, number>() // Σ (débito − crédito) dos meses anteriores → compõe o SI
    const md = new Map<string, number>() // débitos do mês pedido
    const mc = new Map<string, number>() // créditos do mês pedido
    for (const r of resumos) {
      const deb = n(r.totalDebito)
      const cred = n(r.totalCredito)
      if (r.mes < mes) antes.set(r.contaId, (antes.get(r.contaId) ?? 0) + deb - cred)
      else if (r.mes === mes) {
        md.set(r.contaId, (md.get(r.contaId) ?? 0) + deb)
        mc.set(r.contaId, (mc.get(r.contaId) ?? 0) + cred)
      }
    }

    const linhas: LinhaMsc[] = []
    for (const c of contas) {
      const natureza = c.modeloContaId ? natPorModelo.get(c.modeloContaId) ?? null : null
      // Saldo de abertura em termos de débito: conta credora entra negativa.
      const aberturaDevedor = natureza === 'CREDORA' ? -(inicialPorConta.get(c.id) ?? 0) : inicialPorConta.get(c.id) ?? 0
      const si = r2(aberturaDevedor + (antes.get(c.id) ?? 0))
      const movD = r2(md.get(c.id) ?? 0)
      const movC = r2(mc.get(c.id) ?? 0)
      const sf = r2(si + movD - movC)
      // Conta sem saldo e sem movimento no período não gera linha na MSC.
      if (si === 0 && movD === 0 && movC === 0 && sf === 0) continue
      linhas.push({ conta: c.codigo, naturezaSaldo: natureza, saldoInicial: si, movimentoDevedor: movD, movimentoCredor: movC, saldoFinal: sf })
    }
    linhas.sort((a, b) => a.conta.localeCompare(b.conta))

    const verificacoes = this.verificar(linhas)
    const avaliadas = verificacoes.filter((v) => v.status !== 'NAO_APLICAVEL').length
    const aprovadas = verificacoes.filter((v) => v.status === 'OK').length

    return {
      entidade: { id: ent.id, nome: ent.nome, municipio: ent.municipio?.nome ?? '', estado: ent.municipio?.estado?.sigla ?? '' },
      ano,
      mes,
      tipo: 'AGREGADA',
      metodologia: METODOLOGIA,
      linhas,
      verificacoes,
      selo: { aprovadas, avaliadas, total: verificacoes.length },
    }
  }

  /**
   * Selo da MSC: identidades da partida dobrada verificadas por máquina — o mesmo
   * padrão do Selo de Consistência, aplicado ao balancete que a MSC transporta.
   *  - Partida dobrada: no período, Σ MD = Σ MC.
   *  - Balanço fecha: no fim do período, Σ SF (com sinal) = 0.
   */
  private verificar(linhas: LinhaMsc[]): Verificacao[] {
    const compara = (codigo: string, titulo: string, esperado: number, obtido: number, detalhe: string): Verificacao => {
      const delta = r2(obtido - esperado)
      return { codigo, titulo, status: Math.abs(delta) <= TOLERANCIA ? 'OK' : 'DIVERGENTE', esperado: r2(esperado), obtido: r2(obtido), delta, detalhe }
    }
    const totalMd = r2(linhas.reduce((a, l) => a + l.movimentoDevedor, 0))
    const totalMc = r2(linhas.reduce((a, l) => a + l.movimentoCredor, 0))
    const totalSf = r2(linhas.reduce((a, l) => a + l.saldoFinal, 0))
    return [
      compara('MSC_PARTIDA_DOBRADA', 'Partida dobrada: Σ movimento devedor × Σ movimento credor', totalMc, totalMd, 'Todo débito do período tem crédito de igual valor; a soma dos dois lados fecha.'),
      compara('MSC_BALANCO_FECHA', 'Balanço fecha: Σ saldo final (com sinal) = 0', 0, totalSf, 'No fim do período o balancete zera em saldo devedor com sinal — o razão está equilibrado.'),
    ]
  }
}
