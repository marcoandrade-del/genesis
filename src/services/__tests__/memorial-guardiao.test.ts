import { describe, it, expect, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'
import { MemorialGuardiaoService } from '../memorial-guardiao.js'

const dec = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v)

// despesaFuncoes usa aggregate (por função / total); a Despesa com Pessoal usa
// DespesaPessoalService (findMany das dotações 3.1/terceirização).
const aggPorWhere = ({ where }: { where: { funcao?: { codigo: string } } }) => {
  const v = where.funcao?.codigo === '12' ? 600 : where.funcao?.codigo === '10' ? 800 : 3000
  return Promise.resolve({ _sum: { valorAutorizado: dec(v) } })
}
// dotações de pessoal (DTP) — um único elemento 3.1 com o valor líquido desejado.
const pessoal = (net: number) => [{ valorAutorizado: dec(net), contaDespesa: { codigo: '3.1.90.11.00.00' } }]

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
    prisma.dotacaoDespesa.aggregate.mockImplementation(aggPorWhere as never)
    prisma.dotacaoDespesa.findMany.mockResolvedValue(pessoal(440))
  })

  it('monta RCL + Pessoal + Educação + Saúde (informativos)', async () => {
    const g = await svc.guardiao('e1', 2026)
    const nomes = g!.indicadores.map((i) => i.indicador)
    expect(nomes).toEqual(['Receita Corrente Líquida', 'Despesa com Pessoal', 'Aplicação em Educação', 'Aplicação em Saúde'])
    const p = g!.indicadores[1]!
    expect(p.percentual).toBe(44) // 440/1000
    expect(p.limite).toBe(54)
    const edu = g!.indicadores[2]!
    expect(edu.unidade).toBe('% da despesa')
    expect(edu.limite).toBeNull() // informativo, não o índice constitucional
    expect(edu.percentual).toBe(20) // 600/3000
    expect(g!.indicadores[3]!.percentual).toBeCloseTo(26.7, 1) // 800/3000
  })

  it('escala o nível do Pessoal (alerta/prudencial/estouro)', async () => {
    prisma.dotacaoDespesa.findMany.mockResolvedValue(pessoal(500)) // 50% → alerta
    expect((await svc.guardiao('e1', 2026))!.indicadores[1]!.nivel).toBe('alerta')
    prisma.dotacaoDespesa.findMany.mockResolvedValue(pessoal(520)) // 52% → prudencial
    expect((await svc.guardiao('e1', 2026))!.indicadores[1]!.nivel).toBe('prudencial')
    prisma.dotacaoDespesa.findMany.mockResolvedValue(pessoal(550)) // 55% → estouro
    expect((await svc.guardiao('e1', 2026))!.indicadores[1]!.nivel).toBe('estouro')
  })

  it('sem dotação de pessoal → DTP 0', async () => {
    prisma.dotacaoDespesa.findMany.mockResolvedValue([])
    const g = await svc.guardiao('e1', 2026)
    expect(g!.indicadores[1]!.valor).toBe(0)
    expect(g!.indicadores[1]!.percentual).toBe(0)
  })

  it('orçamento sem receitas correntes → RCL 0, sem Pessoal, mas com Educação/Saúde', async () => {
    prisma.previsaoReceita.findMany.mockResolvedValue([])
    const g = await svc.guardiao('e1', 2026)
    const nomes = g!.indicadores.map((i) => i.indicador)
    expect(nomes).toEqual(['Receita Corrente Líquida', 'Aplicação em Educação', 'Aplicação em Saúde'])
    expect(g!.indicadores[0]!.valor).toBe(0)
  })

  it('despesa total zero → sem indicadores de função', async () => {
    prisma.dotacaoDespesa.aggregate.mockResolvedValue({ _sum: { valorAutorizado: dec(0) } })
    const g = await svc.guardiao('e1', 2026)
    expect(g!.indicadores.map((i) => i.indicador)).toEqual(['Receita Corrente Líquida', 'Despesa com Pessoal'])
  })

  it('orçamento some entre as consultas (defensivo) → pessoal/funções zerados', async () => {
    prisma.orcamento.findUnique.mockReset()
    prisma.orcamento.findUnique.mockResolvedValueOnce({ id: 'o1' }).mockResolvedValue(null)
    const g = await svc.guardiao('e1', 2026)
    expect(g!.indicadores.map((i) => i.indicador)).toEqual(['Receita Corrente Líquida', 'Despesa com Pessoal'])
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
