import { describe, it, expect, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'
import { EventosContabeisService } from '../eventos-contabeis.js'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'

const MODELO = { id: 'm1', descricao: 'PARANÁ', ativo: true }

let prisma: PrismaMock
let service: EventosContabeisService

beforeEach(() => {
  prisma = criarPrismaMock()
  service = new EventosContabeisService(prisma as never)
})

function dadosOk() {
  return {
    codigo: '100001',
    descricao: 'PREVISÃO INICIAL DA RECEITA',
    tipoInscricao: '11 - Natureza da Receita',
    classificacaoContabilMascara: '521920100',
    classificacaoOrcamentariaMascara: 'YYYYYYY',
    ativo: true,
    lancamentos: [
      { contaDebitoMascara: '521920100', contaCreditoMascara: '521929900' },
      { contaDebitoMascara: '521919900', contaCreditoMascara: '621100000' },
    ],
  }
}

describe('EventosContabeisService.listar', () => {
  it('lista do modelo ordenado por código, incluindo lançamentos por ordem', async () => {
    prisma.eventoContabil.findMany.mockResolvedValue([])
    await service.listar('m1')
    expect(prisma.eventoContabil.findMany).toHaveBeenCalledWith({
      where: { modeloContabilId: 'm1' },
      orderBy: { codigo: 'asc' },
      include: { lancamentos: { orderBy: { ordem: 'asc' } } },
    })
  })
})

describe('EventosContabeisService.buscarPorId', () => {
  it('inclui lançamentos por ordem', async () => {
    prisma.eventoContabil.findUnique.mockResolvedValue(null)
    await service.buscarPorId('ev1')
    expect(prisma.eventoContabil.findUnique).toHaveBeenCalledWith({
      where: { id: 'ev1' },
      include: { lancamentos: { orderBy: { ordem: 'asc' } } },
    })
  })
})

describe('EventosContabeisService.criar', () => {
  it('caminho feliz: cria evento + lançamentos com ordem 1..N', async () => {
    prisma.modeloContabil.findUnique.mockResolvedValue(MODELO)
    prisma.eventoContabil.create.mockResolvedValue({ id: 'ev1' })
    prisma.eventoLancamento.createMany.mockResolvedValue({ count: 2 })

    const r = await service.criar('m1', dadosOk())
    expect(r.id).toBe('ev1')
    expect(prisma.$transaction).toHaveBeenCalledOnce()
    expect(prisma.eventoContabil.create.mock.calls[0][0].data).toMatchObject({
      modeloContabilId: 'm1',
      codigo: '100001',
      descricao: 'PREVISÃO INICIAL DA RECEITA',
      tipoInscricao: '11 - Natureza da Receita',
      ativo: true,
    })
    const lancamentos = prisma.eventoLancamento.createMany.mock.calls[0][0].data
    expect(lancamentos).toHaveLength(2)
    expect(lancamentos[0]).toMatchObject({ eventoId: 'ev1', ordem: 1, contaDebitoMascara: '521920100' })
    expect(lancamentos[1]).toMatchObject({ ordem: 2, contaCreditoMascara: '621100000' })
  })

  it('faz trim em código/descrição/máscaras', async () => {
    prisma.modeloContabil.findUnique.mockResolvedValue(MODELO)
    prisma.eventoContabil.create.mockResolvedValue({ id: 'ev1' })
    prisma.eventoLancamento.createMany.mockResolvedValue({ count: 2 })

    const d = dadosOk()
    d.codigo = '  100001  '
    d.descricao = '  X  '
    d.tipoInscricao = '  Y  '
    d.lancamentos[0].contaDebitoMascara = '  111  '
    await service.criar('m1', d)

    const data = prisma.eventoContabil.create.mock.calls[0][0].data
    expect(data.codigo).toBe('100001')
    expect(data.descricao).toBe('X')
    expect(data.tipoInscricao).toBe('Y')
    const lancs = prisma.eventoLancamento.createMany.mock.calls[0][0].data
    expect(lancs[0].contaDebitoMascara).toBe('111')
  })

  it('máscaras null/undefined/string-vazia viram null', async () => {
    prisma.modeloContabil.findUnique.mockResolvedValue(MODELO)
    prisma.eventoContabil.create.mockResolvedValue({ id: 'ev1' })
    prisma.eventoLancamento.createMany.mockResolvedValue({ count: 2 })

    await service.criar('m1', {
      ...dadosOk(),
      tipoInscricao: null,
      classificacaoContabilMascara: undefined,
      classificacaoOrcamentariaMascara: '   ',
    })
    const data = prisma.eventoContabil.create.mock.calls[0][0].data
    expect(data.tipoInscricao).toBeNull()
    expect(data.classificacaoContabilMascara).toBeNull()
    expect(data.classificacaoOrcamentariaMascara).toBeNull()
  })

  it('ativo default true se omitido', async () => {
    prisma.modeloContabil.findUnique.mockResolvedValue(MODELO)
    prisma.eventoContabil.create.mockResolvedValue({ id: 'ev1' })
    prisma.eventoLancamento.createMany.mockResolvedValue({ count: 2 })

    const d = dadosOk()
    delete (d as Partial<typeof d>).ativo
    await service.criar('m1', d)
    expect(prisma.eventoContabil.create.mock.calls[0][0].data.ativo).toBe(true)
  })

  it('rejeita código vazio', async () => {
    await expect(service.criar('m1', { ...dadosOk(), codigo: '   ' })).rejects.toMatchObject({
      code: 'REQUISICAO_INVALIDA',
    })
    expect(prisma.modeloContabil.findUnique).not.toHaveBeenCalled()
  })

  it('rejeita descrição vazia', async () => {
    await expect(service.criar('m1', { ...dadosOk(), descricao: '   ' })).rejects.toMatchObject({
      code: 'REQUISICAO_INVALIDA',
    })
  })

  it('rejeita sem lançamentos', async () => {
    await expect(service.criar('m1', { ...dadosOk(), lancamentos: [] })).rejects.toMatchObject({
      code: 'REQUISICAO_INVALIDA',
      message: expect.stringContaining('par'),
    })
  })

  it('rejeita lançamento com conta D ou C vazia', async () => {
    await expect(
      service.criar('m1', {
        ...dadosOk(),
        lancamentos: [{ contaDebitoMascara: '111', contaCreditoMascara: '   ' }],
      }),
    ).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
    await expect(
      service.criar('m1', {
        ...dadosOk(),
        lancamentos: [{ contaDebitoMascara: '   ', contaCreditoMascara: '222' }],
      }),
    ).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
  })

  it('rejeita quando modelo não existe', async () => {
    prisma.modeloContabil.findUnique.mockResolvedValue(null)
    await expect(service.criar('xx', dadosOk())).rejects.toMatchObject({
      code: 'RECURSO_NAO_ENCONTRADO',
    })
  })

  it('código duplicado vira CONFLITO', async () => {
    prisma.modeloContabil.findUnique.mockResolvedValue(MODELO)
    prisma.eventoContabil.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '7.7.0' }),
    )
    await expect(service.criar('m1', dadosOk())).rejects.toMatchObject({
      code: 'CONFLITO',
      message: expect.stringContaining('Já existe'),
    })
  })

  it('repassa outros erros do Prisma', async () => {
    prisma.modeloContabil.findUnique.mockResolvedValue(MODELO)
    prisma.eventoContabil.create.mockRejectedValue(new Error('boom'))
    await expect(service.criar('m1', dadosOk())).rejects.toThrow('boom')
  })
})

describe('EventosContabeisService.atualizar', () => {
  const EXISTENTE = { id: 'ev1', modeloContabilId: 'm1', codigo: '100001', ativo: true }

  it('substitui lançamentos atômicamente (delete + create)', async () => {
    prisma.eventoContabil.findUnique.mockResolvedValue(EXISTENTE)
    prisma.eventoContabil.update.mockResolvedValue(EXISTENTE)
    prisma.eventoLancamento.createMany.mockResolvedValue({ count: 2 })

    await service.atualizar('ev1', dadosOk())
    expect(prisma.$transaction).toHaveBeenCalledOnce()
    expect(prisma.eventoLancamento.deleteMany).toHaveBeenCalledWith({ where: { eventoId: 'ev1' } })
    expect(prisma.eventoContabil.update.mock.calls[0][0]).toMatchObject({
      where: { id: 'ev1' },
      data: expect.objectContaining({ codigo: '100001', ativo: true }),
    })
    expect(prisma.eventoLancamento.createMany).toHaveBeenCalled()
  })

  it('preserva ativo atual se omitido', async () => {
    prisma.eventoContabil.findUnique.mockResolvedValue({ ...EXISTENTE, ativo: false })
    prisma.eventoContabil.update.mockResolvedValue(EXISTENTE)
    const d = dadosOk()
    delete (d as Partial<typeof d>).ativo
    await service.atualizar('ev1', d)
    expect(prisma.eventoContabil.update.mock.calls[0][0].data.ativo).toBe(false)
  })

  it('rejeita validação (código vazio) antes de qualquer query', async () => {
    await expect(service.atualizar('ev1', { ...dadosOk(), codigo: '   ' })).rejects.toMatchObject({
      code: 'REQUISICAO_INVALIDA',
    })
    expect(prisma.eventoContabil.findUnique).not.toHaveBeenCalled()
  })

  it('404 quando evento não existe', async () => {
    prisma.eventoContabil.findUnique.mockResolvedValue(null)
    await expect(service.atualizar('xx', dadosOk())).rejects.toMatchObject({
      code: 'RECURSO_NAO_ENCONTRADO',
    })
  })

  it('código duplicado vira CONFLITO', async () => {
    prisma.eventoContabil.findUnique.mockResolvedValue(EXISTENTE)
    prisma.eventoContabil.update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '7.7.0' }),
    )
    await expect(service.atualizar('ev1', dadosOk())).rejects.toMatchObject({ code: 'CONFLITO' })
  })

  it('repassa outros erros', async () => {
    prisma.eventoContabil.findUnique.mockResolvedValue(EXISTENTE)
    prisma.eventoContabil.update.mockRejectedValue(new Error('boom'))
    await expect(service.atualizar('ev1', dadosOk())).rejects.toThrow('boom')
  })
})

describe('EventosContabeisService.excluir', () => {
  it('exclui quando existe', async () => {
    prisma.eventoContabil.findUnique.mockResolvedValue({ id: 'ev1' })
    prisma.eventoContabil.delete.mockResolvedValue({})
    await service.excluir('ev1')
    expect(prisma.eventoContabil.delete).toHaveBeenCalledWith({ where: { id: 'ev1' } })
  })

  it('404 quando não existe', async () => {
    prisma.eventoContabil.findUnique.mockResolvedValue(null)
    await expect(service.excluir('xx')).rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
    expect(prisma.eventoContabil.delete).not.toHaveBeenCalled()
  })
})
