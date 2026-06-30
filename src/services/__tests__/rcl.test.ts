import { describe, it, expect, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'
import { RclService, composicaoDoEstado, resolverComposicao, parseComposicao, COMPOSICAO_STN } from '../rcl.js'

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

  it('aplica deduções nomeadas (cada linha soma suas naturezas)', async () => {
    prisma.orcamento.findUnique.mockResolvedValue({ id: 'o1' })
    prisma.previsaoReceita.findMany.mockResolvedValue([
      { valorPrevisto: dec(1000), contaReceita: { codigo: '1.1.1.0.00' } },
      { valorPrevisto: dec(200), contaReceita: { codigo: '1.2.1.8.01' } }, // RPPS
      { valorPrevisto: dec(50), contaReceita: { codigo: '1.2.1.8.02' } }, // RPPS (agrega)
      { valorPrevisto: dec(30), contaReceita: { codigo: '1.7.5.1.50' } }, // FUNDEB
    ])
    const r = await svc.calcular('ent1', 2026, {
      deducoes: [
        { rotulo: 'Contribuição RPPS', prefixos: ['1.2.1.8'] },
        { rotulo: 'FUNDEB', prefixos: ['1.7.5'] },
      ],
    })
    expect(r.correntesTotal.toString()).toBe('1280')
    expect(r.deducoes.map((l) => [l.rotulo, l.valor.toString()])).toEqual([
      ['Contribuição RPPS', '250'],
      ['FUNDEB', '30'],
    ])
    expect(r.deducoesTotal.toString()).toBe('280')
    expect(r.rcl.toString()).toBe('1000')
  })

  it('composição STN default tem as 3 deduções nomeadas, zeradas sem dados', async () => {
    prisma.orcamento.findUnique.mockResolvedValue({ id: 'o1' })
    prisma.previsaoReceita.findMany.mockResolvedValue([{ valorPrevisto: dec(500), contaReceita: { codigo: '1.1.1.0.00' } }])
    const r = await svc.calcular('ent1', 2026)
    expect(r.deducoes).toHaveLength(3)
    expect(r.deducoesTotal.toString()).toBe('0')
    expect(r.rcl.toString()).toBe('500')
  })

  it('composição do PR deduz o FUNDEB recebido (1.7.5.1.50)', async () => {
    prisma.orcamento.findUnique.mockResolvedValue({ id: 'o1' })
    prisma.previsaoReceita.findMany.mockResolvedValue([
      { valorPrevisto: dec(1000), contaReceita: { codigo: '1.1.1.0.00' } },
      { valorPrevisto: dec(277), contaReceita: { codigo: '1.7.5.1.50.0.1.01' } }, // FUNDEB recebido
    ])
    const r = await svc.calcular('ent1', 2026, composicaoDoEstado('PR'))
    const fundeb = r.deducoes.find((l) => l.rotulo.includes('FUNDEB'))!
    expect(fundeb.valor.toString()).toBe('277')
    expect(r.deducoesTotal.toString()).toBe('277')
    expect(r.rcl.toString()).toBe('1000') // correntes 1277 − FUNDEB 277
  })

  it('RCL EXECUTADA: soma o arrecadado ao lado do previsto (correntes − deduções)', async () => {
    prisma.orcamento.findUnique.mockResolvedValue({ id: 'o1' })
    prisma.previsaoReceita.findMany.mockResolvedValue([
      { valorPrevisto: dec(1000), valorArrecadado: dec(600), contaReceita: { codigo: '1.1.1.0.00' } },
      { valorPrevisto: dec(277), valorArrecadado: dec(100), contaReceita: { codigo: '1.7.5.1.50.0.1.01' } }, // FUNDEB
    ])
    const r = await svc.calcular('ent1', 2026, composicaoDoEstado('PR'))
    // previsto: correntes 1277 − FUNDEB 277 = 1000
    expect(r.rcl.toString()).toBe('1000')
    // realizado: correntes 700 − FUNDEB 100 = 600
    expect(r.correntesRealizadoTotal.toString()).toBe('700')
    expect(r.deducoesRealizadoTotal.toString()).toBe('100')
    expect(r.rclRealizado.toString()).toBe('600')
    const fundeb = r.deducoes.find((l) => l.rotulo.includes('FUNDEB'))!
    expect(fundeb.valorRealizado.toString()).toBe('100')
    // correntes[0] = subcategoria 1.1 (só a previsão 1, arrecadado 600); 1.7 entra separada com 100
    expect(r.correntes[0]!.valorRealizado.toString()).toBe('600')
  })
})

describe('composicaoDoEstado', () => {
  it('PR retorna a composição do TCE-PR', () => {
    expect(composicaoDoEstado('PR').nome).toContain('TCE-PR')
  })
  it('Estado sem delta (ou nulo) cai na STN', () => {
    expect(composicaoDoEstado('SP')).toBe(COMPOSICAO_STN)
    expect(composicaoDoEstado(null)).toBe(COMPOSICAO_STN)
  })
})

describe('parseComposicao', () => {
  it('aceita JSON válido (nome + deduções)', () => {
    const c = parseComposicao({ nome: 'TCE-PR', deducoes: [{ rotulo: 'FUNDEB', prefixos: ['1.7.5.1.50'] }] })
    expect(c).toEqual({ nome: 'TCE-PR', deducoes: [{ rotulo: 'FUNDEB', prefixos: ['1.7.5.1.50'] }] })
  })
  it('nome genérico quando ausente; descarta inválidas; rótulo sem prefixos vira []; filtra prefixos não-string', () => {
    const c = parseComposicao({ deducoes: [{ rotulo: '  ' }, 'lixo', { rotulo: 'Z' }, { rotulo: 'Y', prefixos: ['a', 5, 'b'] }] })
    expect(c!.nome).toContain('Personalizada')
    expect(c!.deducoes).toEqual([
      { rotulo: 'Z', prefixos: [] },
      { rotulo: 'Y', prefixos: ['a', 'b'] },
    ])
  })
  it('retorna null para inválido/vazio', () => {
    expect(parseComposicao(null)).toBeNull()
    expect(parseComposicao('x')).toBeNull()
    expect(parseComposicao({ deducoes: 'nope' })).toBeNull()
    expect(parseComposicao({ deducoes: [{ rotulo: '' }] })).toBeNull()
  })
})

describe('resolverComposicao', () => {
  it('config do banco tem prioridade sobre o default', () => {
    const c = resolverComposicao('PR', { deducoes: [{ rotulo: 'Custom', prefixos: [] }] })
    expect(c.deducoes[0]!.rotulo).toBe('Custom')
  })
  it('sem config cai no default do Estado/STN', () => {
    expect(resolverComposicao('PR', null).nome).toContain('TCE-PR')
    expect(resolverComposicao('SP', null)).toBe(COMPOSICAO_STN)
  })
})
