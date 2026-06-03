import { describe, it, expect, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'
import { ProcessosService } from '../processos.js'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'

let prisma: PrismaMock
let service: ProcessosService

beforeEach(() => {
  prisma = criarPrismaMock()
  service = new ProcessosService(prisma as never)
})

function dadosOk(over: Partial<Record<string, unknown>> = {}) {
  return {
    ano: 2026,
    numero: 'PE-001',
    modalidade: 'PREGAO',
    criterioJulgamento: 'POR_ITEM',
    objeto: 'Material de escritório',
    lotes: [{ numero: '1', itens: [{ itemCatalogoId: 'c1', quantidade: '10', precoEstimadoUnitario: '5.00' }] }],
    ...over,
  } as never
}

function mockCatalogoOk() {
  prisma.itemCatalogo.findMany.mockResolvedValue([{ id: 'c1' }])
}

describe('ProcessosService.criar — validação', () => {
  it('rejeita modalidade inválida', async () => {
    await expect(service.criar('ent1', dadosOk({ modalidade: 'XX' }))).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
  })
  it('rejeita sem lotes', async () => {
    await expect(service.criar('ent1', dadosOk({ lotes: [] }))).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
  })
  it('rejeita lote sem itens', async () => {
    await expect(service.criar('ent1', dadosOk({ lotes: [{ numero: '1', itens: [] }] }))).rejects.toMatchObject({
      code: 'REQUISICAO_INVALIDA',
    })
  })
  it('rejeita item do catálogo inexistente', async () => {
    prisma.itemCatalogo.findMany.mockResolvedValue([])
    await expect(service.criar('ent1', dadosOk())).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
  })
  it('rejeita TR de outra entidade', async () => {
    prisma.termoReferencia.findUnique.mockResolvedValue({ id: 'tr1', documentoDemanda: { entidadeId: 'outra' } })
    await expect(service.criar('ent1', dadosOk({ termoReferenciaId: 'tr1' }))).rejects.toMatchObject({
      code: 'REQUISICAO_INVALIDA',
    })
  })
})

describe('ProcessosService.criar — persistência', () => {
  it('cria processo + lotes + itens em transação', async () => {
    mockCatalogoOk()
    prisma.processo.create.mockResolvedValue({ id: 'p1' })
    prisma.lote.create.mockResolvedValue({ id: 'l1' })
    await service.criar('ent1', dadosOk())
    expect(prisma.processo.create).toHaveBeenCalled()
    expect(prisma.lote.create).toHaveBeenCalledWith({ data: { processoId: 'p1', numero: '1', descricao: null } })
    expect(prisma.itemProcesso.createMany.mock.calls[0][0].data[0]).toMatchObject({ loteId: 'l1', itemCatalogoId: 'c1' })
  })

  it('número duplicado vira CONFLITO', async () => {
    mockCatalogoOk()
    prisma.processo.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '7.7.0' }))
    prisma.lote.create.mockResolvedValue({ id: 'l1' })
    await expect(service.criar('ent1', dadosOk())).rejects.toMatchObject({ code: 'CONFLITO' })
  })
})

describe('ProcessosService.adjudicarItem — REGRA 3 (teto de preço)', () => {
  function mockItemAberto() {
    prisma.itemProcesso.findUnique.mockResolvedValue({
      id: 'ip1',
      precoEstimadoUnitario: '5.00',
      lote: { processo: { status: 'ABERTO', criterioJulgamento: 'POR_ITEM' } },
    })
    prisma.fornecedor.findUnique.mockResolvedValue({ id: 'f1', ativo: true })
  }

  it('rejeita preço adjudicado acima do estimado', async () => {
    mockItemAberto()
    await expect(service.adjudicarItem('ip1', 'f1', '6.00')).rejects.toMatchObject({ code: 'ENTIDADE_NAO_PROCESSAVEL' })
    expect(prisma.itemProcesso.update).not.toHaveBeenCalled()
  })

  it('aceita preço igual ao estimado e grava vencedor', async () => {
    mockItemAberto()
    prisma.itemProcesso.update.mockResolvedValue({ id: 'ip1' })
    await service.adjudicarItem('ip1', 'f1', '5.00')
    const data = prisma.itemProcesso.update.mock.calls[0][0].data
    expect(data.fornecedorVencedorId).toBe('f1')
    expect(data.precoAdjudicadoUnitario.toString()).toBe('5')
  })

  it('bloqueia se processo não está ABERTO', async () => {
    prisma.itemProcesso.findUnique.mockResolvedValue({
      id: 'ip1',
      precoEstimadoUnitario: '5.00',
      lote: { processo: { status: 'HOMOLOGADO', criterioJulgamento: 'POR_ITEM' } },
    })
    await expect(service.adjudicarItem('ip1', 'f1', '5.00')).rejects.toMatchObject({ code: 'CONFLITO' })
  })

  it('bloqueia fornecedor inativo', async () => {
    prisma.itemProcesso.findUnique.mockResolvedValue({
      id: 'ip1',
      precoEstimadoUnitario: '5.00',
      lote: { processo: { status: 'ABERTO', criterioJulgamento: 'POR_ITEM' } },
    })
    prisma.fornecedor.findUnique.mockResolvedValue({ id: 'f1', ativo: false })
    await expect(service.adjudicarItem('ip1', 'f1', '5.00')).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
  })

  it('rejeita em processo POR_LOTE', async () => {
    prisma.itemProcesso.findUnique.mockResolvedValue({
      id: 'ip1',
      precoEstimadoUnitario: '5.00',
      lote: { processo: { status: 'ABERTO', criterioJulgamento: 'POR_LOTE' } },
    })
    await expect(service.adjudicarItem('ip1', 'f1', '5.00')).rejects.toMatchObject({ code: 'CONFLITO' })
  })
})

describe('ProcessosService.adjudicarLote', () => {
  it('grava vencedor do lote e preços dos itens (REGRA 3)', async () => {
    prisma.lote.findUnique.mockResolvedValue({
      id: 'l1',
      processo: { status: 'ABERTO', criterioJulgamento: 'POR_LOTE' },
      itens: [{ id: 'ip1', precoEstimadoUnitario: '5.00' }],
    })
    prisma.fornecedor.findUnique.mockResolvedValue({ id: 'f1', ativo: true })
    prisma.lote.update.mockResolvedValue({ id: 'l1' })
    prisma.itemProcesso.update.mockResolvedValue({ id: 'ip1' })
    await service.adjudicarLote('l1', 'f1', [{ itemProcessoId: 'ip1', precoAdjudicadoUnitario: '4.00' }])
    expect(prisma.lote.update).toHaveBeenCalledWith({ where: { id: 'l1' }, data: { fornecedorVencedorId: 'f1' } })
    expect(prisma.itemProcesso.update.mock.calls[0][0].data.fornecedorVencedorId).toBe('f1')
  })

  it('rejeita preço de item acima do estimado', async () => {
    prisma.lote.findUnique.mockResolvedValue({
      id: 'l1',
      processo: { status: 'ABERTO', criterioJulgamento: 'POR_LOTE' },
      itens: [{ id: 'ip1', precoEstimadoUnitario: '5.00' }],
    })
    prisma.fornecedor.findUnique.mockResolvedValue({ id: 'f1', ativo: true })
    await expect(service.adjudicarLote('l1', 'f1', [{ itemProcessoId: 'ip1', precoAdjudicadoUnitario: '9.00' }])).rejects.toMatchObject({
      code: 'ENTIDADE_NAO_PROCESSAVEL',
    })
  })
})

describe('ProcessosService.homologar / excluir', () => {
  it('homologa processo ABERTO', async () => {
    prisma.processo.findUnique.mockResolvedValue({ id: 'p1', status: 'ABERTO' })
    prisma.processo.update.mockResolvedValue({ id: 'p1', status: 'HOMOLOGADO' })
    await service.homologar('p1')
    expect(prisma.processo.update.mock.calls[0][0].data.status).toBe('HOMOLOGADO')
  })

  it('não homologa processo já homologado', async () => {
    prisma.processo.findUnique.mockResolvedValue({ id: 'p1', status: 'HOMOLOGADO' })
    await expect(service.homologar('p1')).rejects.toMatchObject({ code: 'CONFLITO' })
  })

  it('não exclui processo com contratos', async () => {
    prisma.processo.findUnique.mockResolvedValue({ id: 'p1', status: 'ABERTO', _count: { contratos: 1, atas: 0 } })
    await expect(service.excluir('p1')).rejects.toMatchObject({ code: 'CONFLITO' })
  })
})
