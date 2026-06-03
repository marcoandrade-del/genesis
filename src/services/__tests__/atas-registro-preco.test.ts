import { describe, it, expect, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'
import { AtasRegistroPrecoService } from '../atas-registro-preco.js'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'

let prisma: PrismaMock
let service: AtasRegistroPrecoService

beforeEach(() => {
  prisma = criarPrismaMock()
  service = new AtasRegistroPrecoService(prisma as never)
})

function dadosOk(over: Partial<Record<string, unknown>> = {}) {
  return {
    fornecedorId: 'f1',
    numero: 'ARP-001',
    objeto: 'Registro de preços de material',
    vigenciaInicio: '2026-01-01',
    vigenciaFim: '2026-12-31',
    itens: [{ itemCatalogoId: 'c1', quantidadeRegistrada: '100', precoUnitario: '5.00' }],
    ...over,
  } as never
}

function mockRefsOk() {
  prisma.fornecedor.findUnique.mockResolvedValue({ id: 'f1', ativo: true })
  prisma.itemCatalogo.findMany.mockResolvedValue([{ id: 'c1' }])
}

describe('AtasRegistroPrecoService.criar', () => {
  it('rejeita fornecedor inativo', async () => {
    prisma.fornecedor.findUnique.mockResolvedValue({ id: 'f1', ativo: false })
    await expect(service.criar('ent1', dadosOk())).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
  })

  it('cria ata + itens em transação', async () => {
    mockRefsOk()
    prisma.ataRegistroPreco.create.mockResolvedValue({ id: 'a1' })
    await service.criar('ent1', dadosOk())
    expect(prisma.ataRegistroPreco.create).toHaveBeenCalled()
    expect(prisma.itemAtaRegistroPreco.createMany.mock.calls[0][0].data[0]).toMatchObject({ ataId: 'a1', itemCatalogoId: 'c1' })
  })

  it('número duplicado vira CONFLITO', async () => {
    mockRefsOk()
    prisma.ataRegistroPreco.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '7.7.0' }))
    await expect(service.criar('ent1', dadosOk())).rejects.toMatchObject({ code: 'CONFLITO' })
  })
})

describe('AtasRegistroPrecoService.alterarStatus / excluir', () => {
  it('encerra ata vigente', async () => {
    prisma.ataRegistroPreco.findUnique.mockResolvedValue({ id: 'a1', status: 'VIGENTE' })
    prisma.ataRegistroPreco.update.mockResolvedValue({ id: 'a1', status: 'ENCERRADA' })
    await service.alterarStatus('a1', 'ENCERRADA')
    expect(prisma.ataRegistroPreco.update).toHaveBeenCalledWith({ where: { id: 'a1' }, data: { status: 'ENCERRADA' } })
  })

  it('bloqueia exclusão de ata com item utilizado', async () => {
    prisma.ataRegistroPreco.findUnique.mockResolvedValue({ id: 'a1', itens: [{ quantidadeUtilizada: '3' }] })
    await expect(service.excluir('a1')).rejects.toMatchObject({ code: 'CONFLITO' })
  })

  it('exclui quando nada utilizado', async () => {
    prisma.ataRegistroPreco.findUnique.mockResolvedValue({ id: 'a1', itens: [{ quantidadeUtilizada: '0' }] })
    prisma.ataRegistroPreco.delete.mockResolvedValue({})
    await service.excluir('a1')
    expect(prisma.ataRegistroPreco.delete).toHaveBeenCalledWith({ where: { id: 'a1' } })
  })
})
