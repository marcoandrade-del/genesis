import { describe, it, expect, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'
import { ModelosContabeisService } from '../modelos-contabeis.js'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'

const MODELO = { id: 'm1', descricao: 'PCASP-MG', ativo: true, criadoEm: new Date(), atualizadoEm: new Date() }

const erroP2002 = new Prisma.PrismaClientKnownRequestError('Unique', { code: 'P2002', clientVersion: '7.0.0' })
const erroP2025 = new Prisma.PrismaClientKnownRequestError('Not found', { code: 'P2025', clientVersion: '7.0.0' })

let prisma: PrismaMock
let service: ModelosContabeisService

beforeEach(() => {
  prisma = criarPrismaMock()
  service = new ModelosContabeisService(prisma as never)
})

describe('ModelosContabeisService.listar', () => {
  it('retorna ordenado por descricao', async () => {
    prisma.modeloContabil.findMany.mockResolvedValue([MODELO])
    expect(await service.listar()).toEqual([MODELO])
    expect(prisma.modeloContabil.findMany).toHaveBeenCalledWith({ orderBy: { descricao: 'asc' } })
  })
})

describe('ModelosContabeisService.buscarPorId', () => {
  it('busca pelo id', async () => {
    prisma.modeloContabil.findUnique.mockResolvedValue(MODELO)
    expect(await service.buscarPorId('m1')).toEqual(MODELO)
    expect(prisma.modeloContabil.findUnique).toHaveBeenCalledWith({ where: { id: 'm1' } })
  })
})

describe('ModelosContabeisService.criar', () => {
  it('cria com sucesso', async () => {
    prisma.modeloContabil.create.mockResolvedValue(MODELO)
    expect(await service.criar({ descricao: 'PCASP-MG' })).toEqual(MODELO)
    expect(prisma.modeloContabil.create).toHaveBeenCalledWith({ data: { descricao: 'PCASP-MG' } })
  })

  it('lança CONFLITO em P2002 (descrição duplicada)', async () => {
    prisma.modeloContabil.create.mockRejectedValue(erroP2002)
    await expect(service.criar({ descricao: 'PCASP-MG' })).rejects.toMatchObject({ code: 'CONFLITO' })
  })

  it('propaga erros não-Prisma', async () => {
    prisma.modeloContabil.create.mockRejectedValue(new Error('boom'))
    await expect(service.criar({ descricao: 'X' })).rejects.toThrow('boom')
  })
})

describe('ModelosContabeisService.atualizar', () => {
  it('atualiza com sucesso', async () => {
    prisma.modeloContabil.update.mockResolvedValue({ ...MODELO, descricao: 'Novo' })
    const r = await service.atualizar('m1', { descricao: 'Novo' })
    expect(r.descricao).toBe('Novo')
  })

  it('lança CONFLITO em P2002', async () => {
    prisma.modeloContabil.update.mockRejectedValue(erroP2002)
    await expect(service.atualizar('m1', { descricao: 'X' })).rejects.toMatchObject({ code: 'CONFLITO' })
  })

  it('lança RECURSO_NAO_ENCONTRADO em P2025', async () => {
    prisma.modeloContabil.update.mockRejectedValue(erroP2025)
    await expect(service.atualizar('m1', { descricao: 'X' })).rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
  })

  it('propaga erros não-Prisma', async () => {
    prisma.modeloContabil.update.mockRejectedValue(new Error('boom'))
    await expect(service.atualizar('m1', { descricao: 'X' })).rejects.toThrow('boom')
  })

  it('propaga Prisma error com código não tratado (P2003 etc.)', async () => {
    const erro = new Prisma.PrismaClientKnownRequestError('fk', { code: 'P2003', clientVersion: '7.0.0' })
    prisma.modeloContabil.update.mockRejectedValue(erro)
    await expect(service.atualizar('m1', { descricao: 'X' })).rejects.toBe(erro)
  })
})

describe('ModelosContabeisService.excluir', () => {
  beforeEach(() => {
    prisma.modeloContabil.findUnique.mockResolvedValue(MODELO)
    prisma.estado.count.mockResolvedValue(0)
    prisma.municipio.count.mockResolvedValue(0)
    prisma.planoDeContas.count.mockResolvedValue(0)
  })

  it('exclui quando não há referências', async () => {
    await service.excluir('m1')
    expect(prisma.modeloContabil.delete).toHaveBeenCalledWith({ where: { id: 'm1' } })
  })

  it('lança RECURSO_NAO_ENCONTRADO quando modelo não existe', async () => {
    prisma.modeloContabil.findUnique.mockResolvedValue(null)
    await expect(service.excluir('xx')).rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
    expect(prisma.modeloContabil.delete).not.toHaveBeenCalled()
  })

  it('lança CONFLITO quando há estados associados', async () => {
    prisma.estado.count.mockResolvedValue(2)
    await expect(service.excluir('m1')).rejects.toMatchObject({ code: 'CONFLITO' })
  })

  it('lança CONFLITO quando há municípios associados', async () => {
    prisma.municipio.count.mockResolvedValue(1)
    await expect(service.excluir('m1')).rejects.toMatchObject({ code: 'CONFLITO' })
  })

  it('lança CONFLITO quando há planos associados', async () => {
    prisma.planoDeContas.count.mockResolvedValue(1)
    await expect(service.excluir('m1')).rejects.toMatchObject({ code: 'CONFLITO' })
  })
})
