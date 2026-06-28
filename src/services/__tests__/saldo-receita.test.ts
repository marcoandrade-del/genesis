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

  it('previsto × arrecadado até a data, com roll-up no pai e saldo a arrecadar', async () => {
    prisma.orcamento.findUnique.mockResolvedValue({ id: 'o1' })
    prisma.contaReceitaEntidade.findMany.mockResolvedValue([
      { id: 'c1', parentId: null }, // raiz
      { id: 'c11', parentId: 'c1' }, // folha
    ])
    prisma.previsaoReceita.groupBy.mockResolvedValue([{ contaReceitaEntidadeId: 'c11', _sum: { valorPrevisto: dec(1000) } }])
    prisma.arrecadacao.groupBy.mockResolvedValue([{ contaReceitaEntidadeId: 'c11', _sum: { valor: dec(300) } }])

    const m = await svc.porConta('ent1', 2026, new Date('2026-06-30T00:00:00'))
    expect(m.get('c11')).toEqual({ previsto: 1000, arrecadado: 300, saldo: 700 })
    expect(m.get('c1')).toEqual({ previsto: 1000, arrecadado: 300, saldo: 700 }) // roll-up
    // a arrecadação é filtrada por data (posição até a data)
    const arg = prisma.arrecadacao.groupBy.mock.calls.at(-1)?.[0] as { where: { data: { lte: Date } } }
    expect(arg.where.data.lte).toBeInstanceOf(Date)
  })
})

describe('SaldoReceitaService.arrecadadoMensal', () => {
  let prisma: PrismaMock
  let svc: SaldoReceitaService

  beforeEach(() => {
    prisma = criarPrismaMock()
    svc = new SaldoReceitaService(prisma as never)
  })

  it('arrecadado por mês (jan..dez) por conta, com roll-up no pai', async () => {
    prisma.contaReceitaEntidade.findMany.mockResolvedValue([
      { id: 'c1', parentId: null }, // raiz
      { id: 'c11', parentId: 'c1' }, // folha
    ])
    prisma.arrecadacao.findMany.mockResolvedValue([
      { contaReceitaEntidadeId: 'c11', data: new Date(Date.UTC(2026, 0, 15)), valor: dec(100) }, // jan
      { contaReceitaEntidadeId: 'c11', data: new Date(Date.UTC(2026, 2, 10)), valor: dec(50) }, // mar
    ])
    const m = await svc.arrecadadoMensal('ent1', 2026)
    expect(m.get('c11')).toEqual([100, 0, 50, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    expect(m.get('c1')).toEqual([100, 0, 50, 0, 0, 0, 0, 0, 0, 0, 0, 0]) // roll-up
    // soma dos 12 meses reconcilia com o total arrecadado da conta
    expect((m.get('c11') ?? []).reduce((a, b) => a + b, 0)).toBe(150)
  })

  it('sem arrecadações → mapa vazio (nenhuma conta com ▸)', async () => {
    prisma.contaReceitaEntidade.findMany.mockResolvedValue([{ id: 'c1', parentId: null }])
    prisma.arrecadacao.findMany.mockResolvedValue([])
    expect((await svc.arrecadadoMensal('ent1', 2026)).size).toBe(0)
  })
})
