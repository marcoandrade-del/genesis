import { describe, it, expect, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'
import { PlanosContasDespesaService } from '../planos-contas-despesa.js'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'

const MODELO = { id: 'm1', descricao: 'PARANÁ', ativo: true }
const PLANO = { id: 'pd1', descricao: 'Despesa PR 2026', ano: 2026, modeloContabilId: 'm1', criadoEm: new Date(), atualizadoEm: new Date() }

const erroP2002 = new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '7.0.0' })
const erroP2025 = new Prisma.PrismaClientKnownRequestError('not found', { code: 'P2025', clientVersion: '7.0.0' })

let prisma: PrismaMock
let service: PlanosContasDespesaService

beforeEach(() => {
  prisma = criarPrismaMock()
  service = new PlanosContasDespesaService(prisma as never)
})

describe('PlanosContasDespesaService.listar', () => {
  it('lista todos quando sem filtro', async () => {
    prisma.planoContasDespesa.findMany.mockResolvedValue([PLANO])
    expect(await service.listar()).toEqual([PLANO])
    expect(prisma.planoContasDespesa.findMany).toHaveBeenCalledWith({
      where: undefined,
      orderBy: [{ modeloContabilId: 'asc' }, { ano: 'desc' }],
    })
  })

  it('filtra por modeloContabilId', async () => {
    prisma.planoContasDespesa.findMany.mockResolvedValue([])
    await service.listar('m1')
    expect(prisma.planoContasDespesa.findMany).toHaveBeenCalledWith({
      where: { modeloContabilId: 'm1' },
      orderBy: [{ modeloContabilId: 'asc' }, { ano: 'desc' }],
    })
  })
})

describe('PlanosContasDespesaService.buscarPorId', () => {
  it('busca pelo id', async () => {
    prisma.planoContasDespesa.findUnique.mockResolvedValue(PLANO)
    expect(await service.buscarPorId('pd1')).toEqual(PLANO)
  })
})

describe('PlanosContasDespesaService.criar', () => {
  it('cria com sucesso quando modelo existe', async () => {
    prisma.modeloContabil.findUnique.mockResolvedValue(MODELO)
    prisma.planoContasDespesa.create.mockResolvedValue(PLANO)
    const r = await service.criar({ descricao: 'Despesa PR 2026', ano: 2026, modeloContabilId: 'm1' })
    expect(r).toEqual(PLANO)
  })

  it('lança RECURSO_NAO_ENCONTRADO quando modelo não existe', async () => {
    prisma.modeloContabil.findUnique.mockResolvedValue(null)
    await expect(service.criar({ descricao: 'X', ano: 2026, modeloContabilId: 'mx' }))
      .rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
    expect(prisma.planoContasDespesa.create).not.toHaveBeenCalled()
  })

  it('lança CONFLITO em P2002 (mesmo modelo+ano)', async () => {
    prisma.modeloContabil.findUnique.mockResolvedValue(MODELO)
    prisma.planoContasDespesa.create.mockRejectedValue(erroP2002)
    await expect(service.criar({ descricao: 'X', ano: 2026, modeloContabilId: 'm1' }))
      .rejects.toMatchObject({ code: 'CONFLITO' })
  })

  it('propaga erros não-Prisma', async () => {
    prisma.modeloContabil.findUnique.mockResolvedValue(MODELO)
    prisma.planoContasDespesa.create.mockRejectedValue(new Error('boom'))
    await expect(service.criar({ descricao: 'X', ano: 2026, modeloContabilId: 'm1' })).rejects.toThrow('boom')
  })
})

describe('PlanosContasDespesaService.atualizar', () => {
  it('atualiza com sucesso', async () => {
    prisma.planoContasDespesa.update.mockResolvedValue({ ...PLANO, descricao: 'Novo' })
    const r = await service.atualizar('pd1', { descricao: 'Novo' })
    expect(r.descricao).toBe('Novo')
  })

  it('lança CONFLITO em P2002', async () => {
    prisma.planoContasDespesa.update.mockRejectedValue(erroP2002)
    await expect(service.atualizar('pd1', { ano: 2027 })).rejects.toMatchObject({ code: 'CONFLITO' })
  })

  it('lança RECURSO_NAO_ENCONTRADO em P2025', async () => {
    prisma.planoContasDespesa.update.mockRejectedValue(erroP2025)
    await expect(service.atualizar('pd1', { ano: 2027 })).rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
  })

  it('propaga erros não-Prisma', async () => {
    prisma.planoContasDespesa.update.mockRejectedValue(new Error('boom'))
    await expect(service.atualizar('pd1', { ano: 2027 })).rejects.toThrow('boom')
  })

  it('propaga Prisma error com código não tratado', async () => {
    const erro = new Prisma.PrismaClientKnownRequestError('fk', { code: 'P2003', clientVersion: '7.0.0' })
    prisma.planoContasDespesa.update.mockRejectedValue(erro)
    await expect(service.atualizar('pd1', { ano: 2027 })).rejects.toBe(erro)
  })
})

describe('PlanosContasDespesaService.excluir', () => {
  it('exclui quando plano sem contas', async () => {
    prisma.planoContasDespesa.findUnique.mockResolvedValue(PLANO)
    prisma.contaDespesa.count.mockResolvedValue(0)
    await service.excluir('pd1')
    expect(prisma.planoContasDespesa.delete).toHaveBeenCalledWith({ where: { id: 'pd1' } })
  })

  it('lança RECURSO_NAO_ENCONTRADO quando não existe', async () => {
    prisma.planoContasDespesa.findUnique.mockResolvedValue(null)
    await expect(service.excluir('xx')).rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
  })

  it('lança CONFLITO quando há contas cadastradas', async () => {
    prisma.planoContasDespesa.findUnique.mockResolvedValue(PLANO)
    prisma.contaDespesa.count.mockResolvedValue(50)
    await expect(service.excluir('pd1')).rejects.toMatchObject({ code: 'CONFLITO' })
    expect(prisma.planoContasDespesa.delete).not.toHaveBeenCalled()
  })
})
