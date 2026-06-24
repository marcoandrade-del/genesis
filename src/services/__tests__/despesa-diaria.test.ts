import { describe, it, expect, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'
import { DespesaDiariaService } from '../despesa-diaria.js'

const dec = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v)
const dia = (d: number) => new Date(Date.UTC(2026, 0, d))

describe('DespesaDiariaService.serie', () => {
  let prisma: PrismaMock
  let service: DespesaDiariaService

  beforeEach(() => {
    prisma = criarPrismaMock()
    service = new DespesaDiariaService(prisma as never)
  })

  it('sem orçamento: temOrcamento false e série vazia', async () => {
    prisma.orcamento.findUnique.mockResolvedValue(null)
    const s = await service.serie('ent1', 2026)
    expect(s).toMatchObject({ temOrcamento: false, dias: [] })
    expect(prisma.movimentoEmpenho.groupBy).not.toHaveBeenCalled()
  })

  it('acumula cada fase (estorno subtrai) independente e ordena por data', async () => {
    prisma.orcamento.findUnique.mockResolvedValue({ id: 'orc1' })
    prisma.dotacaoDespesa.aggregate.mockResolvedValue({ _sum: { valorAutorizado: dec(1000) } })
    prisma.movimentoEmpenho.groupBy.mockResolvedValue([
      { data: dia(5), tipo: 'EMPENHO', _sum: { valor: dec(200) } },
      { data: dia(2), tipo: 'EMPENHO', _sum: { valor: dec(300) } },
      { data: dia(5), tipo: 'ESTORNO_EMPENHO', _sum: { valor: dec(50) } },
      { data: dia(5), tipo: 'LIQUIDACAO', _sum: { valor: dec(120) } },
      { data: dia(5), tipo: 'PAGAMENTO', _sum: { valor: dec(80) } },
    ])
    const s = await service.serie('ent1', 2026)
    expect(s.temOrcamento).toBe(true)
    expect(s.fixadoTotal.toString()).toBe('1000')
    expect(
      s.dias.map((d) => [
        d.data.getUTCDate(),
        d.empenhadoDia.toString(),
        d.empenhadoAcumulado.toString(),
        d.liquidadoAcumulado.toString(),
        d.pagoAcumulado.toString(),
      ]),
    ).toEqual([
      [2, '300', '300', '0', '0'],
      [5, '150', '450', '120', '80'], // empenho 200 − estorno 50 = 150; acumulado 300 + 150 = 450
    ])
    expect(s.empenhadoTotal.toString()).toBe('450')
    expect(s.liquidadoTotal.toString()).toBe('120')
    expect(s.pagoTotal.toString()).toBe('80')
  })

  it('fixado ausente vira zero; escopa os movimentos ao orçamento', async () => {
    prisma.orcamento.findUnique.mockResolvedValue({ id: 'orc1' })
    prisma.dotacaoDespesa.aggregate.mockResolvedValue({ _sum: { valorAutorizado: null } })
    prisma.movimentoEmpenho.groupBy.mockResolvedValue([])
    const s = await service.serie('ent1', 2026)
    expect(s.fixadoTotal.toString()).toBe('0')
    expect(s.dias).toEqual([])
    const args = prisma.movimentoEmpenho.groupBy.mock.calls[0]![0]
    expect(args.where).toEqual({ empenho: { dotacaoDespesa: { orcamentoId: 'orc1' } } })
    expect(args.by).toEqual(['data', 'tipo'])
  })
})
