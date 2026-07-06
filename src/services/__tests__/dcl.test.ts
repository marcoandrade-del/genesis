import { describe, it, expect, beforeEach, vi } from 'vitest'

const m = vi.hoisted(() => ({ totais: vi.fn(), disponibilidade: vi.fn() }))
vi.mock('../rgf-cadastros.js', () => ({
  RgfCadastrosService: class { totais = m.totais },
}))
vi.mock('../disponibilidade-fonte.js', () => ({
  DisponibilidadeFonteService: class { calcular = m.disponibilidade },
}))

import { Prisma } from '@prisma/client'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'
import { DclService } from '../dcl.js'

const dec = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v)

const TOTAIS = (dividaTotal: number) => ({
  divida: {
    porCategoria: [
      { categoria: 'DEMAIS', rotulo: 'Demais dívidas', total: dividaTotal },
    ],
    total: dividaTotal,
  },
  garantias: { porTipo: [], total: 0, contragarantias: 0 },
  operacoes: { sujeitas: 0, aro: 0, naoSujeitas: 0, total: 0 },
})

describe('DclService', () => {
  let prisma: PrismaMock
  let svc: DclService

  beforeEach(() => {
    prisma = criarPrismaMock()
    svc = new DclService(prisma as never)
    m.totais.mockReset()
    m.disponibilidade.mockReset()
    prisma.metaFiscal.findUnique.mockResolvedValue(null)
  })

  it('DCL = dívida (I) − (caixa − RP processados) (II)', async () => {
    m.totais.mockResolvedValue(TOTAIS(544.32))
    m.disponibilidade.mockResolvedValue({ totais: { caixa: 1083.94, rpProcessados: 50, rpNaoProcessados: 0, disponibilidade: 0 } })
    const r = await svc.calcular('e1', 2026)
    expect(r.dividaTotal).toBe(544.32)
    expect(r.deducoes.total).toBe(1033.94) // 1083.94 − 50
    expect(r.dcl).toBe(-489.62) // 544.32 − 1033.94
    expect(r.temDivida).toBe(true)
  })

  it('cadastro vazio → DCL = −deduções (comportamento honesto), temDivida false', async () => {
    m.totais.mockResolvedValue(TOTAIS(0))
    m.disponibilidade.mockResolvedValue({ totais: { caixa: 100, rpProcessados: 0, rpNaoProcessados: 0, disponibilidade: 0 } })
    const r = await svc.calcular('e1', 2026)
    expect(r.dcl).toBe(-100)
    expect(r.temDivida).toBe(false)
  })

  it('traz a DCL informada na LDO como comparativo (nunca como fonte)', async () => {
    m.totais.mockResolvedValue(TOTAIS(544.32))
    m.disponibilidade.mockResolvedValue({ totais: { caixa: 0, rpProcessados: 0, rpNaoProcessados: 0, disponibilidade: 0 } })
    prisma.metaFiscal.findUnique.mockResolvedValue({ valorMeta: dec(-539.62) })
    const r = await svc.calcular('e1', 2026)
    expect(r.metaLdo).toBe(-539.62)
    expect(r.dcl).toBe(544.32) // cálculo não usa a meta
    expect(prisma.metaFiscal.findUnique).toHaveBeenCalledWith({
      where: { entidadeId_ano_tipo: { entidadeId: 'e1', ano: 2026, tipo: 'DIVIDA_CONSOLIDADA_LIQUIDA' } },
      select: { valorMeta: true },
    })
  })
})
