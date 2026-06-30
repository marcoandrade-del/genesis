import { describe, it, expect, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'
import { DespesaPessoalService, COMPOSICAO_PESSOAL_STN } from '../despesa-pessoal.js'

const dec = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v)

describe('DespesaPessoalService.calcular', () => {
  let prisma: PrismaMock
  let svc: DespesaPessoalService

  beforeEach(() => {
    prisma = criarPrismaMock()
    svc = new DespesaPessoalService(prisma as never)
  })

  it('sem orçamento → vazio (DTP 0), com as linhas zeradas', async () => {
    prisma.orcamento.findUnique.mockResolvedValue(null)
    const r = await svc.calcular('e1', 2026)
    expect(r.temOrcamento).toBe(false)
    expect(r.despesaLiquida).toBe(0)
    expect(r.inclusoes.length).toBe(COMPOSICAO_PESSOAL_STN.inclusoes.length)
  })

  it('DTP = inclusões (3.1 + terceirização 3.3.90.34) − exclusões (indenização/sentença/ex.ant./RPPS)', async () => {
    prisma.orcamento.findUnique.mockResolvedValue({ id: 'o1' })
    prisma.dotacaoDespesa.findMany.mockResolvedValue([
      { valorAutorizado: dec(1000), contaDespesa: { codigo: '3.1.90.11.00.00' } }, // vencimentos (3.1)
      { valorAutorizado: dec(50), contaDespesa: { codigo: '3.1.90.94.00.00' } }, // indenização: 3.1 E exclusão
      { valorAutorizado: dec(20), contaDespesa: { codigo: '3.1.90.91.00.00' } }, // sentença: 3.1 E exclusão
      { valorAutorizado: dec(100), contaDespesa: { codigo: '3.3.90.34.00.00' } }, // terceirização (inclusão)
      { valorAutorizado: dec(999), contaDespesa: { codigo: '4.4.90.51.00.00' } }, // capital — fora
    ])
    const r = await svc.calcular('e1', 2026)
    // inclusões: 3.1 = 1000+50+20 = 1070; terceirização = 100 → total 1170
    expect(r.inclusoesTotal).toBe(1170)
    expect(r.inclusoes[0]!.valor).toBe(1070) // Pessoal e Encargos (3.1)
    expect(r.inclusoes[1]!.valor).toBe(100) // terceirização
    // exclusões: indenização 50 + sentença 20 = 70
    expect(r.exclusoesTotal).toBe(70)
    // DTP = 1170 − 70 = 1100
    expect(r.despesaLiquida).toBe(1100)
  })
})
