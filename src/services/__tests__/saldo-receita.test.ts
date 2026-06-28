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
