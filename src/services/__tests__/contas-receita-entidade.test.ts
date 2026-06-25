import { describe, it, expect, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'
import { ContasReceitaEntidadeService } from '../contas-receita-entidade.js'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'

const PAI = { id: 'p1', entidadeId: 'e1', ano: 2026, codigo: '1.1.1', descricao: 'Impostos', nivel: 3, admiteMovimento: true, origem: 'MODELO', parentId: 'pp' }
const erroP2002 = new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '7.0.0' })

let prisma: PrismaMock
let service: ContasReceitaEntidadeService

beforeEach(() => {
  prisma = criarPrismaMock()
  service = new ContasReceitaEntidadeService(prisma as never)
})

describe('listar / buscar', () => {
  it('raizes', async () => {
    prisma.contaReceitaEntidade.findMany.mockResolvedValue([PAI])
    await service.listarRaizes('e1', 2026)
    expect(prisma.contaReceitaEntidade.findMany).toHaveBeenCalledWith({ where: { entidadeId: 'e1', ano: 2026, parentId: null }, orderBy: { codigo: 'asc' } })
  })
  it('filhos', async () => {
    prisma.contaReceitaEntidade.findMany.mockResolvedValue([])
    await service.listarFilhos('p1')
    expect(prisma.contaReceitaEntidade.findMany).toHaveBeenCalledWith({ where: { parentId: 'p1' }, orderBy: { codigo: 'asc' } })
  })
  it('buscarPorId', async () => {
    prisma.contaReceitaEntidade.findUnique.mockResolvedValue(PAI)
    expect(await service.buscarPorId('p1')).toEqual(PAI)
  })
})

describe('sugerirCodigo', () => {
  it('preenche o primeiro segmento zerado da máscara (não anexa)', async () => {
    prisma.contaReceitaEntidade.findUnique.mockResolvedValue({ ...PAI, codigo: '1.7.1.1.51.2.1.00.00.00.00.00' })
    prisma.contaReceitaEntidade.findMany.mockResolvedValue([])
    expect(await service.sugerirCodigo('p1')).toBe('1.7.1.1.51.2.1.01.00.00.00.00')
  })
  it('RECURSO_NAO_ENCONTRADO quando pai não existe', async () => {
    prisma.contaReceitaEntidade.findUnique.mockResolvedValue(null)
    await expect(service.sugerirCodigo('xx')).rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
  })
})

describe('desdobrar', () => {
  it('cria filho analítico e torna o pai sintético', async () => {
    prisma.contaReceitaEntidade.findUnique.mockResolvedValue(PAI)
    prisma.contaReceitaEntidade.create.mockResolvedValue({ id: 'f1', entidadeId: 'e1', ano: 2026 })
    await service.desdobrar('p1', { codigo: '1.1.1.01', descricao: 'IPTU' })
    expect(prisma.contaReceitaEntidade.create).toHaveBeenCalledWith({
      data: { entidadeId: 'e1', ano: 2026, codigo: '1.1.1.01', descricao: 'IPTU', nivel: 4, admiteMovimento: true, origem: 'DESDOBRAMENTO', parentId: 'p1' },
    })
    expect(prisma.contaReceitaEntidade.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { admiteMovimento: false } })
  })
  it('reaponta as previsões (sem execução) da mãe para a filha', async () => {
    prisma.contaReceitaEntidade.findUnique.mockResolvedValue(PAI)
    prisma.contaReceitaEntidade.create.mockResolvedValue({ id: 'f1', entidadeId: 'e1', ano: 2026 })
    await service.desdobrar('p1', { codigo: '1.1.1.01', descricao: 'IPTU' })
    expect(prisma.previsaoReceita.updateMany).toHaveBeenCalledWith({
      where: { contaReceitaEntidadeId: 'p1' },
      data: { contaReceitaEntidadeId: 'f1' },
    })
  })
  it('CONFLITO quando a conta tem previsão já executada (arrecadação/lançamento)', async () => {
    prisma.contaReceitaEntidade.findUnique.mockResolvedValue(PAI)
    prisma.previsaoReceita.count.mockResolvedValue(1)
    await expect(service.desdobrar('p1', { codigo: '1.1.1.01', descricao: 'IPTU' })).rejects.toMatchObject({ code: 'CONFLITO' })
    expect(prisma.contaReceitaEntidade.create).not.toHaveBeenCalled()
    expect(prisma.previsaoReceita.updateMany).not.toHaveBeenCalled()
  })
  it('RECURSO_NAO_ENCONTRADO quando conta não existe', async () => {
    prisma.contaReceitaEntidade.findUnique.mockResolvedValue(null)
    await expect(service.desdobrar('xx', { codigo: '1', descricao: 'X' })).rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
  })
  it('CONFLITO quando sintética', async () => {
    prisma.contaReceitaEntidade.findUnique.mockResolvedValue({ ...PAI, admiteMovimento: false })
    await expect(service.desdobrar('p1', { codigo: '1', descricao: 'X' })).rejects.toMatchObject({ code: 'CONFLITO' })
  })
  it('REQUISICAO_INVALIDA quando código vazio', async () => {
    prisma.contaReceitaEntidade.findUnique.mockResolvedValue(PAI)
    await expect(service.desdobrar('p1', { codigo: '  ', descricao: 'X' })).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
  })
  it('REQUISICAO_INVALIDA quando descrição vazia', async () => {
    prisma.contaReceitaEntidade.findUnique.mockResolvedValue(PAI)
    await expect(service.desdobrar('p1', { codigo: '1.1.1.01', descricao: ' ' })).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
  })
  it('CONFLITO em P2002', async () => {
    prisma.contaReceitaEntidade.findUnique.mockResolvedValue(PAI)
    prisma.contaReceitaEntidade.create.mockRejectedValue(erroP2002)
    await expect(service.desdobrar('p1', { codigo: '1.1.1.01', descricao: 'X' })).rejects.toMatchObject({ code: 'CONFLITO' })
  })
  it('propaga erros não-Prisma', async () => {
    prisma.contaReceitaEntidade.findUnique.mockResolvedValue(PAI)
    prisma.contaReceitaEntidade.create.mockRejectedValue(new Error('boom'))
    await expect(service.desdobrar('p1', { codigo: '1.1.1.01', descricao: 'X' })).rejects.toThrow('boom')
  })
})

describe('excluir', () => {
  const DESD = { id: 'd1', entidadeId: 'e1', ano: 2026, codigo: '1.1.1.01', descricao: 'Sub', nivel: 4, admiteMovimento: true, origem: 'DESDOBRAMENTO', parentId: 'p1' }
  it('exclui desdobramento folha e reverte o pai a analítica', async () => {
    prisma.contaReceitaEntidade.findUnique.mockResolvedValue(DESD)
    prisma.contaReceitaEntidade.count.mockResolvedValueOnce(0).mockResolvedValueOnce(0)
    const r = await service.excluir('d1')
    expect(prisma.contaReceitaEntidade.delete).toHaveBeenCalledWith({ where: { id: 'd1' } })
    expect(prisma.contaReceitaEntidade.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { admiteMovimento: true } })
    expect(r).toEqual(DESD)
  })
  it('não reverte o pai quando há irmãos', async () => {
    prisma.contaReceitaEntidade.findUnique.mockResolvedValue(DESD)
    prisma.contaReceitaEntidade.count.mockResolvedValueOnce(0).mockResolvedValueOnce(2)
    await service.excluir('d1')
    expect(prisma.contaReceitaEntidade.update).not.toHaveBeenCalled()
  })
  it('bloqueia MODELO / com filhos / P2003 / não encontrada', async () => {
    prisma.contaReceitaEntidade.findUnique.mockResolvedValue({ ...DESD, origem: 'MODELO' })
    await expect(service.excluir('d1')).rejects.toMatchObject({ code: 'CONFLITO' })
    prisma.contaReceitaEntidade.findUnique.mockResolvedValue(DESD)
    prisma.contaReceitaEntidade.count.mockResolvedValue(1)
    await expect(service.excluir('d1')).rejects.toMatchObject({ code: 'CONFLITO' })
    prisma.contaReceitaEntidade.count.mockReset()
    prisma.contaReceitaEntidade.count.mockResolvedValue(0)
    prisma.contaReceitaEntidade.delete.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('fk', { code: 'P2003', clientVersion: '7.0.0' }))
    await expect(service.excluir('d1')).rejects.toMatchObject({ code: 'CONFLITO' })
    prisma.contaReceitaEntidade.findUnique.mockResolvedValue(null)
    await expect(service.excluir('x')).rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
  })
})
