import { describe, it, expect, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'
import { PlanosDeContasService } from '../planos-de-contas.js'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'

const MODELO = { id: 'm1', descricao: 'PCASP-MG', ativo: true }
const PLANO = { id: 'p1', descricao: 'PCASP MG 2026', ano: 2026, modeloContabilId: 'm1', criadoEm: new Date(), atualizadoEm: new Date() }

const erroP2002 = new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '7.0.0' })
const erroP2025 = new Prisma.PrismaClientKnownRequestError('not found', { code: 'P2025', clientVersion: '7.0.0' })

let prisma: PrismaMock
let service: PlanosDeContasService

beforeEach(() => {
  prisma = criarPrismaMock()
  service = new PlanosDeContasService(prisma as never)
})

describe('PlanosDeContasService.listar', () => {
  it('lista todos quando sem filtro', async () => {
    prisma.planoDeContas.findMany.mockResolvedValue([PLANO])
    expect(await service.listar()).toEqual([PLANO])
    expect(prisma.planoDeContas.findMany).toHaveBeenCalledWith({
      where: undefined,
      orderBy: [{ modeloContabilId: 'asc' }, { ano: 'desc' }],
    })
  })

  it('filtra por modeloContabilId', async () => {
    prisma.planoDeContas.findMany.mockResolvedValue([])
    await service.listar('m1')
    expect(prisma.planoDeContas.findMany).toHaveBeenCalledWith({
      where: { modeloContabilId: 'm1' },
      orderBy: [{ modeloContabilId: 'asc' }, { ano: 'desc' }],
    })
  })
})

describe('PlanosDeContasService.buscarPorId', () => {
  it('busca pelo id', async () => {
    prisma.planoDeContas.findUnique.mockResolvedValue(PLANO)
    expect(await service.buscarPorId('p1')).toEqual(PLANO)
  })
})

describe('PlanosDeContasService.criar', () => {
  it('cria com sucesso quando modelo existe', async () => {
    prisma.modeloContabil.findUnique.mockResolvedValue(MODELO)
    prisma.planoDeContas.create.mockResolvedValue(PLANO)
    const r = await service.criar({ descricao: 'PCASP MG 2026', ano: 2026, modeloContabilId: 'm1' })
    expect(r).toEqual(PLANO)
  })

  it('lança RECURSO_NAO_ENCONTRADO quando modelo não existe', async () => {
    prisma.modeloContabil.findUnique.mockResolvedValue(null)
    await expect(service.criar({ descricao: 'X', ano: 2026, modeloContabilId: 'mx' }))
      .rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
    expect(prisma.planoDeContas.create).not.toHaveBeenCalled()
  })

  it('lança CONFLITO em P2002 (mesmo modelo+ano)', async () => {
    prisma.modeloContabil.findUnique.mockResolvedValue(MODELO)
    prisma.planoDeContas.create.mockRejectedValue(erroP2002)
    await expect(service.criar({ descricao: 'X', ano: 2026, modeloContabilId: 'm1' }))
      .rejects.toMatchObject({ code: 'CONFLITO' })
  })

  it('propaga erros não-Prisma', async () => {
    prisma.modeloContabil.findUnique.mockResolvedValue(MODELO)
    prisma.planoDeContas.create.mockRejectedValue(new Error('boom'))
    await expect(service.criar({ descricao: 'X', ano: 2026, modeloContabilId: 'm1' })).rejects.toThrow('boom')
  })
})

describe('PlanosDeContasService.atualizar', () => {
  it('atualiza com sucesso', async () => {
    prisma.planoDeContas.update.mockResolvedValue({ ...PLANO, descricao: 'Novo' })
    const r = await service.atualizar('p1', { descricao: 'Novo' })
    expect(r.descricao).toBe('Novo')
  })

  it('lança CONFLITO em P2002', async () => {
    prisma.planoDeContas.update.mockRejectedValue(erroP2002)
    await expect(service.atualizar('p1', { ano: 2027 })).rejects.toMatchObject({ code: 'CONFLITO' })
  })

  it('lança RECURSO_NAO_ENCONTRADO em P2025', async () => {
    prisma.planoDeContas.update.mockRejectedValue(erroP2025)
    await expect(service.atualizar('p1', { ano: 2027 })).rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
  })

  it('propaga erros não-Prisma', async () => {
    prisma.planoDeContas.update.mockRejectedValue(new Error('boom'))
    await expect(service.atualizar('p1', { ano: 2027 })).rejects.toThrow('boom')
  })

  it('propaga Prisma error com código não tratado', async () => {
    const erro = new Prisma.PrismaClientKnownRequestError('fk', { code: 'P2003', clientVersion: '7.0.0' })
    prisma.planoDeContas.update.mockRejectedValue(erro)
    await expect(service.atualizar('p1', { ano: 2027 })).rejects.toBe(erro)
  })
})

describe('PlanosDeContasService.excluir', () => {
  it('exclui quando plano sem contas', async () => {
    prisma.planoDeContas.findUnique.mockResolvedValue(PLANO)
    prisma.conta.count.mockResolvedValue(0)
    await service.excluir('p1')
    expect(prisma.planoDeContas.delete).toHaveBeenCalledWith({ where: { id: 'p1' } })
  })

  it('lança RECURSO_NAO_ENCONTRADO quando não existe', async () => {
    prisma.planoDeContas.findUnique.mockResolvedValue(null)
    await expect(service.excluir('xx')).rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
  })

  it('lança CONFLITO quando há contas cadastradas', async () => {
    prisma.planoDeContas.findUnique.mockResolvedValue(PLANO)
    prisma.conta.count.mockResolvedValue(123)
    await expect(service.excluir('p1')).rejects.toMatchObject({ code: 'CONFLITO' })
    expect(prisma.planoDeContas.delete).not.toHaveBeenCalled()
  })
})
