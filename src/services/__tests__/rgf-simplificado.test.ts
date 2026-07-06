import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Prisma } from '@prisma/client'

const m = vi.hoisted(() => ({
  rcl: vi.fn(),
  pessoalExec: vi.fn(),
  dcl: vi.fn(),
  totais: vi.fn(),
  disponibilidade: vi.fn(),
}))
vi.mock('../rcl.js', async (orig) => ({
  ...(await orig() as object),
  RclService: class { calcular = m.rcl },
}))
vi.mock('../despesa-pessoal.js', async (orig) => ({
  ...(await orig() as object),
  DespesaPessoalService: class { calcularExecutado = m.pessoalExec },
}))
vi.mock('../dcl.js', () => ({ DclService: class { calcular = m.dcl } }))
vi.mock('../rgf-cadastros.js', () => ({ RgfCadastrosService: class { totais = m.totais } }))
vi.mock('../disponibilidade-fonte.js', () => ({ DisponibilidadeFonteService: class { calcular = m.disponibilidade } }))

import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'
import { RgfSimplificadoService } from '../rgf-simplificado.js'

const dec = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v)

describe('RgfSimplificadoService', () => {
  let prisma: PrismaMock
  let svc: RgfSimplificadoService

  beforeEach(() => {
    prisma = criarPrismaMock()
    svc = new RgfSimplificadoService(prisma as never)
    prisma.entidade.findUnique.mockResolvedValue({ municipio: { estado: { sigla: 'PR', rclComposicao: null, pessoalComposicao: null, modeloContabil: null } } })
    m.rcl.mockReset().mockResolvedValue({ rcl: dec(1000), rclRealizado: dec(700) })
    m.pessoalExec.mockReset().mockResolvedValue({ dtp: 500 })
    m.dcl.mockReset().mockResolvedValue({ dcl: -100 })
    m.totais.mockReset().mockResolvedValue({
      divida: { porCategoria: [], total: 0 },
      garantias: { porTipo: [], total: 50, contragarantias: 0 },
      operacoes: { porTipo: [], sujeitas: 100, aro: 80, naoSujeitas: 0, total: 180 },
    })
    m.disponibilidade.mockReset().mockResolvedValue({ totais: { caixa: 300, rpProcessados: 100, rpNaoProcessados: 40, disponibilidade: 160 } })
  })

  it('compõe as 5 linhas com % da RCL, limites em R$ e níveis', async () => {
    const r = await svc.calcular('e1', 2026, 2)
    expect(r.temOrcamento).toBe(true)
    expect(r.rcl).toBe(1000)
    expect(r.rclRealizada).toBe(700)
    const [dtp, dcl, gar, op, aro] = r.linhas
    // DTP 500/1000 = 50% → alerta (≥48,6)
    expect(dtp).toMatchObject({ valor: 500, pctRcl: 50, limitePct: 54, limiteValor: 540, nivel: 'alerta' })
    // DCL negativa → ok
    expect(dcl).toMatchObject({ valor: -100, pctRcl: -10, limiteValor: 1200, nivel: 'ok' })
    expect(gar).toMatchObject({ valor: 50, pctRcl: 5, limiteValor: 220, nivel: 'ok' })
    expect(op).toMatchObject({ valor: 100, pctRcl: 10, limiteValor: 160, nivel: 'ok' })
    // ARO 80/1000 = 8% ≥ 7% → estouro
    expect(aro).toMatchObject({ valor: 80, pctRcl: 8, limiteValor: 70, nivel: 'estouro' })
  })

  it('bloco de disponibilidade só entra no 3º quadrimestre', async () => {
    const q2 = await svc.calcular('e1', 2026, 2)
    expect(q2.disponibilidade).toBeNull()
    expect(m.disponibilidade).not.toHaveBeenCalled()
    const q3 = await svc.calcular('e1', 2026, 3)
    expect(q3.disponibilidade).toEqual({ caixaLiquida: 200, rpNaoProcessados: 40 }) // 300 − 100
  })

  it('corte do quadrimestre vai para pessoal executado e totais', async () => {
    await svc.calcular('e1', 2026, 1)
    const fimQ1 = m.pessoalExec.mock.calls[0]![3]
    expect(fimQ1.toISOString().slice(0, 10)).toBe('2026-04-30')
    expect(m.totais.mock.calls[0]![2]).toEqual(fimQ1)
  })

  it('sem RCL → temOrcamento false, linhas sem %', async () => {
    m.rcl.mockResolvedValue({ rcl: dec(0), rclRealizado: dec(0) })
    const r = await svc.calcular('e1', 2026, 2)
    expect(r.temOrcamento).toBe(false)
    expect(r.linhas[0]!.pctRcl).toBeNull()
    expect(r.linhas[0]!.limiteValor).toBeNull()
  })
})
