import type { PrismaClient } from '@prisma/client'
import { ContasBancariasService } from './contas-bancarias.js'

/**
 * Saldo bancário consolidado por MÊS (read-only) para o painel do Oxy: por conta
 * bancária, o saldo FINAL de cada mês (acumulado CRÉDITO−DÉBITO desde a abertura)
 * e a movimentação do mês (Σ|valor|). Contrato `saldo-bancario` em memoriais.ts.
 */

const r2 = (n: number) => Math.round(n * 100) / 100
const z12 = () => new Array<number>(12).fill(0)

export interface ContaBancariaMensal {
  rotulo: string
  banco: string
  fonte: string
  saldoMensal: number[]
  movimentacaoMensal: number[]
}
type Entidade = { id: string; nome: string; estado: string }
export interface SaldoBancarioMensal { entidade: Entidade; ano: number; mesesRealizados: number; contas: ContaBancariaMensal[] }

export class SaldoBancarioMensalService {
  constructor(private prisma: PrismaClient) {}

  private mesesRealizados(ano: number): number {
    const hoje = new Date()
    if (ano < hoje.getFullYear()) return 12
    if (ano > hoje.getFullYear()) return 0
    return hoje.getMonth() + 1
  }

  private async entidadeInfo(entidadeId: string): Promise<Entidade | null> {
    const e = await this.prisma.entidade.findUnique({
      where: { id: entidadeId },
      select: { id: true, nome: true, municipio: { select: { estado: { select: { sigla: true } } } } },
    })
    if (!e) return null
    return { id: e.id, nome: e.nome, estado: e.municipio?.estado?.sigla ?? '' }
  }

  async consolidar(entidadeId: string, ano: number): Promise<SaldoBancarioMensal | null> {
    const entidade = await this.entidadeInfo(entidadeId)
    if (!entidade) return null
    const base = { entidade, ano, mesesRealizados: this.mesesRealizados(ano) }

    const contas = await new ContasBancariasService(this.prisma).listar(entidadeId, ano)
    if (contas.length === 0) return { ...base, contas: [] }

    const ini = new Date(Date.UTC(ano, 0, 1))
    const fim = new Date(Date.UTC(ano, 11, 31))
    const out: ContaBancariaMensal[] = []

    for (const c of contas) {
      const movs = await this.prisma.movimentoBancario.findMany({
        where: { contaBancariaId: c.id, data: { lte: fim } },
        select: { data: true, valor: true, sentido: true },
      })
      let abertura = 0 // saldo acumulado ANTES de 1º/jan (CRÉDITO entra, DÉBITO sai)
      const net = z12()
      const movm = z12()
      for (const m of movs) {
        const v = Number(m.valor)
        const delta = (m.sentido === 'CREDITO' ? 1 : -1) * v
        if (m.data < ini) {
          abertura += delta
          continue
        }
        const mes = m.data.getUTCMonth()
        net[mes] = (net[mes] ?? 0) + delta
        movm[mes] = (movm[mes] ?? 0) + Math.abs(v)
      }
      const saldoMensal = z12()
      let run = abertura
      for (let i = 0; i < 12; i++) {
        run += net[i] ?? 0
        saldoMensal[i] = r2(run)
      }
      out.push({
        rotulo: c.rotulo,
        banco: c.bancoNome ?? c.bancoCodigo,
        fonte: `${c.fonteCodigo}${c.fonteNomenclatura ? ` - ${c.fonteNomenclatura}` : ''}`,
        saldoMensal,
        movimentacaoMensal: movm.map(r2),
      })
    }
    return { ...base, contas: out }
  }
}
