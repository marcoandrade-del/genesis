import { describe, it, expect, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'
import { UnidadesOrcamentariaService } from '../unidades-orcamentaria.js'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'

const ENTIDADE = { id: 'ent1', nome: 'Prefeitura' }

let prisma: PrismaMock
let service: UnidadesOrcamentariaService

beforeEach(() => {
  prisma = criarPrismaMock()
  service = new UnidadesOrcamentariaService(prisma as never)
})

describe('UnidadesOrcamentariaService.listar', () => {
  it('lista da entidade ordenado por código', async () => {
    prisma.unidadeOrcamentaria.findMany.mockResolvedValue([])
    await service.listar('ent1')
    expect(prisma.unidadeOrcamentaria.findMany).toHaveBeenCalledWith({
      where: { entidadeId: 'ent1' },
      orderBy: { codigo: 'asc' },
    })
  })
})

describe('UnidadesOrcamentariaService.buscarPorId', () => {
  it('busca por id', async () => {
    prisma.unidadeOrcamentaria.findUnique.mockResolvedValue(null)
    await service.buscarPorId('uo1')
    expect(prisma.unidadeOrcamentaria.findUnique).toHaveBeenCalledWith({ where: { id: 'uo1' } })
  })
})

describe('UnidadesOrcamentariaService.criar', () => {
  it('caminho feliz: cria com trim em codigo+nome, ativa default true', async () => {
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    prisma.unidadeOrcamentaria.create.mockResolvedValue({ id: 'uo1' })
    await service.criar('ent1', { codigo: '  02.001 ', nome: '  Educação  ' })
    expect(prisma.unidadeOrcamentaria.create).toHaveBeenCalledWith({
      data: { entidadeId: 'ent1', codigo: '02.001', nome: 'Educação', ativa: true, orgaoId: null },
    })
  })

  it('respeita ativa=false quando passado', async () => {
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    prisma.unidadeOrcamentaria.create.mockResolvedValue({ id: 'uo1' })
    await service.criar('ent1', { codigo: 'X', nome: 'Y', ativa: false })
    expect(prisma.unidadeOrcamentaria.create.mock.calls[0][0].data.ativa).toBe(false)
  })

  it('rejeita código vazio', async () => {
    await expect(service.criar('ent1', { codigo: '   ', nome: 'X' })).rejects.toMatchObject({
      code: 'REQUISICAO_INVALIDA',
    })
    expect(prisma.entidade.findUnique).not.toHaveBeenCalled()
  })

  it('rejeita nome vazio', async () => {
    await expect(service.criar('ent1', { codigo: 'X', nome: '   ' })).rejects.toMatchObject({
      code: 'REQUISICAO_INVALIDA',
    })
  })

  it('rejeita quando entidade não existe', async () => {
    prisma.entidade.findUnique.mockResolvedValue(null)
    await expect(service.criar('xx', { codigo: 'X', nome: 'Y' })).rejects.toMatchObject({
      code: 'RECURSO_NAO_ENCONTRADO',
    })
  })

  it('rejeita código duplicado (P2002) como CONFLITO', async () => {
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    prisma.unidadeOrcamentaria.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '7.7.0' }),
    )
    await expect(service.criar('ent1', { codigo: 'X', nome: 'Y' })).rejects.toMatchObject({
      code: 'CONFLITO',
      message: expect.stringContaining('Já existe'),
    })
  })

  it('repassa outros erros do Prisma', async () => {
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    prisma.unidadeOrcamentaria.create.mockRejectedValue(new Error('boom'))
    await expect(service.criar('ent1', { codigo: 'X', nome: 'Y' })).rejects.toThrow('boom')
  })
})

describe('UnidadesOrcamentariaService.atualizar', () => {
  const UO = { id: 'uo1', entidadeId: 'ent1', codigo: 'X', nome: 'Y', ativa: true }

  it('atualiza com trim', async () => {
    prisma.unidadeOrcamentaria.findUnique.mockResolvedValue(UO)
    prisma.unidadeOrcamentaria.update.mockResolvedValue(UO)
    await service.atualizar('uo1', { codigo: ' Z ', nome: ' W ' })
    expect(prisma.unidadeOrcamentaria.update).toHaveBeenCalledWith({
      where: { id: 'uo1' },
      data: { codigo: 'Z', nome: 'W', ativa: true },
    })
  })

  it('preserva ativa atual quando não informado', async () => {
    prisma.unidadeOrcamentaria.findUnique.mockResolvedValue({ ...UO, ativa: false })
    prisma.unidadeOrcamentaria.update.mockResolvedValue(UO)
    await service.atualizar('uo1', { codigo: 'Z', nome: 'W' })
    expect(prisma.unidadeOrcamentaria.update.mock.calls[0][0].data.ativa).toBe(false)
  })

  it('aplica ativa quando informado', async () => {
    prisma.unidadeOrcamentaria.findUnique.mockResolvedValue(UO)
    prisma.unidadeOrcamentaria.update.mockResolvedValue(UO)
    await service.atualizar('uo1', { codigo: 'Z', nome: 'W', ativa: false })
    expect(prisma.unidadeOrcamentaria.update.mock.calls[0][0].data.ativa).toBe(false)
  })

  it('rejeita código vazio', async () => {
    await expect(service.atualizar('uo1', { codigo: '   ', nome: 'X' })).rejects.toMatchObject({
      code: 'REQUISICAO_INVALIDA',
    })
  })

  it('rejeita nome vazio', async () => {
    await expect(service.atualizar('uo1', { codigo: 'X', nome: '   ' })).rejects.toMatchObject({
      code: 'REQUISICAO_INVALIDA',
    })
  })

  it('404 quando UO não existe', async () => {
    prisma.unidadeOrcamentaria.findUnique.mockResolvedValue(null)
    await expect(service.atualizar('xx', { codigo: 'X', nome: 'Y' })).rejects.toMatchObject({
      code: 'RECURSO_NAO_ENCONTRADO',
    })
  })

  it('código duplicado vira CONFLITO', async () => {
    prisma.unidadeOrcamentaria.findUnique.mockResolvedValue(UO)
    prisma.unidadeOrcamentaria.update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '7.7.0' }),
    )
    await expect(service.atualizar('uo1', { codigo: 'X', nome: 'Y' })).rejects.toMatchObject({
      code: 'CONFLITO',
    })
  })

  it('repassa outros erros', async () => {
    prisma.unidadeOrcamentaria.findUnique.mockResolvedValue(UO)
    prisma.unidadeOrcamentaria.update.mockRejectedValue(new Error('boom'))
    await expect(service.atualizar('uo1', { codigo: 'X', nome: 'Y' })).rejects.toThrow('boom')
  })
})

describe('UnidadesOrcamentariaService.excluir', () => {
  it('exclui quando existe', async () => {
    prisma.unidadeOrcamentaria.findUnique.mockResolvedValue({ id: 'uo1' })
    prisma.unidadeOrcamentaria.delete.mockResolvedValue({})
    await service.excluir('uo1')
    expect(prisma.unidadeOrcamentaria.delete).toHaveBeenCalledWith({ where: { id: 'uo1' } })
  })

  it('404 quando não existe', async () => {
    prisma.unidadeOrcamentaria.findUnique.mockResolvedValue(null)
    await expect(service.excluir('xx')).rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
    expect(prisma.unidadeOrcamentaria.delete).not.toHaveBeenCalled()
  })
})
