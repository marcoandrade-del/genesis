import { describe, it, expect, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'
import { ContasDespesaEntidadeService } from '../contas-despesa-entidade.js'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'

const PAI = { id: 'p1', entidadeId: 'e1', ano: 2026, codigo: '3.1.90.11', descricao: 'Vencimentos', nivel: 4, admiteMovimento: true, origem: 'MODELO', parentId: 'pp' }
const erroP2002 = new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '7.0.0' })

let prisma: PrismaMock
let service: ContasDespesaEntidadeService

beforeEach(() => {
  prisma = criarPrismaMock()
  service = new ContasDespesaEntidadeService(prisma as never)
})

describe('listarRaizes / listarFilhos / buscarPorId', () => {
  it('raizes: entidade + ano + parentId null', async () => {
    prisma.contaDespesaEntidade.findMany.mockResolvedValue([PAI])
    await service.listarRaizes('e1', 2026)
    expect(prisma.contaDespesaEntidade.findMany).toHaveBeenCalledWith({
      where: { entidadeId: 'e1', ano: 2026, parentId: null }, orderBy: { codigo: 'asc' },
    })
  })

  it('filhos: por parentId', async () => {
    prisma.contaDespesaEntidade.findMany.mockResolvedValue([])
    await service.listarFilhos('p1')
    expect(prisma.contaDespesaEntidade.findMany).toHaveBeenCalledWith({ where: { parentId: 'p1' }, orderBy: { codigo: 'asc' } })
  })

  it('buscarPorId', async () => {
    prisma.contaDespesaEntidade.findUnique.mockResolvedValue(PAI)
    expect(await service.buscarPorId('p1')).toEqual(PAI)
  })
})

describe('sugerirCodigo', () => {
  it('sugere pai + sufixo sequencial de 2 dígitos', async () => {
    prisma.contaDespesaEntidade.findUnique.mockResolvedValue(PAI)
    prisma.contaDespesaEntidade.count.mockResolvedValue(2)
    expect(await service.sugerirCodigo('p1')).toBe('3.1.90.11.03')
  })

  it('lança RECURSO_NAO_ENCONTRADO quando pai não existe', async () => {
    prisma.contaDespesaEntidade.findUnique.mockResolvedValue(null)
    await expect(service.sugerirCodigo('xx')).rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
  })
})

describe('desdobrar', () => {
  it('cria filho analítico (DESDOBRAMENTO) e torna o pai sintético', async () => {
    prisma.contaDespesaEntidade.findUnique.mockResolvedValue(PAI)
    prisma.contaDespesaEntidade.create.mockResolvedValue({ id: 'f1', entidadeId: 'e1', ano: 2026 })

    const r = await service.desdobrar('p1', { codigo: '3.1.90.11.01', descricao: 'Salários' })

    expect(r).toMatchObject({ id: 'f1' })
    expect(prisma.contaDespesaEntidade.create).toHaveBeenCalledWith({
      data: {
        entidadeId: 'e1', ano: 2026, codigo: '3.1.90.11.01', descricao: 'Salários',
        nivel: 5, admiteMovimento: true, origem: 'DESDOBRAMENTO', parentId: 'p1',
      },
    })
    expect(prisma.contaDespesaEntidade.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { admiteMovimento: false } })
  })

  it('lança RECURSO_NAO_ENCONTRADO quando conta não existe', async () => {
    prisma.contaDespesaEntidade.findUnique.mockResolvedValue(null)
    await expect(service.desdobrar('xx', { codigo: '1', descricao: 'X' }))
      .rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
  })

  it('lança CONFLITO quando a conta é sintética', async () => {
    prisma.contaDespesaEntidade.findUnique.mockResolvedValue({ ...PAI, admiteMovimento: false })
    await expect(service.desdobrar('p1', { codigo: '1', descricao: 'X' }))
      .rejects.toMatchObject({ code: 'CONFLITO' })
    expect(prisma.contaDespesaEntidade.create).not.toHaveBeenCalled()
  })

  it('lança REQUISICAO_INVALIDA quando código vazio', async () => {
    prisma.contaDespesaEntidade.findUnique.mockResolvedValue(PAI)
    await expect(service.desdobrar('p1', { codigo: '   ', descricao: 'X' }))
      .rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
  })

  it('lança REQUISICAO_INVALIDA quando descrição vazia', async () => {
    prisma.contaDespesaEntidade.findUnique.mockResolvedValue(PAI)
    await expect(service.desdobrar('p1', { codigo: '3.1.90.11.01', descricao: '  ' }))
      .rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
  })

  it('lança CONFLITO em P2002 (código duplicado)', async () => {
    prisma.contaDespesaEntidade.findUnique.mockResolvedValue(PAI)
    prisma.contaDespesaEntidade.create.mockRejectedValue(erroP2002)
    await expect(service.desdobrar('p1', { codigo: '3.1.90.11.01', descricao: 'X' }))
      .rejects.toMatchObject({ code: 'CONFLITO' })
  })

  it('propaga erros não-Prisma', async () => {
    prisma.contaDespesaEntidade.findUnique.mockResolvedValue(PAI)
    prisma.contaDespesaEntidade.create.mockRejectedValue(new Error('boom'))
    await expect(service.desdobrar('p1', { codigo: '3.1.90.11.01', descricao: 'X' })).rejects.toThrow('boom')
  })
})

describe('excluir', () => {
  const DESD = { id: 'd1', entidadeId: 'e1', ano: 2026, codigo: '3.1.90.11.01', descricao: 'Sub', nivel: 5, admiteMovimento: true, origem: 'DESDOBRAMENTO', parentId: 'p1' }
  it('exclui desdobramento folha e reverte o pai a analítica', async () => {
    prisma.contaDespesaEntidade.findUnique.mockResolvedValue(DESD)
    prisma.contaDespesaEntidade.count.mockResolvedValueOnce(0).mockResolvedValueOnce(0)
    const r = await service.excluir('d1')
    expect(prisma.contaDespesaEntidade.delete).toHaveBeenCalledWith({ where: { id: 'd1' } })
    expect(prisma.contaDespesaEntidade.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { admiteMovimento: true } })
    expect(r).toEqual(DESD)
  })
  it('não reverte o pai quando há irmãos', async () => {
    prisma.contaDespesaEntidade.findUnique.mockResolvedValue(DESD)
    prisma.contaDespesaEntidade.count.mockResolvedValueOnce(0).mockResolvedValueOnce(2)
    await service.excluir('d1')
    expect(prisma.contaDespesaEntidade.update).not.toHaveBeenCalled()
  })
  it('bloqueia MODELO / com filhos / P2003 / não encontrada', async () => {
    prisma.contaDespesaEntidade.findUnique.mockResolvedValue({ ...DESD, origem: 'MODELO' })
    await expect(service.excluir('d1')).rejects.toMatchObject({ code: 'CONFLITO' })
    prisma.contaDespesaEntidade.findUnique.mockResolvedValue(DESD)
    prisma.contaDespesaEntidade.count.mockResolvedValue(1)
    await expect(service.excluir('d1')).rejects.toMatchObject({ code: 'CONFLITO' })
    prisma.contaDespesaEntidade.count.mockReset()
    prisma.contaDespesaEntidade.count.mockResolvedValue(0)
    prisma.contaDespesaEntidade.delete.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('fk', { code: 'P2003', clientVersion: '7.0.0' }))
    await expect(service.excluir('d1')).rejects.toMatchObject({ code: 'CONFLITO' })
    prisma.contaDespesaEntidade.findUnique.mockResolvedValue(null)
    await expect(service.excluir('x')).rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
  })
})
