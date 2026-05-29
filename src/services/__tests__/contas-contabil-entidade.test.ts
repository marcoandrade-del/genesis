import { describe, it, expect, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'
import { ContasContabilEntidadeService } from '../contas-contabil-entidade.js'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'

const PAI = { id: 'p1', entidadeId: 'e1', ano: 2026, codigo: '1.1.1', descricao: 'Caixa', nivel: 3, admiteMovimento: true, origem: 'MODELO', parentId: 'pp' }
const erroP2002 = new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '7.0.0' })

let prisma: PrismaMock
let service: ContasContabilEntidadeService

beforeEach(() => {
  prisma = criarPrismaMock()
  service = new ContasContabilEntidadeService(prisma as never)
})

describe('listar / buscar', () => {
  it('raizes', async () => {
    prisma.contaContabilEntidade.findMany.mockResolvedValue([PAI])
    await service.listarRaizes('e1', 2026)
    expect(prisma.contaContabilEntidade.findMany).toHaveBeenCalledWith({ where: { entidadeId: 'e1', ano: 2026, parentId: null }, orderBy: { codigo: 'asc' } })
  })
  it('filhos', async () => {
    prisma.contaContabilEntidade.findMany.mockResolvedValue([])
    await service.listarFilhos('p1')
    expect(prisma.contaContabilEntidade.findMany).toHaveBeenCalledWith({ where: { parentId: 'p1' }, orderBy: { codigo: 'asc' } })
  })
  it('buscarPorId', async () => {
    prisma.contaContabilEntidade.findUnique.mockResolvedValue(PAI)
    expect(await service.buscarPorId('p1')).toEqual(PAI)
  })
})

describe('sugerirCodigo', () => {
  it('pai + sufixo sequencial', async () => {
    prisma.contaContabilEntidade.findUnique.mockResolvedValue(PAI)
    prisma.contaContabilEntidade.count.mockResolvedValue(4)
    expect(await service.sugerirCodigo('p1')).toBe('1.1.1.05')
  })
  it('RECURSO_NAO_ENCONTRADO quando pai não existe', async () => {
    prisma.contaContabilEntidade.findUnique.mockResolvedValue(null)
    await expect(service.sugerirCodigo('xx')).rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
  })
})

describe('desdobrar', () => {
  it('cria filho analítico e torna o pai sintético', async () => {
    prisma.contaContabilEntidade.findUnique.mockResolvedValue(PAI)
    prisma.contaContabilEntidade.create.mockResolvedValue({ id: 'f1', entidadeId: 'e1', ano: 2026 })
    await service.desdobrar('p1', { codigo: '1.1.1.01', descricao: 'Caixa Geral' })
    expect(prisma.contaContabilEntidade.create).toHaveBeenCalledWith({
      data: { entidadeId: 'e1', ano: 2026, codigo: '1.1.1.01', descricao: 'Caixa Geral', nivel: 4, admiteMovimento: true, origem: 'DESDOBRAMENTO', parentId: 'p1' },
    })
    expect(prisma.contaContabilEntidade.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { admiteMovimento: false } })
  })
  it('RECURSO_NAO_ENCONTRADO quando conta não existe', async () => {
    prisma.contaContabilEntidade.findUnique.mockResolvedValue(null)
    await expect(service.desdobrar('xx', { codigo: '1', descricao: 'X' })).rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
  })
  it('CONFLITO quando sintética', async () => {
    prisma.contaContabilEntidade.findUnique.mockResolvedValue({ ...PAI, admiteMovimento: false })
    await expect(service.desdobrar('p1', { codigo: '1', descricao: 'X' })).rejects.toMatchObject({ code: 'CONFLITO' })
  })
  it('REQUISICAO_INVALIDA quando código vazio', async () => {
    prisma.contaContabilEntidade.findUnique.mockResolvedValue(PAI)
    await expect(service.desdobrar('p1', { codigo: '  ', descricao: 'X' })).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
  })
  it('REQUISICAO_INVALIDA quando descrição vazia', async () => {
    prisma.contaContabilEntidade.findUnique.mockResolvedValue(PAI)
    await expect(service.desdobrar('p1', { codigo: '1.1.1.01', descricao: ' ' })).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
  })
  it('CONFLITO em P2002', async () => {
    prisma.contaContabilEntidade.findUnique.mockResolvedValue(PAI)
    prisma.contaContabilEntidade.create.mockRejectedValue(erroP2002)
    await expect(service.desdobrar('p1', { codigo: '1.1.1.01', descricao: 'X' })).rejects.toMatchObject({ code: 'CONFLITO' })
  })
  it('propaga erros não-Prisma', async () => {
    prisma.contaContabilEntidade.findUnique.mockResolvedValue(PAI)
    prisma.contaContabilEntidade.create.mockRejectedValue(new Error('boom'))
    await expect(service.desdobrar('p1', { codigo: '1.1.1.01', descricao: 'X' })).rejects.toThrow('boom')
  })
})
