import { describe, it, expect, beforeEach } from 'vitest'
import { SaldoOrcamentarioService } from '../saldo-orcamentario.js'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'

let prisma: PrismaMock
let service: SaldoOrcamentarioService

beforeEach(() => {
  prisma = criarPrismaMock()
  service = new SaldoOrcamentarioService(prisma as never)
})

// Árvore de contas de despesa (folhas: 3.1.90 e 3.3.90).
const CONTAS = [
  { id: 'c1', codigo: '3', descricao: 'Despesas Correntes', nivel: 1, parentId: null },
  { id: 'c2', codigo: '3.1', descricao: 'Pessoal', nivel: 2, parentId: 'c1' },
  { id: 'c3', codigo: '3.1.90', descricao: 'Vencimentos', nivel: 3, parentId: 'c2' },
  { id: 'c4', codigo: '3.3', descricao: 'Outras Correntes', nivel: 2, parentId: 'c1' },
  { id: 'c5', codigo: '3.3.90', descricao: 'Material de Consumo', nivel: 3, parentId: 'c4' },
]

const dot = (over: Record<string, unknown>) => ({
  unidadeOrcamentariaId: 'u1', unidadeOrcamentaria: { codigo: '02.001', nome: 'Saúde' },
  fonteRecursoEntidadeId: 'f1', fonteRecurso: { codigo: '500', nomenclatura: 'Recursos Livres' },
  funcaoId: 'fn1', funcao: { codigo: '10', nome: 'Saúde' },
  contaDespesaEntidadeId: 'c3',
  valorAutorizado: '0', valorReservado: '0', valorEmpenhado: '0',
  ...over,
})

const DOTACOES = [
  dot({ contaDespesaEntidadeId: 'c3', unidadeOrcamentariaId: 'u1', unidadeOrcamentaria: { codigo: '02.001', nome: 'Saúde' }, fonteRecursoEntidadeId: 'f1', fonteRecurso: { codigo: '500', nomenclatura: 'Livres' }, funcaoId: 'fn1', funcao: { codigo: '10', nome: 'Saúde' }, valorAutorizado: '1000', valorReservado: '100', valorEmpenhado: '200' }),
  dot({ contaDespesaEntidadeId: 'c5', unidadeOrcamentariaId: 'u1', unidadeOrcamentaria: { codigo: '02.001', nome: 'Saúde' }, fonteRecursoEntidadeId: 'f2', fonteRecurso: { codigo: '600', nomenclatura: 'Saúde' }, funcaoId: 'fn1', funcao: { codigo: '10', nome: 'Saúde' }, valorAutorizado: '500', valorReservado: '0', valorEmpenhado: '50' }),
  dot({ contaDespesaEntidadeId: 'c5', unidadeOrcamentariaId: 'u2', unidadeOrcamentaria: { codigo: '03.001', nome: 'Educação' }, fonteRecursoEntidadeId: 'f1', fonteRecurso: { codigo: '500', nomenclatura: 'Livres' }, funcaoId: 'fn2', funcao: { codigo: '12', nome: 'Educação' }, valorAutorizado: '300', valorReservado: '0', valorEmpenhado: '0' }),
]

describe('SaldoOrcamentarioService.calcular', () => {
  it('retorna vazio quando não há orçamento no exercício', async () => {
    prisma.orcamento.findUnique.mockResolvedValue(null)
    const r = await service.calcular('ent1', 2026)
    expect(r.temOrcamento).toBe(false)
    expect(r.resumo).toEqual({ autorizado: 0, reservado: 0, empenhado: 0, disponivel: 0 })
    expect(r.porUnidade).toEqual([])
    expect(prisma.dotacaoDespesa.findMany).not.toHaveBeenCalled()
  })

  it('calcula o resumo geral (disponível = autorizado − reservado − empenhado)', async () => {
    prisma.orcamento.findUnique.mockResolvedValue({ id: 'o1' })
    prisma.dotacaoDespesa.findMany.mockResolvedValue(DOTACOES)
    prisma.contaDespesaEntidade.findMany.mockResolvedValue(CONTAS)
    const r = await service.calcular('ent1', 2026)
    expect(r.temOrcamento).toBe(true)
    expect(r.resumo).toEqual({ autorizado: 1800, reservado: 100, empenhado: 250, disponivel: 1450 })
    expect(prisma.orcamento.findUnique).toHaveBeenCalledWith({ where: { entidadeId_ano: { entidadeId: 'ent1', ano: 2026 } } })
  })

  it('agrega por unidade orçamentária', async () => {
    prisma.orcamento.findUnique.mockResolvedValue({ id: 'o1' })
    prisma.dotacaoDespesa.findMany.mockResolvedValue(DOTACOES)
    prisma.contaDespesaEntidade.findMany.mockResolvedValue(CONTAS)
    const r = await service.calcular('ent1', 2026)
    const u1 = r.porUnidade.find((l) => l.id === 'u1')!
    const u2 = r.porUnidade.find((l) => l.id === 'u2')!
    expect(u1).toMatchObject({ rotulo: 'Saúde', autorizado: 1500, reservado: 100, empenhado: 250, disponivel: 1150 })
    expect(u2).toMatchObject({ rotulo: 'Educação', autorizado: 300, disponivel: 300 })
  })

  it('agrega por fonte de recurso e por função', async () => {
    prisma.orcamento.findUnique.mockResolvedValue({ id: 'o1' })
    prisma.dotacaoDespesa.findMany.mockResolvedValue(DOTACOES)
    prisma.contaDespesaEntidade.findMany.mockResolvedValue(CONTAS)
    const r = await service.calcular('ent1', 2026)
    expect(r.porFonte.find((l) => l.id === 'f1')).toMatchObject({ autorizado: 1300, empenhado: 200 })
    expect(r.porFonte.find((l) => l.id === 'f2')).toMatchObject({ autorizado: 500, empenhado: 50 })
    expect(r.porFuncao.find((l) => l.id === 'fn1')).toMatchObject({ autorizado: 1500, disponivel: 1150 })
    expect(r.porFuncao.find((l) => l.id === 'fn2')).toMatchObject({ autorizado: 300 })
  })

  it('faz roll-up por conta: folha + todos os ancestrais', async () => {
    prisma.orcamento.findUnique.mockResolvedValue({ id: 'o1' })
    prisma.dotacaoDespesa.findMany.mockResolvedValue(DOTACOES)
    prisma.contaDespesaEntidade.findMany.mockResolvedValue(CONTAS)
    const r = await service.calcular('ent1', 2026)
    const por = (cod: string) => r.porConta.find((l) => l.codigo === cod)!
    // folhas
    expect(por('3.1.90')).toMatchObject({ autorizado: 1000, reservado: 100, empenhado: 200 })
    expect(por('3.3.90')).toMatchObject({ autorizado: 800, reservado: 0, empenhado: 50 })
    // ancestrais
    expect(por('3.1')).toMatchObject({ autorizado: 1000 })
    expect(por('3.3')).toMatchObject({ autorizado: 800 })
    expect(por('3')).toMatchObject({ autorizado: 1800, reservado: 100, empenhado: 250, disponivel: 1450 })
    // ordenado por código e com nível para indentação
    expect(r.porConta.map((l) => l.codigo)).toEqual(['3', '3.1', '3.1.90', '3.3', '3.3.90'])
    expect(por('3.1.90').nivel).toBe(3)
  })
})
