import { describe, it, expect, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'
import { ArrecadacaoDiariaService } from '../arrecadacao-diaria.js'

const dec = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v)
const dia = (d: number) => new Date(Date.UTC(2026, 0, d))

describe('ArrecadacaoDiariaService.serie', () => {
  let prisma: PrismaMock
  let service: ArrecadacaoDiariaService

  beforeEach(() => {
    prisma = criarPrismaMock()
    service = new ArrecadacaoDiariaService(prisma as never)
  })

  it('sem orçamento: temOrcamento false e série vazia', async () => {
    prisma.orcamento.findUnique.mockResolvedValue(null)
    const s = await service.serie('ent1', 2026)
    expect(s).toMatchObject({ temOrcamento: false, dias: [] })
    expect(prisma.arrecadacao.groupBy).not.toHaveBeenCalled()
  })

  it('acumula o líquido diário (estorno subtrai) e ordena por data', async () => {
    prisma.orcamento.findUnique.mockResolvedValue({ id: 'orc1' })
    prisma.previsaoReceita.aggregate.mockResolvedValue({ _sum: { valorPrevisto: dec(1000) } })
    prisma.arrecadacao.groupBy.mockResolvedValue([
      { data: dia(5), tipo: 'ARRECADACAO', _sum: { valor: dec(200) } },
      { data: dia(2), tipo: 'ARRECADACAO', _sum: { valor: dec(300) } },
      { data: dia(5), tipo: 'ESTORNO', _sum: { valor: dec(50) } },
    ])
    const s = await service.serie('ent1', 2026)
    expect(s.temOrcamento).toBe(true)
    expect(s.previstoTotal.toString()).toBe('1000')
    expect(s.dias.map((d) => [d.data.getUTCDate(), d.arrecadadoDia.toString(), d.arrecadadoAcumulado.toString()])).toEqual([
      [2, '300', '300'],
      [5, '150', '450'], // 200 − 50 = 150 ; acumulado 300 + 150 = 450
    ])
    expect(s.arrecadadoTotal.toString()).toBe('450')
  })

  it('previsto ausente vira zero; escopa as arrecadações ao orçamento', async () => {
    prisma.orcamento.findUnique.mockResolvedValue({ id: 'orc1' })
    prisma.previsaoReceita.aggregate.mockResolvedValue({ _sum: { valorPrevisto: null } })
    prisma.arrecadacao.groupBy.mockResolvedValue([])
    const s = await service.serie('ent1', 2026)
    expect(s.previstoTotal.toString()).toBe('0')
    expect(s.dias).toEqual([])
    const args = prisma.arrecadacao.groupBy.mock.calls[0]![0]
    expect(args.where).toEqual({ previsao: { orcamentoId: 'orc1' } })
    expect(args.by).toEqual(['data', 'tipo'])
  })
})
