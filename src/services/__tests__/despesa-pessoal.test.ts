import { describe, it, expect, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'
import { DespesaPessoalService, COMPOSICAO_PESSOAL_STN, parsePessoal, resolverComposicaoPessoal } from '../despesa-pessoal.js'

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

describe('DespesaPessoalService.calcularExecutado', () => {
  let prisma: PrismaMock
  let svc: DespesaPessoalService

  beforeEach(() => {
    prisma = criarPrismaMock()
    svc = new DespesaPessoalService(prisma as never)
  })

  const mov = (tipo: string, valor: number, mesUtc: number, codigo: string) => ({
    tipo,
    valor: dec(valor),
    data: new Date(Date.UTC(2026, mesUtc - 1, 15)),
    empenho: { dotacaoDespesa: { contaDespesa: { codigo } } },
  })

  it('sem movimentos → temExecucao false, DTP 0', async () => {
    prisma.movimentoEmpenho.findMany.mockResolvedValue([])
    const r = await svc.calcularExecutado('e1', 2026)
    expect(r.temExecucao).toBe(false)
    expect(r.dtp).toBe(0)
    expect(r.ultimoMesComDado).toBe(0)
  })

  it('soma liquidações por mês, desconta estornos e aplica as exclusões', async () => {
    prisma.movimentoEmpenho.findMany.mockResolvedValue([
      mov('LIQUIDACAO', 1000, 1, '3.1.90.11.00.00'), // jan
      mov('LIQUIDACAO', 500, 2, '3.1.90.11.00.00'), // fev
      mov('ESTORNO_LIQUIDACAO', 100, 2, '3.1.90.11.00.00'), // fev: −100
      mov('LIQUIDACAO', 80, 3, '3.3.90.34.00.00'), // terceirização mar
      mov('LIQUIDACAO', 50, 3, '3.1.90.94.00.00'), // indenização: inclusão 3.1 E exclusão
      mov('LIQUIDACAO', 999, 4, '4.4.90.51.00.00'), // capital — fora
    ])
    const r = await svc.calcularExecutado('e1', 2026)
    expect(r.temExecucao).toBe(true)
    // Pessoal 3.1: jan 1000, fev 400, mar 50 → 1450; terceirização mar 80
    expect(r.inclusoes[0]!.mensal[0]).toBe(1000)
    expect(r.inclusoes[0]!.mensal[1]).toBe(400)
    expect(r.inclusoes[0]!.total).toBe(1450)
    expect(r.inclusoes[1]!.mensal[2]).toBe(80)
    expect(r.inclusoesTotal).toBe(1530)
    // exclusão: indenização 50
    expect(r.exclusoesTotal).toBe(50)
    expect(r.dtp).toBe(1480)
    expect(r.ultimoMesComDado).toBe(3) // capital de abril não conta
  })

  it('passa o corte do quadrimestre para a query (lte fimPeriodo)', async () => {
    prisma.movimentoEmpenho.findMany.mockResolvedValue([])
    const fim = new Date(Date.UTC(2026, 3, 30))
    await svc.calcularExecutado('e1', 2026, COMPOSICAO_PESSOAL_STN, fim)
    const where = prisma.movimentoEmpenho.findMany.mock.calls[0]![0]!.where
    expect(where.data.lte).toEqual(fim)
    expect(where.tipo.in).toEqual(['LIQUIDACAO', 'ESTORNO_LIQUIDACAO'])
  })
})

describe('parsePessoal', () => {
  it('aceita JSON válido (nome + inclusões + exclusões)', () => {
    const c = parsePessoal({ nome: 'X', inclusoes: [{ rotulo: 'P', prefixos: ['3.1'] }], exclusoes: [{ rotulo: 'I', prefixos: ['3.1.90.94'] }] })
    expect(c).toEqual({ nome: 'X', inclusoes: [{ rotulo: 'P', prefixos: ['3.1'] }], exclusoes: [{ rotulo: 'I', prefixos: ['3.1.90.94'] }] })
  })
  it('nome genérico quando ausente; filtra prefixo não-string; exclusões default []', () => {
    const c = parsePessoal({ inclusoes: [{ rotulo: 'P', prefixos: ['3.1', 7, ' '] }] })
    expect(c!.nome).toContain('Personalizada')
    expect(c!.inclusoes).toEqual([{ rotulo: 'P', prefixos: ['3.1'] }])
    expect(c!.exclusoes).toEqual([])
  })
  it('retorna null para inválido/sem inclusões', () => {
    expect(parsePessoal(null)).toBeNull()
    expect(parsePessoal('x')).toBeNull()
    expect(parsePessoal({ inclusoes: [] })).toBeNull()
    expect(parsePessoal({ exclusoes: [{ rotulo: 'I', prefixos: ['3.1'] }] })).toBeNull() // sem inclusões
  })
})

describe('resolverComposicaoPessoal (3 níveis: Estado > Modelo > default)', () => {
  const est = { nome: 'Estado', inclusoes: [{ rotulo: 'E', prefixos: ['3.1'] }], exclusoes: [] }
  const mod = { nome: 'Modelo', inclusoes: [{ rotulo: 'M', prefixos: ['3.1'] }], exclusoes: [] }
  it('override do Estado tem prioridade', () => {
    expect(resolverComposicaoPessoal('PR', est, mod).nome).toBe('Estado')
  })
  it('sem Estado, usa o Modelo', () => {
    expect(resolverComposicaoPessoal('PR', null, mod).nome).toBe('Modelo')
  })
  it('sem Estado nem Modelo, cai no default do código', () => {
    expect(resolverComposicaoPessoal('PR', null)).toBe(COMPOSICAO_PESSOAL_STN)
    expect(resolverComposicaoPessoal(null, null, null)).toBe(COMPOSICAO_PESSOAL_STN)
  })
})
