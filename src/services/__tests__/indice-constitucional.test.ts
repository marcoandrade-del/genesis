import { describe, it, expect, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'
import {
  IndiceConstitucionalService,
  COMPOSICAO_INDICES_POR_ESTADO,
  composicaoIndicesDoEstado,
  COMPOSICAO_INDICES_STN,
} from '../indice-constitucional.js'

const dec = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v)
const PR = COMPOSICAO_INDICES_POR_ESTADO.PR!

describe('IndiceConstitucionalService.calcular', () => {
  let prisma: PrismaMock
  let svc: IndiceConstitucionalService

  beforeEach(() => {
    prisma = criarPrismaMock()
    svc = new IndiceConstitucionalService(prisma as never)
    prisma.orcamento.findUnique.mockResolvedValue({ id: 'o1' })
    // base: impostos 1000 + FPM 200 + ICMS 300 = 1500; CIDE (1.7.2.1.53) fica fora
    prisma.previsaoReceita.findMany.mockResolvedValue([
      { valorPrevisto: dec(1000), contaReceita: { codigo: '1.1.1.4.51.1.1' } }, // ISS
      { valorPrevisto: dec(200), contaReceita: { codigo: '1.7.1.1.51.1.1' } }, // FPM
      { valorPrevisto: dec(300), contaReceita: { codigo: '1.7.2.1.50.1.1' } }, // ICMS
      { valorPrevisto: dec(99), contaReceita: { codigo: '1.7.2.1.53.1.1' } }, // CIDE — fora
      { valorPrevisto: dec(500), contaReceita: { codigo: '1.3.2.1.00.1.1' } }, // patrimonial — fora
    ])
    prisma.dotacaoDespesa.findMany.mockResolvedValue([
      { valorAutorizado: dec(300), funcao: { codigo: '12' }, fonteRecurso: { codigo: '1104' } }, // MDE
      { valorAutorizado: dec(150), funcao: { codigo: '12' }, fonteRecurso: { codigo: '1101' } }, // FUNDEB
      { valorAutorizado: dec(80), funcao: { codigo: '12' }, fonteRecurso: { codigo: '1107' } }, // salário-educação — fora
      { valorAutorizado: dec(240), funcao: { codigo: '10' }, fonteRecurso: { codigo: '1303' } }, // ASPS próprios
      { valorAutorizado: dec(500), funcao: { codigo: '10' }, fonteRecurso: { codigo: '1486' } }, // SUS federal — fora
      { valorAutorizado: dec(999), funcao: { codigo: '04' }, fonteRecurso: { codigo: '1104' } }, // outra função — fora
    ])
  })

  it('sem orçamento → vazio (índices zerados, não atende)', async () => {
    prisma.orcamento.findUnique.mockResolvedValue(null)
    const r = await svc.calcular('e1', 2026, PR)
    expect(r.temOrcamento).toBe(false)
    expect(r.baseTotal).toBe(0)
    expect(r.mde.atende).toBe(false)
    expect(r.mde.minimo).toBe(25)
    expect(r.asps.minimo).toBe(15)
  })

  it('base = impostos + cotas constitucionais, aberta por regra; CIDE e patrimonial fora', async () => {
    const r = await svc.calcular('e1', 2026, PR)
    expect(r.baseTotal).toBe(1500)
    expect(r.base.map((l) => l.valor)).toEqual([1000, 200, 300])
  })

  it('MDE = função 12 × fontes MDE+FUNDEB ÷ base (salário-educação fora)', async () => {
    const r = await svc.calcular('e1', 2026, PR)
    expect(r.mde.total).toBe(450) // 300 + 150; 1107 e função 04 fora
    expect(r.mde.percentual).toBe(30) // 450/1500
    expect(r.mde.atende).toBe(true)
    expect(r.mde.linhas).toEqual([
      { rotulo: 'Fonte 1104', valor: 300 },
      { rotulo: 'Fonte 1101', valor: 150 },
    ])
  })

  it('ASPS = função 10 × fonte de recursos próprios ÷ base (SUS federal fora)', async () => {
    const r = await svc.calcular('e1', 2026, PR)
    expect(r.asps.total).toBe(240)
    expect(r.asps.percentual).toBe(16) // 240/1500
    expect(r.asps.atende).toBe(true)
  })

  it('abaixo do mínimo → atende=false', async () => {
    prisma.dotacaoDespesa.findMany.mockResolvedValue([
      { valorAutorizado: dec(100), funcao: { codigo: '10' }, fonteRecurso: { codigo: '1303' } }, // 6,67% < 15%
    ])
    const r = await svc.calcular('e1', 2026, PR)
    expect(r.asps.percentual).toBeCloseTo(6.67, 2)
    expect(r.asps.atende).toBe(false)
    expect(r.mde.total).toBe(0)
    expect(r.mde.atende).toBe(false)
  })

  it('base zerada → percentual 0 sem divisão por zero', async () => {
    prisma.previsaoReceita.findMany.mockResolvedValue([])
    const r = await svc.calcular('e1', 2026, PR)
    expect(r.baseTotal).toBe(0)
    expect(r.mde.percentual).toBe(0)
    expect(r.mde.atende).toBe(false)
  })
})

describe('composicaoIndicesDoEstado', () => {
  it('PR tem delta; sem delta cai na STN', () => {
    expect(composicaoIndicesDoEstado('PR')).toBe(PR)
    expect(composicaoIndicesDoEstado('SP')).toBe(COMPOSICAO_INDICES_STN)
    expect(composicaoIndicesDoEstado(null)).toBe(COMPOSICAO_INDICES_STN)
  })
})
