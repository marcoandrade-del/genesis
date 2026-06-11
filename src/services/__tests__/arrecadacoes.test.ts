import { describe, it, expect, beforeEach } from 'vitest'
import { ArrecadacoesService } from '../arrecadacoes.js'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'

let prisma: PrismaMock
let service: ArrecadacoesService

beforeEach(() => {
  prisma = criarPrismaMock()
  service = new ArrecadacoesService(prisma as never)
})

const ORC = { id: 'o1', entidadeId: 'ent1', ano: 2026, status: 'EM_EXECUCAO' }
const PREV = { id: 'p1', orcamentoId: 'o1', contaReceitaEntidadeId: 'cr1', fonteRecursoEntidadeId: 'fr1', valorPrevisto: '1000', valorArrecadado: '200' }

const baseDados = (over = {}) => ({
  previsaoId: 'p1',
  tipo: 'ARRECADACAO',
  data: '2026-06-11',
  valor: '150.50',
  historico: 'IPTU cota única',
  ...over,
})

describe('ArrecadacoesService.criar', () => {
  beforeEach(() => {
    prisma.orcamento.findUnique.mockResolvedValue(ORC)
    prisma.previsaoReceita.findUnique.mockResolvedValue(PREV)
    prisma.arrecadacao.create.mockResolvedValue({ id: 'a1' })
  })

  it('cria o movimento e incrementa o valorArrecadado da previsão na transação', async () => {
    const r = await service.criar('o1', baseDados())
    expect(r).toEqual({ id: 'a1' })
    const dataCriar = prisma.arrecadacao.create.mock.calls[0][0].data
    expect(dataCriar.previsaoId).toBe('p1')
    expect(dataCriar.tipo).toBe('ARRECADACAO')
    expect(dataCriar.valor.toString()).toBe('150.5')
    expect(dataCriar.historico).toBe('IPTU cota única')
    const upd = prisma.previsaoReceita.update.mock.calls[0][0]
    expect(upd.where).toEqual({ id: 'p1' })
    expect(upd.data.valorArrecadado.increment.toString()).toBe('150.5')
  })

  it('ESTORNO decrementa e não pode exceder o arrecadado da previsão', async () => {
    await service.criar('o1', baseDados({ tipo: 'ESTORNO', valor: '200' }))
    expect(prisma.previsaoReceita.update.mock.calls[0][0].data.valorArrecadado.decrement.toString()).toBe('200')

    prisma.previsaoReceita.update.mockClear()
    await expect(service.criar('o1', baseDados({ tipo: 'ESTORNO', valor: '200.01' }))).rejects.toMatchObject({
      code: 'ENTIDADE_NAO_PROCESSAVEL',
    })
    expect(prisma.previsaoReceita.update).not.toHaveBeenCalled()
  })

  it('histórico vazio vira null', async () => {
    await service.criar('o1', baseDados({ historico: '   ' }))
    expect(prisma.arrecadacao.create.mock.calls[0][0].data.historico).toBeNull()
  })

  it('rejeita orçamento em rascunho / inexistente', async () => {
    prisma.orcamento.findUnique.mockResolvedValue({ ...ORC, status: 'RASCUNHO' })
    await expect(service.criar('o1', baseDados())).rejects.toMatchObject({ code: 'ENTIDADE_NAO_PROCESSAVEL' })
    prisma.orcamento.findUnique.mockResolvedValue(null)
    await expect(service.criar('o1', baseDados())).rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
    expect(prisma.arrecadacao.create).not.toHaveBeenCalled()
  })

  it('rejeita previsão de outro orçamento ou inexistente', async () => {
    prisma.previsaoReceita.findUnique.mockResolvedValue({ ...PREV, orcamentoId: 'OUTRO' })
    await expect(service.criar('o1', baseDados())).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
    prisma.previsaoReceita.findUnique.mockResolvedValue(null)
    await expect(service.criar('o1', baseDados())).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
  })

  it('valida campos: previsão, tipo, data e valor', async () => {
    await expect(service.criar('o1', baseDados({ previsaoId: '  ' }))).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
    await expect(service.criar('o1', baseDados({ tipo: 'DEPOSITO' }))).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
    await expect(service.criar('o1', baseDados({ data: 'não-é-data' }))).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
    await expect(service.criar('o1', baseDados({ data: '' }))).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
    await expect(service.criar('o1', baseDados({ valor: '0' }))).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
    await expect(service.criar('o1', baseDados({ valor: '-5' }))).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
    await expect(service.criar('o1', baseDados({ valor: 'abc' }))).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
    expect(prisma.arrecadacao.create).not.toHaveBeenCalled()
  })
})

describe('ArrecadacoesService.listar', () => {
  it('lista movimentos do orçamento, mais recentes primeiro', async () => {
    prisma.arrecadacao.findMany.mockResolvedValue([{ id: 'a1' }])
    const r = await service.listar('o1')
    expect(r).toEqual([{ id: 'a1' }])
    expect(prisma.arrecadacao.findMany).toHaveBeenCalledWith({
      where: { previsao: { orcamentoId: 'o1' } },
      orderBy: [{ data: 'desc' }, { criadoEm: 'desc' }],
      include: { previsao: { include: { contaReceita: true, fonteRecurso: true } } },
    })
  })
})

describe('ArrecadacoesService.resumo', () => {
  it('sem orçamento → vazio', async () => {
    prisma.orcamento.findUnique.mockResolvedValue(null)
    const r = await service.resumo('ent1', 2026)
    expect(r.temOrcamento).toBe(false)
    expect(r.porConta).toEqual([])
  })

  it('totaliza, agrupa por fonte e faz roll-up na árvore de contas', async () => {
    prisma.orcamento.findUnique.mockResolvedValue(ORC)
    // árvore: raiz 1 (Receitas) → 1.1 (Impostos, folha) e 1.2 (Taxas, folha)
    prisma.contaReceitaEntidade.findMany.mockResolvedValue([
      { id: 'raiz', codigo: '1', descricao: 'Receitas', nivel: 1, parentId: null },
      { id: 'imp', codigo: '1.1', descricao: 'Impostos', nivel: 2, parentId: 'raiz' },
      { id: 'tax', codigo: '1.2', descricao: 'Taxas', nivel: 2, parentId: 'raiz' },
    ])
    prisma.previsaoReceita.findMany.mockResolvedValue([
      { contaReceitaEntidadeId: 'imp', fonteRecursoEntidadeId: 'f1', valorPrevisto: '600', valorArrecadado: '100', fonteRecurso: { codigo: '500', nomenclatura: 'Recursos livres' } },
      { contaReceitaEntidadeId: 'tax', fonteRecursoEntidadeId: 'f1', valorPrevisto: '400', valorArrecadado: '50', fonteRecurso: { codigo: '500', nomenclatura: 'Recursos livres' } },
    ])
    const r = await service.resumo('ent1', 2026)
    expect(r.temOrcamento).toBe(true)
    expect(r.resumo).toEqual({ previsto: 1000, arrecadado: 150, saldo: 850 })
    expect(r.porFonte).toEqual([
      { id: 'f1', codigo: '500', rotulo: 'Recursos livres', nivel: 0, previsto: 1000, arrecadado: 150, saldo: 850 },
    ])
    // roll-up: a raiz acumula as duas folhas
    expect(r.porConta).toEqual([
      { id: 'raiz', codigo: '1', rotulo: 'Receitas', nivel: 1, previsto: 1000, arrecadado: 150, saldo: 850 },
      { id: 'imp', codigo: '1.1', rotulo: 'Impostos', nivel: 2, previsto: 600, arrecadado: 100, saldo: 500 },
      { id: 'tax', codigo: '1.2', rotulo: 'Taxas', nivel: 2, previsto: 400, arrecadado: 50, saldo: 350 },
    ])
  })

  it('ordena fontes por código e contas numericamente', async () => {
    prisma.orcamento.findUnique.mockResolvedValue(ORC)
    prisma.contaReceitaEntidade.findMany.mockResolvedValue([
      { id: 'c10', codigo: '1.10', descricao: 'Dez', nivel: 2, parentId: null },
      { id: 'c2', codigo: '1.2', descricao: 'Dois', nivel: 2, parentId: null },
    ])
    prisma.previsaoReceita.findMany.mockResolvedValue([
      { contaReceitaEntidadeId: 'c10', fonteRecursoEntidadeId: 'f9', valorPrevisto: '1', valorArrecadado: '0', fonteRecurso: { codigo: '900', nomenclatura: 'Outra' } },
      { contaReceitaEntidadeId: 'c2', fonteRecursoEntidadeId: 'f5', valorPrevisto: '2', valorArrecadado: '0', fonteRecurso: { codigo: '500', nomenclatura: 'Livres' } },
    ])
    const r = await service.resumo('ent1', 2026)
    expect(r.porFonte.map((f) => f.codigo)).toEqual(['500', '900'])
    expect(r.porConta.map((c) => c.codigo)).toEqual(['1.2', '1.10']) // numérico: 2 antes de 10
  })

  it('previsão com conta fora da árvore não quebra (nó ausente interrompe o roll-up)', async () => {
    prisma.orcamento.findUnique.mockResolvedValue(ORC)
    prisma.contaReceitaEntidade.findMany.mockResolvedValue([])
    prisma.previsaoReceita.findMany.mockResolvedValue([
      { contaReceitaEntidadeId: 'fantasma', fonteRecursoEntidadeId: 'f1', valorPrevisto: '10', valorArrecadado: '0', fonteRecurso: { codigo: '500', nomenclatura: 'Livres' } },
    ])
    const r = await service.resumo('ent1', 2026)
    expect(r.resumo.previsto).toBe(10)
    expect(r.porConta).toEqual([])
    expect(r.porFonte).toHaveLength(1)
  })
})
