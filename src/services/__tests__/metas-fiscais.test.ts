import { describe, it, expect, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'
import { MetasFiscaisService, ROTULO_META, TIPOS_META } from '../metas-fiscais.js'

const dec = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v)

const meta = (tipo: string, valorMeta: number, exercicioReferencia = 2025) => ({
  id: `m-${tipo}`,
  tipo,
  valorMeta: dec(valorMeta),
  exercicioReferencia,
})

describe('MetasFiscaisService.comparativo', () => {
  let prisma: PrismaMock
  let svc: MetasFiscaisService

  beforeEach(() => {
    prisma = criarPrismaMock()
    svc = new MetasFiscaisService(prisma as never)
    prisma.orcamento.findUnique.mockResolvedValue({ id: 'o1' })
    prisma.previsaoReceita.aggregate.mockResolvedValue({ _sum: { valorPrevisto: dec(3170) } })
    prisma.dotacaoDespesa.aggregate.mockResolvedValue({ _sum: { valorAutorizado: dec(2842) } })
  })

  it('sem metas → temMetas=false', async () => {
    prisma.metaFiscal.findMany.mockResolvedValue([])
    const r = await svc.comparativo('e1', 2026)
    expect(r.temMetas).toBe(false)
    expect(r.linhas).toEqual([])
  })

  it('receita/despesa comparam com o projetado da LOA; resultado primário fica sem projeção', async () => {
    prisma.metaFiscal.findMany.mockResolvedValue([
      meta('RECEITA_TOTAL', 3000),
      meta('DESPESA_TOTAL', 2900),
      meta('RESULTADO_PRIMARIO', 100),
    ])
    const r = await svc.comparativo('e1', 2026)
    expect(r.temMetas).toBe(true)
    const [rec, desp, prim] = r.linhas
    expect(rec).toMatchObject({ rotulo: 'Receita Total', valorMeta: 3000, projetado: 3170, diferenca: 170 })
    expect(desp).toMatchObject({ valorMeta: 2900, projetado: 2842, diferenca: -58 })
    expect(prim).toMatchObject({ rotulo: 'Resultado Primário', projetado: null, diferenca: null })
  })

  it('sem orçamento no ano → projeções null (só a meta)', async () => {
    prisma.orcamento.findUnique.mockResolvedValue(null)
    prisma.metaFiscal.findMany.mockResolvedValue([meta('RECEITA_TOTAL', 3000)])
    const r = await svc.comparativo('e1', 2026)
    expect(r.linhas[0]!.projetado).toBeNull()
    expect(r.linhas[0]!.diferenca).toBeNull()
  })
})

describe('MetasFiscaisService CRUD (delegate fino)', () => {
  it('criar/atualizar/excluir delegam ao prisma', async () => {
    const prisma = criarPrismaMock()
    const svc = new MetasFiscaisService(prisma as never)
    await svc.criar({ entidadeId: 'e1', ano: 2026, tipo: 'RECEITA_TOTAL' as never, valorMeta: 10, exercicioReferencia: 2025 })
    expect(prisma.metaFiscal.create).toHaveBeenCalledWith({
      data: { entidadeId: 'e1', ano: 2026, tipo: 'RECEITA_TOTAL', valorMeta: 10, exercicioReferencia: 2025 },
    })
    await svc.atualizar('m1', { valorMeta: 20, exercicioReferencia: 2025 })
    expect(prisma.metaFiscal.update).toHaveBeenCalledWith({ where: { id: 'm1' }, data: { valorMeta: 20, exercicioReferencia: 2025 } })
    await svc.excluir('m1')
    expect(prisma.metaFiscal.delete).toHaveBeenCalledWith({ where: { id: 'm1' } })
  })
})

describe('ROTULO_META', () => {
  it('cobre os 5 tipos', () => {
    expect(TIPOS_META).toHaveLength(5)
    expect(ROTULO_META.DIVIDA_CONSOLIDADA_LIQUIDA).toBe('Dívida Consolidada Líquida')
  })
})
