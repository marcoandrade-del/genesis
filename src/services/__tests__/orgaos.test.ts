import { describe, it, expect, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'
import { OrgaosService } from '../orgaos.js'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'

let prisma: PrismaMock
let service: OrgaosService

beforeEach(() => {
  prisma = criarPrismaMock()
  service = new OrgaosService(prisma as never)
})

describe('OrgaosService', () => {
  it('cria com ativo default e exige código/nome', async () => {
    prisma.entidade.findUnique.mockResolvedValue({ id: 'e1' } as never)
    prisma.orgao.create.mockResolvedValue({ id: 'o1' } as never)
    await service.criar('e1', { codigo: ' 01 ', nome: ' Prefeitura ' })
    expect(prisma.orgao.create).toHaveBeenCalledWith({ data: { entidadeId: 'e1', codigo: '01', nome: 'Prefeitura', ativo: true } })
    await expect(service.criar('e1', { codigo: '  ', nome: 'X' })).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
    await expect(service.criar('e1', { codigo: '02', nome: ' ' })).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
  })
  it('código duplicado vira CONFLITO', async () => {
    prisma.entidade.findUnique.mockResolvedValue({ id: 'e1' } as never)
    prisma.orgao.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '7.7.0' }))
    await expect(service.criar('e1', { codigo: '01', nome: 'X' })).rejects.toMatchObject({ code: 'CONFLITO' })
  })
  it('atualizar inexistente → RECURSO_NAO_ENCONTRADO', async () => {
    prisma.orgao.findUnique.mockResolvedValue(null)
    await expect(service.atualizar('x', { codigo: '01', nome: 'X' })).rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
  })
  it('excluir bloqueia órgão com unidades vinculadas', async () => {
    prisma.orgao.findUnique.mockResolvedValue({ id: 'o1', _count: { unidades: 3 } } as never)
    await expect(service.excluir('o1')).rejects.toMatchObject({ code: 'CONFLITO' })
    expect(prisma.orgao.delete).not.toHaveBeenCalled()
  })
  it('excluir remove quando sem unidades', async () => {
    prisma.orgao.findUnique.mockResolvedValue({ id: 'o1', _count: { unidades: 0 } } as never)
    await service.excluir('o1')
    expect(prisma.orgao.delete).toHaveBeenCalledWith({ where: { id: 'o1' } })
  })
})
