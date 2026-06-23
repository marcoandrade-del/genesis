import { describe, it, expect, beforeEach } from 'vitest'
import { ArrecadacoesService } from '../arrecadacoes.js'
import { CONTAS_EVENTO } from '../motor-eventos-receita.js'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'
import { mockMatrizReceita } from './helpers/receita-matriz.js'

let prisma: PrismaMock
let service: ArrecadacoesService

beforeEach(() => {
  prisma = criarPrismaMock()
  service = new ArrecadacoesService(prisma as never)
})

const ORC = { id: 'o1', entidadeId: 'ent1', ano: 2026, status: 'EM_EXECUCAO' }
const PREV = {
  id: 'p1',
  orcamentoId: 'o1',
  contaReceitaEntidadeId: 'cr1',
  fonteRecursoEntidadeId: 'fr1',
  valorPrevisto: '1000',
  valorArrecadado: '200',
  contaReceita: { codigo: '1.3.2.1.01.1.1.05.00.00.00.00' },
  fonteRecurso: { codigo: '1000', vinculada: false },
}

const baseDados = (over = {}) => ({
  previsaoId: 'p1',
  tipo: 'ARRECADACAO',
  data: '2026-06-11',
  valor: '150.50',
  historico: 'IPTU cota única',
  criadoPorId: 'u1',
  ...over,
})

/**
 * Arma os mocks para o disparo contábil rodar até o fim (sem parametro → só
 * E100+E200). contaContabilEntidade.findMany serve aos dois consumidores:
 * o motor consulta por código; o LancamentosService consulta por id.
 */
function armarDisparo() {
  prisma.entidade.findUnique.mockResolvedValue({
    id: 'ent1',
    municipio: { modeloContabilId: 'mod', estado: { modeloContabilId: 'mod' } },
  })
  prisma.parametroReceita.findMany.mockResolvedValue([])
  prisma.contaContabilEntidade.findMany.mockImplementation(({ where }: any) => {
    if (where?.codigo?.in) {
      return Promise.resolve(where.codigo.in.map((codigo: string) => ({ id: `id:${codigo}`, codigo, admiteMovimento: true })))
    }
    if (where?.id?.in) {
      return Promise.resolve(
        where.id.in.map((id: string) => ({ id, codigo: id, admiteMovimento: true, entidadeId: 'ent1', ano: 2026 })),
      )
    }
    return Promise.resolve([])
  })
  prisma.lancamento.create.mockResolvedValue({ id: 'lx' })
  mockMatrizReceita(prisma) // contas D/C da arrecadação vêm da "tabela"
}

describe('ArrecadacoesService.criar', () => {
  beforeEach(() => {
    prisma.orcamento.findUnique.mockResolvedValue(ORC)
    prisma.previsaoReceita.findUnique.mockResolvedValue(PREV)
    prisma.arrecadacao.create.mockResolvedValue({ id: 'a1' })
    armarDisparo()
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

  it('dispara os lançamentos contábeis E100/E200 com origem ARRECADACAO (rastreabilidade)', async () => {
    await service.criar('o1', baseDados())
    // sem parametro EFETIVO → 2 lançamentos (orçamentário + DDR)
    expect(prisma.lancamento.create).toHaveBeenCalledTimes(2)
    const e100 = prisma.lancamento.create.mock.calls[0][0].data
    expect(e100.origemTipo).toBe('ARRECADACAO')
    expect(e100.origemId).toBe('a1')
    expect(e100.eventoCodigo).toBe('100')
    expect(e100.valor.toString()).toBe('150.5')
    // os itens carregam a conta-corrente (natureza no E100)
    const itensE100 = prisma.lancamentoItem.createMany.mock.calls[0][0].data
    expect(itensE100).toHaveLength(2)
    expect(itensE100.every((i: any) => i.naturezaReceitaCodigo === '1.3.2.1.01.1.1.05.00.00.00.00')).toBe(true)
    // E100 debita Receita Realizada
    expect(itensE100.find((i: any) => i.tipo === 'DEBITO').contaId).toBe(`id:${CONTAS_EVENTO.receitaRealizada}`)
  })

  it('com conta bancária: grava a conta e o E300 debita a folha de caixa dela', async () => {
    const CAIXA = '1.1.1.1.1.99.00.00.00.00.00.00'
    prisma.parametroReceita.findMany.mockResolvedValue([
      { naturezaCodigo: '1.3.2.1', tipoMutacao: 'EFETIVA', contaContrapartidaCodigo: '4.4.5.2.1.00.00.00.00.00.00.00' },
    ])
    prisma.contaBancaria.findUnique.mockResolvedValue({ id: 'cb1', entidadeId: 'ent1', fonteCodigo: '1000', ativa: true, contaContabilCodigo: CAIXA })
    await service.criar('o1', baseDados({ contaBancariaId: 'cb1' }))
    expect(prisma.arrecadacao.create.mock.calls[0][0].data.contaBancariaId).toBe('cb1')
    const e300call = prisma.lancamento.create.mock.calls.find((c: any) => c[0].data.eventoCodigo === '300')!
    const lancId = e300call[0].data // header; itens vão em createMany — confere pelo último createMany do E300
    const itensCalls = prisma.lancamentoItem.createMany.mock.calls.map((c: any) => c[0].data)
    const itensE300 = itensCalls.find((itens: any[]) => itens.some((i) => i.contaId === `id:${CAIXA}`))
    expect(itensE300).toBeTruthy()
    expect(itensE300.find((i: any) => i.tipo === 'DEBITO').contaId).toBe(`id:${CAIXA}`)
    expect(lancId.eventoCodigo).toBe('300')
  })

  it('rejeita conta bancária de fonte diferente da previsão', async () => {
    prisma.contaBancaria.findUnique.mockResolvedValue({ id: 'cb1', entidadeId: 'ent1', fonteCodigo: '9999', ativa: true, contaContabilCodigo: null })
    await expect(service.criar('o1', baseDados({ contaBancariaId: 'cb1' }))).rejects.toMatchObject({ code: 'ENTIDADE_NAO_PROCESSAVEL' })
    expect(prisma.arrecadacao.create).not.toHaveBeenCalled()
  })

  it('lançamentos gerados são consultáveis pelo movimento (mão dupla →)', async () => {
    prisma.lancamento.findMany.mockResolvedValue([{ id: 'lx', eventoCodigo: '100' }])
    const r = await service.lancamentosDoMovimento('a1')
    expect(r).toEqual([{ id: 'lx', eventoCodigo: '100' }])
    expect(prisma.lancamento.findMany).toHaveBeenCalledWith({
      where: { origemTipo: 'ARRECADACAO', origemId: 'a1' },
      include: { itens: true },
      orderBy: { eventoCodigo: 'asc' },
    })
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

describe('ArrecadacoesService.trilhaDoMovimento', () => {
  const MOV = {
    id: 'a1', tipo: 'ARRECADACAO', data: new Date('2026-06-19'), valor: '100', historico: 'FPM',
    previsao: {
      contaReceita: { codigo: '1.7', descricao: 'FPM' },
      fonteRecurso: { codigo: '1000', nomenclatura: 'Livres' },
      orcamento: { entidadeId: 'ent1' },
    },
    contaBancaria: null,
  }

  it('retorna o movimento + eventos com débito antes do crédito e contas resolvidas', async () => {
    prisma.arrecadacao.findUnique.mockResolvedValue(MOV)
    prisma.lancamento.findMany.mockResolvedValue([
      {
        eventoCodigo: '100', historico: 'E100',
        itens: [
          { tipo: 'CREDITO', valor: '100', contaId: 'c2', naturezaReceitaCodigo: '1.7', fonteCodigo: null },
          { tipo: 'DEBITO', valor: '100', contaId: 'c1', naturezaReceitaCodigo: '1.7', fonteCodigo: null },
        ],
      },
    ])
    prisma.contaContabilEntidade.findMany.mockResolvedValue([
      { id: 'c1', codigo: '6.2.1.2', descricao: 'Realizada' },
      { id: 'c2', codigo: '6.2.1.1', descricao: 'A Realizar' },
    ])
    const t = await service.trilhaDoMovimento('a1', 'ent1')
    expect(t.movimento.id).toBe('a1')
    expect(t.eventos).toHaveLength(1)
    expect(t.eventos[0].itens[0].tipo).toBe('DEBITO') // ordenado: D antes de C
    expect(t.eventos[0].itens[0].conta.codigo).toBe('6.2.1.2')
    expect(t.eventos[0].itens[1].conta.codigo).toBe('6.2.1.1')
  })

  it('rejeita movimento de outra entidade ou inexistente', async () => {
    prisma.arrecadacao.findUnique.mockResolvedValue({ ...MOV, previsao: { ...MOV.previsao, orcamento: { entidadeId: 'OUTRA' } } })
    await expect(service.trilhaDoMovimento('a1', 'ent1')).rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
    prisma.arrecadacao.findUnique.mockResolvedValue(null)
    await expect(service.trilhaDoMovimento('a1', 'ent1')).rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
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
