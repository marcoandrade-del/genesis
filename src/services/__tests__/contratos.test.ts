import { describe, it, expect, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'
import { ContratosService } from '../contratos.js'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'

let prisma: PrismaMock
let service: ContratosService

beforeEach(() => {
  prisma = criarPrismaMock()
  service = new ContratosService(prisma as never)
})

function dadosOk(over: Partial<Record<string, unknown>> = {}) {
  return {
    fornecedorId: 'f1',
    numero: 'C-001',
    objeto: 'Fornecimento de material',
    vigenciaInicio: '2026-01-01',
    vigenciaFim: '2026-12-31',
    valorTotal: '1000.00',
    itens: [{ itemCatalogoId: 'c1', quantidadeContratada: '10', precoUnitario: '5.00' }],
    ...over,
  } as never
}

function mockRefsOk() {
  prisma.fornecedor.findUnique.mockResolvedValue({ id: 'f1', ativo: true })
  prisma.itemCatalogo.findMany.mockResolvedValue([{ id: 'c1' }])
}

describe('ContratosService.criar', () => {
  it('rejeita fornecedor inativo', async () => {
    prisma.fornecedor.findUnique.mockResolvedValue({ id: 'f1', ativo: false })
    await expect(service.criar('ent1', dadosOk())).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
  })

  it('rejeita vigência com fim antes do início', async () => {
    prisma.fornecedor.findUnique.mockResolvedValue({ id: 'f1', ativo: true })
    await expect(
      service.criar('ent1', dadosOk({ vigenciaInicio: '2026-12-31', vigenciaFim: '2026-01-01' })),
    ).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
  })

  it('rejeita sem itens', async () => {
    prisma.fornecedor.findUnique.mockResolvedValue({ id: 'f1', ativo: true })
    await expect(service.criar('ent1', dadosOk({ itens: [] }))).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
  })

  it('cria contrato + itens em transação', async () => {
    mockRefsOk()
    prisma.contrato.create.mockResolvedValue({ id: 'ct1' })
    await service.criar('ent1', dadosOk())
    expect(prisma.contrato.create).toHaveBeenCalled()
    expect(prisma.itemContrato.createMany.mock.calls[0][0].data[0]).toMatchObject({ contratoId: 'ct1', itemCatalogoId: 'c1' })
  })

  it('número duplicado vira CONFLITO', async () => {
    mockRefsOk()
    prisma.contrato.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '7.7.0' }))
    await expect(service.criar('ent1', dadosOk())).rejects.toMatchObject({ code: 'CONFLITO' })
  })
})

describe('ContratosService.alterarStatus', () => {
  it('VIGENTE → RESCINDIDO ok', async () => {
    prisma.contrato.findUnique.mockResolvedValue({ id: 'ct1', status: 'VIGENTE' })
    prisma.contrato.update.mockResolvedValue({ id: 'ct1', status: 'RESCINDIDO' })
    await service.alterarStatus('ct1', 'RESCINDIDO')
    expect(prisma.contrato.update).toHaveBeenCalledWith({ where: { id: 'ct1' }, data: { status: 'RESCINDIDO' } })
  })

  it('transição inválida (já ENCERRADO) vira CONFLITO', async () => {
    prisma.contrato.findUnique.mockResolvedValue({ id: 'ct1', status: 'ENCERRADO' })
    await expect(service.alterarStatus('ct1', 'RESCINDIDO')).rejects.toMatchObject({ code: 'CONFLITO' })
  })
})

describe('ContratosService.excluir', () => {
  it('bloqueia contrato com item empenhado', async () => {
    prisma.contrato.findUnique.mockResolvedValue({ id: 'ct1', itens: [{ quantidadeEmpenhada: '5' }] })
    await expect(service.excluir('ct1')).rejects.toMatchObject({ code: 'CONFLITO' })
  })

  it('exclui quando nada empenhado', async () => {
    prisma.contrato.findUnique.mockResolvedValue({ id: 'ct1', itens: [{ quantidadeEmpenhada: '0' }] })
    prisma.contrato.delete.mockResolvedValue({})
    await service.excluir('ct1')
    expect(prisma.contrato.delete).toHaveBeenCalledWith({ where: { id: 'ct1' } })
  })
})
