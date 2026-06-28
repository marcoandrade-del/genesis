import { describe, it, expect, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'
import { SaldoReceitaService } from '../saldo-receita.js'

const dec = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v)

describe('SaldoReceitaService.porConta', () => {
  let prisma: PrismaMock
  let svc: SaldoReceitaService

  beforeEach(() => {
    prisma = criarPrismaMock()
    svc = new SaldoReceitaService(prisma as never)
  })

  it('sem orçamento → mapa vazio', async () => {
    prisma.orcamento.findUnique.mockResolvedValue(null)
    const m = await svc.porConta('ent1', 2026, new Date('2026-06-30T00:00:00'))
    expect(m.size).toBe(0)
    expect(prisma.previsaoReceita.groupBy).not.toHaveBeenCalled()
  })

  it('previsto × arrecadado (ARRECADACAO − ESTORNO) via previsao, roll-up e saldo a arrecadar', async () => {
    prisma.orcamento.findUnique.mockResolvedValue({ id: 'o1' })
    prisma.contaReceitaEntidade.findMany.mockResolvedValue([
      { id: 'c1', parentId: null }, // raiz
      { id: 'c11', parentId: 'c1' }, // folha
    ])
    prisma.previsaoReceita.groupBy.mockResolvedValue([{ contaReceitaEntidadeId: 'c11', _sum: { valorPrevisto: dec(1000) } }])
    // Arrecadacao liga à conta via previsao; ESTORNO subtrai.
    prisma.arrecadacao.findMany.mockResolvedValue([
      { valor: dec(300), tipo: 'ARRECADACAO', previsao: { contaReceitaEntidadeId: 'c11' } },
      { valor: dec(50), tipo: 'ESTORNO', previsao: { contaReceitaEntidadeId: 'c11' } },
    ])

    const m = await svc.porConta('ent1', 2026, new Date('2026-06-30T00:00:00'))
    expect(m.get('c11')).toEqual({ previsto: 1000, arrecadado: 250, saldo: 750 }) // 300 − 50
    expect(m.get('c1')).toEqual({ previsto: 1000, arrecadado: 250, saldo: 750 }) // roll-up
    // a arrecadação é filtrada por data (posição até a data) e escopada por orçamento
    const arg = prisma.arrecadacao.findMany.mock.calls.at(-1)?.[0] as { where: { data: { lte: Date }; previsao: { orcamentoId: string } } }
    expect(arg.where.data.lte).toBeInstanceOf(Date)
    expect(arg.where.previsao.orcamentoId).toBe('o1')
  })
})

describe('SaldoReceitaService.arrecadadoMensal', () => {
  let prisma: PrismaMock
  let svc: SaldoReceitaService

  beforeEach(() => {
    prisma = criarPrismaMock()
    svc = new SaldoReceitaService(prisma as never)
  })

  it('arrecadado por mês (jan..dez) por conta via previsao, com roll-up no pai', async () => {
    prisma.orcamento.findUnique.mockResolvedValue({ id: 'o1' })
    prisma.contaReceitaEntidade.findMany.mockResolvedValue([
      { id: 'c1', parentId: null }, // raiz
      { id: 'c11', parentId: 'c1' }, // folha
    ])
    prisma.arrecadacao.findMany.mockResolvedValue([
      { valor: dec(100), tipo: 'ARRECADACAO', data: new Date(Date.UTC(2026, 0, 15)), previsao: { contaReceitaEntidadeId: 'c11' } }, // jan
      { valor: dec(50), tipo: 'ARRECADACAO', data: new Date(Date.UTC(2026, 2, 10)), previsao: { contaReceitaEntidadeId: 'c11' } }, // mar
    ])
    const m = await svc.arrecadadoMensal('ent1', 2026)
    expect(m.get('c11')).toEqual([100, 0, 50, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    expect(m.get('c1')).toEqual([100, 0, 50, 0, 0, 0, 0, 0, 0, 0, 0, 0]) // roll-up
    // soma dos 12 meses reconcilia com o total arrecadado da conta
    expect((m.get('c11') ?? []).reduce((a, b) => a + b, 0)).toBe(150)
  })

  it('sem orçamento → mapa vazio', async () => {
    prisma.orcamento.findUnique.mockResolvedValue(null)
    expect((await svc.arrecadadoMensal('ent1', 2026)).size).toBe(0)
  })

  it('sem arrecadações → mapa vazio (nenhuma conta com ▸)', async () => {
    prisma.orcamento.findUnique.mockResolvedValue({ id: 'o1' })
    prisma.contaReceitaEntidade.findMany.mockResolvedValue([{ id: 'c1', parentId: null }])
    prisma.arrecadacao.findMany.mockResolvedValue([])
    expect((await svc.arrecadadoMensal('ent1', 2026)).size).toBe(0)
  })
})
