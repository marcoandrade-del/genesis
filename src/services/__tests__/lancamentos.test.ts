import { describe, it, expect, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'
import { LancamentosService, extrairAnoMes } from '../lancamentos.js'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'

const ENTIDADE = { id: 'ent1', nome: 'Prefeitura Teste', municipioId: 'mun1' }
const CAIXA = {
  id: 'c1',
  entidadeId: 'ent1',
  ano: 2026,
  codigo: '1.1.1.01',
  descricao: 'Caixa',
  admiteMovimento: true,
  nivel: 4,
}
const RECEITA = {
  id: 'c2',
  entidadeId: 'ent1',
  ano: 2026,
  codigo: '4.1.1',
  descricao: 'Receita',
  admiteMovimento: true,
  nivel: 3,
}

let prisma: PrismaMock
let service: LancamentosService

beforeEach(() => {
  prisma = criarPrismaMock()
  service = new LancamentosService(prisma as never)
})

function dadosOk() {
  return {
    entidadeId: 'ent1',
    data: '2026-05-25',
    historico: 'Recebimento',
    criadoPorId: 'u1',
    itens: [
      { contaId: 'c1', tipo: 'DEBITO' as const, valor: '100.00' },
      { contaId: 'c2', tipo: 'CREDITO' as const, valor: '100.00' },
    ],
  }
}

function mockHappyPath() {
  prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
  prisma.contaContabilEntidade.findMany.mockResolvedValue([CAIXA, RECEITA])
  prisma.lancamento.create.mockResolvedValue({ id: 'lanc1', entidadeId: 'ent1', data: new Date('2026-05-25') })
  prisma.lancamentoItem.createMany.mockResolvedValue({ count: 2 })
  prisma.resumoMensalConta.upsert.mockResolvedValue({})
  prisma.movimentoDiarioConta.upsert.mockResolvedValue({})
}

describe('extrairAnoMes', () => {
  it('extrai do formato YYYY-MM-DD', () => {
    expect(extrairAnoMes('2026-05-25')).toEqual({ ano: 2026, mes: 5 })
  })

  it('lança REQUISICAO_INVALIDA em formato incorreto', () => {
    expect(() => extrairAnoMes('25/05/2026')).toThrow(/Data inválida/)
    expect(() => extrairAnoMes('2026-5-25')).toThrow(/Data inválida/)
    expect(() => extrairAnoMes('')).toThrow(/Data inválida/)
  })
})

describe('LancamentosService.listar', () => {
  it('lista sem filtros, ordenado por data desc', async () => {
    prisma.lancamento.findMany.mockResolvedValue([])
    await service.listar('ent1')
    expect(prisma.lancamento.findMany).toHaveBeenCalledWith({
      where: { entidadeId: 'ent1' },
      orderBy: [{ data: 'desc' }, { criadoEm: 'desc' }],
      take: 500,
    })
  })

  it('aplica filtro de data', async () => {
    prisma.lancamento.findMany.mockResolvedValue([])
    await service.listar('ent1', { dataInicio: '2026-01-01', dataFim: '2026-12-31' })
    const args = prisma.lancamento.findMany.mock.calls[0][0]
    expect(args.where.data.gte).toBeInstanceOf(Date)
    expect(args.where.data.lte).toBeInstanceOf(Date)
  })

  it('aplica só dataInicio quando dataFim ausente', async () => {
    prisma.lancamento.findMany.mockResolvedValue([])
    await service.listar('ent1', { dataInicio: '2026-01-01' })
    const args = prisma.lancamento.findMany.mock.calls[0][0]
    expect(args.where.data.gte).toBeInstanceOf(Date)
    expect(args.where.data.lte).toBeUndefined()
  })

  it('aplica só dataFim quando dataInicio ausente', async () => {
    prisma.lancamento.findMany.mockResolvedValue([])
    await service.listar('ent1', { dataFim: '2026-12-31' })
    const args = prisma.lancamento.findMany.mock.calls[0][0]
    expect(args.where.data.gte).toBeUndefined()
    expect(args.where.data.lte).toBeInstanceOf(Date)
  })

  it('filtra por contas (lançamentos que tocam alguma das contas)', async () => {
    prisma.lancamento.findMany.mockResolvedValue([])
    await service.listar('ent1', { contaIds: ['c1', 'c2'] })
    const args = prisma.lancamento.findMany.mock.calls[0][0]
    expect(args.where.itens).toEqual({ some: { contaId: { in: ['c1', 'c2'] } } })
  })
})

describe('LancamentosService.buscarPorId', () => {
  it('inclui itens ordenados por tipo', async () => {
    prisma.lancamento.findUnique.mockResolvedValue({ id: 'lanc1', itens: [] })
    await service.buscarPorId('lanc1')
    expect(prisma.lancamento.findUnique).toHaveBeenCalledWith({
      where: { id: 'lanc1' },
      include: { itens: { orderBy: { tipo: 'asc' } } },
    })
  })
})

describe('LancamentosService.criar — validações', () => {
  it('caminho feliz: cria lançamento + itens + atualiza resumos', async () => {
    mockHappyPath()
    const r = await service.criar(dadosOk())

    expect(r.id).toBe('lanc1')
    expect(prisma.$transaction).toHaveBeenCalledOnce()
    expect(prisma.lancamento.create).toHaveBeenCalled()
    expect(prisma.lancamentoItem.createMany.mock.calls[0][0].data).toHaveLength(2)
    expect(prisma.resumoMensalConta.upsert).toHaveBeenCalledTimes(2)

    // Valida valores no upsert (caixa débito 100, receita crédito 100)
    const calls = prisma.resumoMensalConta.upsert.mock.calls.map((c) => c[0])
    const callCaixa = calls.find((c) => c.where.entidadeId_contaId_ano_mes.contaId === 'c1')!
    expect(callCaixa.where.entidadeId_contaId_ano_mes).toMatchObject({ entidadeId: 'ent1', ano: 2026, mes: 5 })
    expect(callCaixa.create.totalDebito.toString()).toBe('100')
    expect(callCaixa.update.totalDebito.increment.toString()).toBe('100')

    // Agregado diário materializado em paralelo ao mensal (mesmo movimento).
    expect(prisma.movimentoDiarioConta.upsert).toHaveBeenCalledTimes(2)
    const diaCaixa = prisma.movimentoDiarioConta.upsert.mock.calls.map((c) => c[0]).find((c) => c.where.entidadeId_contaId_data.contaId === 'c1')!
    expect(diaCaixa.create.totalDebito.toString()).toBe('100')
    expect(diaCaixa.update.totalDebito.increment.toString()).toBe('100')
  })

  it('rejeita com menos de 2 itens', async () => {
    const d = dadosOk()
    d.itens = [d.itens[0]!]
    await expect(service.criar(d)).rejects.toMatchObject({ code: 'ENTIDADE_NAO_PROCESSAVEL' })
    expect(prisma.entidade.findUnique).not.toHaveBeenCalled()
  })

  it('rejeita só débitos', async () => {
    const d = dadosOk()
    d.itens = [
      { contaId: 'c1', tipo: 'DEBITO', valor: '50' },
      { contaId: 'c2', tipo: 'DEBITO', valor: '50' },
    ]
    await expect(service.criar(d)).rejects.toMatchObject({ code: 'ENTIDADE_NAO_PROCESSAVEL' })
  })

  it('rejeita só créditos', async () => {
    const d = dadosOk()
    d.itens = [
      { contaId: 'c1', tipo: 'CREDITO', valor: '50' },
      { contaId: 'c2', tipo: 'CREDITO', valor: '50' },
    ]
    await expect(service.criar(d)).rejects.toMatchObject({ code: 'ENTIDADE_NAO_PROCESSAVEL' })
  })

  it('rejeita débitos != créditos', async () => {
    const d = dadosOk()
    d.itens = [
      { contaId: 'c1', tipo: 'DEBITO', valor: '100.00' },
      { contaId: 'c2', tipo: 'CREDITO', valor: '99.99' },
    ]
    await expect(service.criar(d)).rejects.toMatchObject({
      code: 'ENTIDADE_NAO_PROCESSAVEL',
      message: expect.stringContaining('desbalanceado'),
    })
  })

  it('rejeita valor total zero', async () => {
    const d = dadosOk()
    d.itens = [
      { contaId: 'c1', tipo: 'DEBITO', valor: '0' },
      { contaId: 'c2', tipo: 'CREDITO', valor: '0' },
    ]
    await expect(service.criar(d)).rejects.toMatchObject({
      code: 'ENTIDADE_NAO_PROCESSAVEL',
      message: expect.stringContaining('zero'),
    })
  })

  it('rejeita quando entidade não existe', async () => {
    prisma.entidade.findUnique.mockResolvedValue(null)
    await expect(service.criar(dadosOk())).rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
  })

  it('rejeita quando uma conta não existe', async () => {
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    prisma.contaContabilEntidade.findMany.mockResolvedValue([CAIXA]) // c2 ausente
    await expect(service.criar(dadosOk())).rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
  })

  it('rejeita quando conta pertence a outra entidade', async () => {
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    prisma.contaContabilEntidade.findMany.mockResolvedValue([CAIXA, { ...RECEITA, entidadeId: 'ent-outra' }])
    await expect(service.criar(dadosOk())).rejects.toMatchObject({
      code: 'ENTIDADE_NAO_PROCESSAVEL',
      message: expect.stringContaining('outra entidade'),
    })
  })

  it('rejeita quando conta é de outro ano (data não bate)', async () => {
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    prisma.contaContabilEntidade.findMany.mockResolvedValue([CAIXA, { ...RECEITA, ano: 2025 }])
    await expect(service.criar(dadosOk())).rejects.toMatchObject({
      code: 'ENTIDADE_NAO_PROCESSAVEL',
      message: expect.stringContaining('ano'),
    })
  })

  it('rejeita quando conta não admite movimento', async () => {
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    prisma.contaContabilEntidade.findMany.mockResolvedValue([CAIXA, { ...RECEITA, admiteMovimento: false }])
    await expect(service.criar(dadosOk())).rejects.toMatchObject({
      code: 'ENTIDADE_NAO_PROCESSAVEL',
      message: expect.stringContaining('não admite movimento'),
    })
  })

  it('lançamento composto: 1 débito → 2 créditos com agregação correta de resumos', async () => {
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    const OUTRA = { ...RECEITA, id: 'c3', codigo: '4.2.1' }
    prisma.contaContabilEntidade.findMany.mockResolvedValue([CAIXA, RECEITA, OUTRA])
    prisma.lancamento.create.mockResolvedValue({ id: 'lanc-comp' })
    prisma.lancamentoItem.createMany.mockResolvedValue({ count: 3 })

    await service.criar({
      entidadeId: 'ent1',
      data: '2026-05-25',
      historico: 'X',
      criadoPorId: 'u1',
      itens: [
        { contaId: 'c1', tipo: 'DEBITO', valor: '300.00' },
        { contaId: 'c2', tipo: 'CREDITO', valor: '200.00' },
        { contaId: 'c3', tipo: 'CREDITO', valor: '100.00' },
      ],
    })

    expect(prisma.resumoMensalConta.upsert).toHaveBeenCalledTimes(3)
    const lancCreate = prisma.lancamento.create.mock.calls[0][0]
    expect(lancCreate.data.valor.toString()).toBe('300')
  })

  it('mesma conta com débito e crédito no mesmo lançamento: um só upsert', async () => {
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    prisma.contaContabilEntidade.findMany.mockResolvedValue([CAIXA, RECEITA])
    prisma.lancamento.create.mockResolvedValue({ id: 'l' })
    prisma.lancamentoItem.createMany.mockResolvedValue({ count: 3 })

    await service.criar({
      entidadeId: 'ent1',
      data: '2026-05-25',
      historico: 'X',
      criadoPorId: 'u1',
      itens: [
        { contaId: 'c1', tipo: 'DEBITO', valor: '150' },
        { contaId: 'c1', tipo: 'CREDITO', valor: '50' }, // mesma conta!
        { contaId: 'c2', tipo: 'CREDITO', valor: '100' },
      ],
    })

    // c1 aparece em 1 upsert só (com débito 150 E crédito 50 acumulados)
    expect(prisma.resumoMensalConta.upsert).toHaveBeenCalledTimes(2)
    const callC1 = prisma.resumoMensalConta.upsert.mock.calls
      .map((c) => c[0])
      .find((c) => c.where.entidadeId_contaId_ano_mes.contaId === 'c1')!
    expect(callC1.create.totalDebito.toString()).toBe('150')
    expect(callC1.create.totalCredito.toString()).toBe('50')
  })
})

describe('LancamentosService.excluir', () => {
  const LANC = {
    id: 'lanc1',
    entidadeId: 'ent1',
    data: new Date('2026-05-25T00:00:00Z'),
    valor: new Prisma.Decimal(100),
    itens: [
      { id: 'i1', contaId: 'c1', tipo: 'DEBITO', valor: new Prisma.Decimal(100) },
      { id: 'i2', contaId: 'c2', tipo: 'CREDITO', valor: new Prisma.Decimal(100) },
    ],
  }

  it('decrementa resumos e exclui na mesma transação', async () => {
    prisma.lancamento.findUnique.mockResolvedValue(LANC)
    prisma.resumoMensalConta.update.mockResolvedValue({})
    prisma.lancamento.delete.mockResolvedValue({})

    await service.excluir('lanc1')

    expect(prisma.$transaction).toHaveBeenCalledOnce()
    expect(prisma.resumoMensalConta.update).toHaveBeenCalledTimes(2)
    expect(prisma.lancamento.delete).toHaveBeenCalledWith({ where: { id: 'lanc1' } })

    const callCaixa = prisma.resumoMensalConta.update.mock.calls
      .map((c) => c[0])
      .find((c) => c.where.entidadeId_contaId_ano_mes.contaId === 'c1')!
    expect(callCaixa.where.entidadeId_contaId_ano_mes).toMatchObject({ entidadeId: 'ent1', ano: 2026, mes: 5 })
    expect(callCaixa.data.totalDebito.decrement.toString()).toBe('100')
  })

  it('rejeita quando lançamento não existe', async () => {
    prisma.lancamento.findUnique.mockResolvedValue(null)
    await expect(service.excluir('xx')).rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })
})
