import { describe, it, expect, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'
import { MemorialGuardiaoService } from '../memorial-guardiao.js'

const dec = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v)

describe('MemorialGuardiaoService', () => {
  let prisma: PrismaMock
  let svc: MemorialGuardiaoService

  beforeEach(() => {
    prisma = criarPrismaMock()
    svc = new MemorialGuardiaoService(prisma as never)
    prisma.entidade.findUnique.mockResolvedValue({
      id: 'e1',
      nome: 'Prefeitura',
      municipio: { nome: 'Maringá', estado: { sigla: 'PR', rclComposicao: null } },
    })
    prisma.orcamento.findUnique.mockResolvedValue({ id: 'o1' })
    prisma.previsaoReceita.findMany.mockResolvedValue([{ valorPrevisto: dec(1000), contaReceita: { codigo: '1.1.1.0.00' } }])
  })

  it('monta RCL + Despesa com Pessoal (% RCL) com memorial e nível', async () => {
    prisma.dotacaoDespesa.aggregate.mockResolvedValue({ _sum: { valorAutorizado: dec(440) } })
    const g = await svc.guardiao('e1', 2026)
    expect(g!.indicadores).toHaveLength(2)
    const [rcl, pessoal] = g!.indicadores
    expect(rcl!.indicador).toBe('Receita Corrente Líquida')
    expect(rcl!.limite).toBeNull()
    expect(rcl!.valor).toBe(1000)
    expect(pessoal!.indicador).toBe('Despesa com Pessoal')
    expect(pessoal!.valor).toBe(440)
    expect(pessoal!.percentual).toBe(44)
    expect(pessoal!.limite).toBe(54)
    expect(pessoal!.nivel).toBe('ok')
    expect(pessoal!.memorial.linhas).toHaveLength(2)
  })

  it('escala o nível conforme o percentual (alerta/prudencial/estouro)', async () => {
    prisma.dotacaoDespesa.aggregate
      .mockResolvedValueOnce({ _sum: { valorAutorizado: dec(500) } }) // 50% → alerta (>=48,6)
      .mockResolvedValueOnce({ _sum: { valorAutorizado: dec(520) } }) // 52% → prudencial (>=51,3)
      .mockResolvedValueOnce({ _sum: { valorAutorizado: dec(550) } }) // 55% → estouro (>=54)
    expect((await svc.guardiao('e1', 2026))!.indicadores[1]!.nivel).toBe('alerta')
    expect((await svc.guardiao('e1', 2026))!.indicadores[1]!.nivel).toBe('prudencial')
    expect((await svc.guardiao('e1', 2026))!.indicadores[1]!.nivel).toBe('estouro')
  })

  it('sem dotação de pessoal (sum nulo) → pessoal 0', async () => {
    prisma.dotacaoDespesa.aggregate.mockResolvedValue({ _sum: { valorAutorizado: null } })
    const g = await svc.guardiao('e1', 2026)
    expect(g!.indicadores[1]!.valor).toBe(0)
    expect(g!.indicadores[1]!.percentual).toBe(0)
  })

  it('orçamento sem receitas correntes → RCL 0 e sem indicador de pessoal', async () => {
    prisma.previsaoReceita.findMany.mockResolvedValue([])
    const g = await svc.guardiao('e1', 2026)
    expect(g!.indicadores).toHaveLength(1) // só RCL
    expect(g!.indicadores[0]!.valor).toBe(0)
    expect(g!.indicadores[0]!.percentual).toBe(0)
  })

  it('RCL com orçamento mas pessoal sem orçamento (defensivo) → pessoal 0', async () => {
    prisma.orcamento.findUnique.mockReset()
    prisma.orcamento.findUnique.mockResolvedValueOnce({ id: 'o1' }) // RclService acha
    prisma.orcamento.findUnique.mockResolvedValue(null) // pessoalAutorizado não acha
    const g = await svc.guardiao('e1', 2026)
    expect(g!.indicadores[1]!.valor).toBe(0)
  })

  it('sem orçamento → sem indicadores', async () => {
    prisma.orcamento.findUnique.mockResolvedValue(null)
    const g = await svc.guardiao('e1', 2026)
    expect(g!.temOrcamento).toBe(false)
    expect(g!.indicadores).toEqual([])
  })

  it('entidade inexistente → null', async () => {
    prisma.entidade.findUnique.mockResolvedValue(null)
    expect(await svc.guardiao('x', 2026)).toBeNull()
  })
})
