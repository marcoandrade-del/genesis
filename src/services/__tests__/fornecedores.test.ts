import { describe, it, expect, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'
import { FornecedoresService } from '../fornecedores.js'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'

let prisma: PrismaMock
let service: FornecedoresService

beforeEach(() => {
  prisma = criarPrismaMock()
  service = new FornecedoresService(prisma as never)
})

function pj(over: Partial<Record<string, unknown>> = {}) {
  return { tipoPessoa: 'PJ', cnpj: '12.345.678/0001-90', razaoSocial: 'ACME LTDA', ...over } as never
}
function p2002(target: string[]) {
  return new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '7.7.0', meta: { target } })
}

describe('FornecedoresService.criar — validação', () => {
  it('rejeita tipo inválido', async () => {
    await expect(service.criar(pj({ tipoPessoa: 'XX' }))).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
  })
  it('rejeita razão social vazia', async () => {
    await expect(service.criar(pj({ razaoSocial: ' ' }))).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
  })
  it('PJ exige CNPJ', async () => {
    await expect(service.criar(pj({ cnpj: '' }))).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
  })
  it('PF exige CPF', async () => {
    await expect(service.criar({ tipoPessoa: 'PF', razaoSocial: 'João', cpf: '' } as never)).rejects.toMatchObject({
      code: 'REQUISICAO_INVALIDA',
    })
  })
})

describe('FornecedoresService.criar — persistência', () => {
  it('PJ zera o CPF e persiste o CNPJ', async () => {
    prisma.fornecedor.create.mockResolvedValue({ id: 'f1' })
    await service.criar(pj({ cpf: '999' }))
    const data = prisma.fornecedor.create.mock.calls[0][0].data
    expect(data).toMatchObject({ tipoPessoa: 'PJ', cnpj: '12.345.678/0001-90', cpf: null, ativo: true })
  })

  it('PF zera o CNPJ e persiste o CPF', async () => {
    prisma.fornecedor.create.mockResolvedValue({ id: 'f1' })
    await service.criar({ tipoPessoa: 'PF', razaoSocial: 'João', cpf: '111.222.333-44', cnpj: '999' } as never)
    const data = prisma.fornecedor.create.mock.calls[0][0].data
    expect(data).toMatchObject({ tipoPessoa: 'PF', cpf: '111.222.333-44', cnpj: null })
  })

  it('documento duplicado vira CONFLITO', async () => {
    prisma.fornecedor.create.mockRejectedValue(p2002(['cnpj']))
    await expect(service.criar(pj())).rejects.toMatchObject({ code: 'CONFLITO' })
  })
})

describe('FornecedoresService.atualizar / excluir', () => {
  it('atualizar 404', async () => {
    prisma.fornecedor.findUnique.mockResolvedValue(null)
    await expect(service.atualizar('x', pj())).rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
  })

  it('excluir em uso (P2003) vira CONFLITO', async () => {
    prisma.fornecedor.findUnique.mockResolvedValue({ id: 'f1' })
    prisma.fornecedor.delete.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('fk', { code: 'P2003', clientVersion: '7.7.0' }),
    )
    await expect(service.excluir('f1')).rejects.toMatchObject({ code: 'CONFLITO' })
  })

  it('excluir caminho feliz', async () => {
    prisma.fornecedor.findUnique.mockResolvedValue({ id: 'f1' })
    prisma.fornecedor.delete.mockResolvedValue({})
    await service.excluir('f1')
    expect(prisma.fornecedor.delete).toHaveBeenCalledWith({ where: { id: 'f1' } })
  })
})
