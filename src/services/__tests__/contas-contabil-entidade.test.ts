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
  it('preenche o primeiro segmento zerado da máscara (não anexa)', async () => {
    prisma.contaContabilEntidade.findUnique.mockResolvedValue({ ...PAI, codigo: '1.1.1.1.1.01.00.00.00.00.00.00' })
    prisma.contaContabilEntidade.findMany.mockResolvedValue([])
    expect(await service.sugerirCodigo('p1')).toBe('1.1.1.1.1.01.01.00.00.00.00.00')
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
  it('CONFLITO quando sintética do modelo (sem desdobramentos)', async () => {
    prisma.contaContabilEntidade.findUnique.mockResolvedValue({ ...PAI, admiteMovimento: false })
    prisma.contaContabilEntidade.count.mockResolvedValue(0) // não é desdobramento-pai
    await expect(service.desdobrar('p1', { codigo: '1', descricao: 'X' })).rejects.toMatchObject({ code: 'CONFLITO' })
  })
  it('desdobramento-pai (sintética COM filho desdobramento) recebe mais um filho, sem reverter', async () => {
    prisma.contaContabilEntidade.findUnique.mockResolvedValue({ ...PAI, admiteMovimento: false })
    prisma.contaContabilEntidade.count.mockResolvedValue(1) // já tem 1 desdobramento
    prisma.contaContabilEntidade.create.mockResolvedValue({ id: 'f2' })
    await service.desdobrar('p1', { codigo: '1.1.1.02', descricao: 'Caixa B' })
    expect(prisma.contaContabilEntidade.create).toHaveBeenCalled()
    expect(prisma.contaContabilEntidade.update).not.toHaveBeenCalled() // não vira sintética de novo
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

describe('excluir', () => {
  const DESD = { id: 'd1', entidadeId: 'e1', ano: 2026, codigo: '1.1.1.01', descricao: 'Caixa Geral', nivel: 4, admiteMovimento: true, origem: 'DESDOBRAMENTO', parentId: 'p1' }

  it('exclui um desdobramento folha e reverte o pai a analítica', async () => {
    prisma.contaContabilEntidade.findUnique.mockResolvedValue(DESD)
    prisma.contaContabilEntidade.count.mockResolvedValueOnce(0).mockResolvedValueOnce(0) // filhos=0; irmãos pós=0
    const r = await service.excluir('d1')
    expect(prisma.contaContabilEntidade.delete).toHaveBeenCalledWith({ where: { id: 'd1' } })
    expect(prisma.contaContabilEntidade.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { admiteMovimento: true } })
    expect(r).toEqual(DESD)
  })

  it('NÃO reverte o pai quando ainda há irmãos', async () => {
    prisma.contaContabilEntidade.findUnique.mockResolvedValue(DESD)
    prisma.contaContabilEntidade.count.mockResolvedValueOnce(0).mockResolvedValueOnce(2)
    await service.excluir('d1')
    expect(prisma.contaContabilEntidade.update).not.toHaveBeenCalled()
  })

  it('bloqueia excluir conta do MODELO', async () => {
    prisma.contaContabilEntidade.findUnique.mockResolvedValue({ ...DESD, origem: 'MODELO' })
    await expect(service.excluir('d1')).rejects.toMatchObject({ code: 'CONFLITO' })
    expect(prisma.contaContabilEntidade.delete).not.toHaveBeenCalled()
  })

  it('bloqueia quando tem filhos', async () => {
    prisma.contaContabilEntidade.findUnique.mockResolvedValue(DESD)
    prisma.contaContabilEntidade.count.mockResolvedValue(1)
    await expect(service.excluir('d1')).rejects.toMatchObject({ code: 'CONFLITO' })
    expect(prisma.contaContabilEntidade.delete).not.toHaveBeenCalled()
  })

  it('bloqueia (P2003) conta com movimentação', async () => {
    prisma.contaContabilEntidade.findUnique.mockResolvedValue(DESD)
    prisma.contaContabilEntidade.count.mockResolvedValueOnce(0)
    prisma.contaContabilEntidade.delete.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('fk', { code: 'P2003', clientVersion: '7.0.0' }))
    await expect(service.excluir('d1')).rejects.toMatchObject({ code: 'CONFLITO' })
  })

  it('não encontrada', async () => {
    prisma.contaContabilEntidade.findUnique.mockResolvedValue(null)
    await expect(service.excluir('x')).rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
  })

  it('propaga erro não-Prisma na exclusão', async () => {
    prisma.contaContabilEntidade.findUnique.mockResolvedValue(DESD)
    prisma.contaContabilEntidade.count.mockResolvedValueOnce(0)
    prisma.contaContabilEntidade.delete.mockRejectedValue(new Error('boom'))
    await expect(service.excluir('d1')).rejects.toThrow('boom')
  })
})

describe('editarDescricao', () => {
  const DESD = { id: 'd1', origem: 'DESDOBRAMENTO', descricao: 'Antiga' }

  it('edita a descrição de um desdobramento (com trim)', async () => {
    prisma.contaContabilEntidade.findUnique.mockResolvedValue(DESD)
    prisma.contaContabilEntidade.update.mockResolvedValue({ ...DESD, descricao: 'Nova' })
    await service.editarDescricao('d1', '  Nova  ')
    expect(prisma.contaContabilEntidade.update).toHaveBeenCalledWith({ where: { id: 'd1' }, data: { descricao: 'Nova' } })
  })

  it('bloqueia editar conta do MODELO', async () => {
    prisma.contaContabilEntidade.findUnique.mockResolvedValue({ id: 'm1', origem: 'MODELO', descricao: 'X' })
    await expect(service.editarDescricao('m1', 'Y')).rejects.toMatchObject({ code: 'CONFLITO' })
    expect(prisma.contaContabilEntidade.update).not.toHaveBeenCalled()
  })

  it('REQUISICAO_INVALIDA quando descrição vazia', async () => {
    prisma.contaContabilEntidade.findUnique.mockResolvedValue(DESD)
    await expect(service.editarDescricao('d1', '   ')).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
  })

  it('RECURSO_NAO_ENCONTRADO quando não existe', async () => {
    prisma.contaContabilEntidade.findUnique.mockResolvedValue(null)
    await expect(service.editarDescricao('x', 'Y')).rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
  })
})
