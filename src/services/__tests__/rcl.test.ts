import { describe, it, expect, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'
import { RclService } from '../rcl.js'

const dec = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v)

describe('RclService.calcular', () => {
  let prisma: PrismaMock
  let svc: RclService

  beforeEach(() => {
    prisma = criarPrismaMock()
    svc = new RclService(prisma as never)
  })

  it('sem orçamento → vazio (RCL 0)', async () => {
    prisma.orcamento.findUnique.mockResolvedValue(null)
    const r = await svc.calcular('ent1', 2026)
    expect(r.temOrcamento).toBe(false)
    expect(r.rcl.toString()).toBe('0')
    expect(prisma.previsaoReceita.findMany).not.toHaveBeenCalled()
  })

  it('agrega receitas correntes por subcategoria; capital fica fora; RCL = correntes sem deduções', async () => {
    prisma.orcamento.findUnique.mockResolvedValue({ id: 'o1' })
    prisma.previsaoReceita.findMany.mockResolvedValue([
      { valorPrevisto: dec(100), contaReceita: { codigo: '1.1.1.0.00' } },
      { valorPrevisto: dec(50), contaReceita: { codigo: '1.1.2.0.00' } }, // mesma subcategoria 1.1
      { valorPrevisto: dec(300), contaReceita: { codigo: '1.7.1.0.00' } }, // transferências correntes
      { valorPrevisto: dec(999), contaReceita: { codigo: '2.1.0.0.00' } }, // capital — fora da RCL
    ])
    const r = await svc.calcular('ent1', 2026)
    expect(r.correntesTotal.toString()).toBe('450')
    expect(r.correntes.map((l) => [l.codigo, l.valor.toString()])).toEqual([
      ['1.1', '150'],
      ['1.7', '300'],
    ])
    expect(r.correntes[0]!.rotulo).toContain('Impostos')
    expect(r.deducoesTotal.toString()).toBe('0')
    expect(r.rcl.toString()).toBe('450')
  })

  it('usa rótulo genérico para subcategoria fora do mapa STN', async () => {
    prisma.orcamento.findUnique.mockResolvedValue({ id: 'o1' })
    prisma.previsaoReceita.findMany.mockResolvedValue([{ valorPrevisto: dec(10), contaReceita: { codigo: '1.0.0.0.00' } }])
    const r = await svc.calcular('ent1', 2026)
    expect(r.correntes[0]!.rotulo).toBe('Receitas Correntes')
  })

  it('aplica deduções de vários prefixos e agrega linhas do mesmo prefixo', async () => {
    prisma.orcamento.findUnique.mockResolvedValue({ id: 'o1' })
    prisma.previsaoReceita.findMany.mockResolvedValue([
      { valorPrevisto: dec(1000), contaReceita: { codigo: '1.1.1.0.00' } },
      { valorPrevisto: dec(200), contaReceita: { codigo: '1.2.1.8.01' } }, // contribuição p/ RPPS
      { valorPrevisto: dec(50), contaReceita: { codigo: '1.2.1.8.02' } }, // mesmo prefixo (agrega)
      { valorPrevisto: dec(30), contaReceita: { codigo: '1.7.5.0.00' } }, // outro prefixo de dedução
    ])
    const r = await svc.calcular('ent1', 2026, { deducoesPrefixos: ['1.2.1.8', '1.7.5'] })
    expect(r.correntesTotal.toString()).toBe('1280')
    expect(r.deducoesTotal.toString()).toBe('280') // 200+50+30
    expect(r.deducoes.map((l) => [l.codigo, l.valor.toString()])).toEqual([
      ['1.2.1.8', '250'],
      ['1.7.5', '30'],
    ])
    expect(r.rcl.toString()).toBe('1000')
  })
})
