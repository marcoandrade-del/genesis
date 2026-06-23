import { describe, it, expect, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'
import { SaldoDiarioService } from '../saldo-diario.js'

const dec = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v)
const dia = (d: number) => new Date(Date.UTC(2026, 0, d))

describe('SaldoDiarioService.serie', () => {
  let prisma: PrismaMock
  let service: SaldoDiarioService

  beforeEach(() => {
    prisma = criarPrismaMock()
    service = new SaldoDiarioService(prisma as never)
    prisma.contaContabilEntidade.findUnique.mockResolvedValue({ modeloContaId: 'm1' })
    prisma.saldoInicialAno.findUnique.mockResolvedValue({ valor: dec(100) })
  })

  it('acumula no lado DEVEDOR (débito soma, crédito subtrai) a partir do saldo inicial', async () => {
    prisma.conta.findUnique.mockResolvedValue({ naturezaSaldo: 'DEVEDORA' })
    prisma.movimentoDiarioConta.findMany.mockResolvedValue([
      { data: dia(2), totalDebito: dec(50), totalCredito: dec(0) },
      { data: dia(5), totalDebito: dec(0), totalCredito: dec(30) },
    ])
    const s = await service.serie('ent1', 'c1', 2026)
    expect(s.dias.map((d) => d.saldoAcumulado.toString())).toEqual(['150', '120'])
    expect(s.totalDebito.toString()).toBe('50')
    expect(s.totalCredito.toString()).toBe('30')
    expect(s.saldoFinal.toString()).toBe('120')
  })

  it('acumula no lado CREDOR (crédito soma, débito subtrai)', async () => {
    prisma.conta.findUnique.mockResolvedValue({ naturezaSaldo: 'CREDORA' })
    prisma.movimentoDiarioConta.findMany.mockResolvedValue([
      { data: dia(3), totalDebito: dec(0), totalCredito: dec(40) },
      { data: dia(7), totalDebito: dec(10), totalCredito: dec(0) },
    ])
    const s = await service.serie('ent1', 'c1', 2026)
    expect(s.dias.map((d) => d.saldoAcumulado.toString())).toEqual(['140', '130'])
    expect(s.natureza).toBe('CREDORA')
  })

  it('sem movimento: série vazia e saldo final = inicial', async () => {
    prisma.conta.findUnique.mockResolvedValue({ naturezaSaldo: 'DEVEDORA' })
    prisma.movimentoDiarioConta.findMany.mockResolvedValue([])
    const s = await service.serie('ent1', 'c1', 2026)
    expect(s.dias).toEqual([])
    expect(s.saldoFinal.toString()).toBe('100')
  })

  it('filtra o agregado diário pela conta e pelo intervalo do ano', async () => {
    prisma.conta.findUnique.mockResolvedValue({ naturezaSaldo: 'DEVEDORA' })
    prisma.movimentoDiarioConta.findMany.mockResolvedValue([])
    await service.serie('ent1', 'c1', 2026)
    const args = prisma.movimentoDiarioConta.findMany.mock.calls[0]![0]
    expect(args.where).toMatchObject({ entidadeId: 'ent1', contaId: 'c1' })
    expect(args.where.data.gte).toEqual(new Date(Date.UTC(2026, 0, 1)))
    expect(args.where.data.lte).toEqual(new Date(Date.UTC(2026, 11, 31)))
    expect(args.orderBy).toEqual({ data: 'asc' })
  })
})
