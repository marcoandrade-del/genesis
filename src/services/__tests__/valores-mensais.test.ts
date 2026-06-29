import { describe, it, expect, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'
import { ValoresMensaisService } from '../valores-mensais.js'

const dec = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v)
const ENTIDADE = { id: 'ent1', nome: 'Prefeitura', municipio: { estado: { sigla: 'PR' } } }

describe('ValoresMensaisService.receita', () => {
  let prisma: PrismaMock
  let svc: ValoresMensaisService
  beforeEach(() => {
    prisma = criarPrismaMock()
    svc = new ValoresMensaisService(prisma as never)
  })

  it('entidade inexistente → null', async () => {
    prisma.entidade.findUnique.mockResolvedValue(null)
    expect(await svc.receita('ent1', 2026)).toBeNull()
  })

  it('sem orçamento → contas vazias (mas com entidade)', async () => {
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    prisma.orcamento.findUnique.mockResolvedValue(null)
    const r = await svc.receita('ent1', 2026)
    expect(r?.entidade).toEqual({ id: 'ent1', nome: 'Prefeitura', estado: 'PR' })
    expect(r?.contas).toEqual([])
  })

  it('contas por conta×fonte: arrecadado mensal (− estorno), orcado, natureza, origem, fonte', async () => {
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    prisma.orcamento.findUnique.mockResolvedValue({ id: 'o1' })
    prisma.contaReceitaEntidade.findMany.mockResolvedValue([
      { id: 'c1', descricao: 'RECEITAS CORRENTES', nivel: 1, parentId: null },
      { id: 'c11', descricao: 'Impostos, Taxas e Contrib.', nivel: 2, parentId: 'c1' },
      { id: 'c111', descricao: 'ISS', nivel: 3, parentId: 'c11' },
    ])
    prisma.previsaoReceita.findMany.mockResolvedValue([
      { contaReceitaEntidadeId: 'c111', fonteRecursoEntidadeId: 'f1', valorPrevisto: dec(1000), contaReceita: { codigo: '1.1.1', descricao: 'ISS' }, fonteRecurso: { codigo: '1000', nomenclatura: 'Recursos Ordinários' } },
    ])
    prisma.arrecadacao.findMany.mockResolvedValue([
      { tipo: 'ARRECADACAO', valor: dec(100), data: new Date(Date.UTC(2026, 0, 15)), previsao: { contaReceitaEntidadeId: 'c111', fonteRecursoEntidadeId: 'f1', contaReceita: { codigo: '1.1.1', descricao: 'ISS' }, fonteRecurso: { codigo: '1000', nomenclatura: 'Recursos Ordinários' } } },
      { tipo: 'ESTORNO', valor: dec(30), data: new Date(Date.UTC(2026, 0, 20)), previsao: { contaReceitaEntidadeId: 'c111', fonteRecursoEntidadeId: 'f1', contaReceita: { codigo: '1.1.1', descricao: 'ISS' }, fonteRecurso: { codigo: '1000', nomenclatura: 'Recursos Ordinários' } } },
    ])
    const r = await svc.receita('ent1', 2026)
    expect(r?.contas).toHaveLength(1)
    expect(r?.contas[0]).toMatchObject({
      codigo: '1.1.1', descricao: 'ISS', natureza: 'Corrente', origem: 'Impostos, Taxas e Contrib.',
      fonte: '1000 - Recursos Ordinários', orcado: 1000,
    })
    expect(r?.contas[0]?.arrecadadoMensal).toEqual([70, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]) // 100 − 30
    expect(typeof r?.mesesRealizados).toBe('number')
  })
})

describe('ValoresMensaisService.despesa', () => {
  let prisma: PrismaMock
  let svc: ValoresMensaisService
  beforeEach(() => {
    prisma = criarPrismaMock()
    svc = new ValoresMensaisService(prisma as never)
  })

  it('itens por grupo×função×órgão×fonte: estágios mensais + orcado', async () => {
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    prisma.orcamento.findUnique.mockResolvedValue({ id: 'o1' })
    prisma.contaDespesaEntidade.findMany.mockResolvedValue([
      { id: 'g0', descricao: 'Despesas Correntes', nivel: 1, parentId: null },
      { id: 'g1', descricao: 'Pessoal e Encargos Sociais', nivel: 2, parentId: 'g0' },
      { id: 'g2', descricao: 'Vencimentos', nivel: 4, parentId: 'g1' },
    ])
    prisma.dotacaoDespesa.findMany.mockResolvedValue([
      { id: 'd1', valorAutorizado: dec(1000), contaDespesaEntidadeId: 'g2', funcao: { nome: 'Saúde' }, unidadeOrcamentaria: { nome: 'Secretaria de Saúde' }, fonteRecurso: { codigo: '1000', nomenclatura: 'Recursos Ordinários' } },
    ])
    prisma.movimentoEmpenho.findMany.mockResolvedValue([
      { tipo: 'EMPENHO', valor: dec(600), data: new Date(Date.UTC(2026, 0, 10)), empenho: { dotacaoDespesaId: 'd1' } },
      { tipo: 'ESTORNO_EMPENHO', valor: dec(100), data: new Date(Date.UTC(2026, 0, 20)), empenho: { dotacaoDespesaId: 'd1' } },
      { tipo: 'LIQUIDACAO', valor: dec(400), data: new Date(Date.UTC(2026, 1, 10)), empenho: { dotacaoDespesaId: 'd1' } },
      { tipo: 'PAGAMENTO', valor: dec(300), data: new Date(Date.UTC(2026, 2, 10)), empenho: { dotacaoDespesaId: 'd1' } },
    ])
    const r = await svc.despesa('ent1', 2026)
    expect(r?.itens).toHaveLength(1)
    const it = r!.itens[0]!
    expect(it).toMatchObject({ grupo: 'Pessoal e Encargos Sociais', funcao: 'Saúde', orgao: 'Secretaria de Saúde', fonte: '1000 - Recursos Ordinários', orcado: 1000 })
    expect(it.empenhadoMensal[0]).toBe(500) // 600 − 100
    expect(it.liquidadoMensal[1]).toBe(400)
    expect(it.pagoMensal[2]).toBe(300)
  })

  it('sem orçamento → itens vazios', async () => {
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    prisma.orcamento.findUnique.mockResolvedValue(null)
    const r = await svc.despesa('ent1', 2026)
    expect(r?.itens).toEqual([])
  })
})
