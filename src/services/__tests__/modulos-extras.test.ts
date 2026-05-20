import { describe, it, expect, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'
import { ModulosService } from '../modulos.js'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'

const erro = (code: string) => new Prisma.PrismaClientKnownRequestError('x', { code, clientVersion: '7.0.0' })
const SISTEMA = { id: 's1', ativo: true }
const MODULO = { id: 'm1', nome: 'Mod', sistemaId: 's1', ativo: true }

describe('ModulosService — leituras', () => {
  let prisma: PrismaMock
  let service: ModulosService

  beforeEach(() => {
    prisma = criarPrismaMock()
    service = new ModulosService(prisma as never)
  })

  it('listar retorna módulos ordenados por nome', async () => {
    prisma.sistema.findUnique.mockResolvedValue(SISTEMA)
    prisma.modulo.findMany.mockResolvedValue([MODULO])
    const r = await service.listar('s1')
    expect(prisma.modulo.findMany).toHaveBeenCalledWith({
      where: { sistemaId: 's1' },
      orderBy: { nome: 'asc' },
    })
    expect(r).toEqual([MODULO])
  })

  it('listar lança RECURSO_NAO_ENCONTRADO quando sistema não existe', async () => {
    prisma.sistema.findUnique.mockResolvedValue(null)
    await expect(service.listar('s-x')).rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
    expect(prisma.modulo.findMany).not.toHaveBeenCalled()
  })

  it('buscarPorId delega ao prisma', async () => {
    prisma.modulo.findUnique.mockResolvedValue(MODULO)
    const r = await service.buscarPorId('m1')
    expect(prisma.modulo.findUnique).toHaveBeenCalledWith({ where: { id: 'm1' } })
    expect(r).toEqual(MODULO)
  })
})

describe('ModulosService.criar — branches restantes', () => {
  let prisma: PrismaMock
  let service: ModulosService

  beforeEach(() => {
    prisma = criarPrismaMock()
    service = new ModulosService(prisma as never)
    prisma.sistema.findUnique.mockResolvedValue(SISTEMA)
  })

  it('lança CONFLITO quando usuário admin está inativo', async () => {
    prisma.usuario.findUnique.mockResolvedValue({ id: 'u2', ativo: false })
    await expect(service.criar('s1', { nome: 'X', adminUsuarioId: 'u2' }))
      .rejects.toMatchObject({ code: 'CONFLITO' })
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('mapeia P2002 para CONFLITO com nome duplicado', async () => {
    prisma.usuario.findUnique.mockResolvedValue({ id: 'u1', ativo: true })
    prisma.modulo.create.mockRejectedValue(erro('P2002'))
    await expect(service.criar('s1', { nome: 'Dup', adminUsuarioId: 'u1' }))
      .rejects.toMatchObject({ code: 'CONFLITO' })
  })

  it('propaga erros Prisma não-P2002', async () => {
    prisma.usuario.findUnique.mockResolvedValue({ id: 'u1', ativo: true })
    prisma.modulo.create.mockRejectedValue(erro('P9999'))
    await expect(service.criar('s1', { nome: 'X', adminUsuarioId: 'u1' })).rejects.toThrow()
  })

  it('inclui descricao quando fornecida', async () => {
    prisma.usuario.findUnique.mockResolvedValue({ id: 'u1', ativo: true })
    prisma.modulo.create.mockResolvedValue(MODULO)
    prisma.adminModulo.create.mockResolvedValue({} as never)
    await service.criar('s1', { nome: 'Mod', descricao: 'desc', adminUsuarioId: 'u1' })
    expect(prisma.modulo.create).toHaveBeenCalledWith({
      data: { nome: 'Mod', descricao: 'desc', sistemaId: 's1' },
    })
  })
})

describe('ModulosService.reordenar', () => {
  let prisma: PrismaMock
  let service: ModulosService

  beforeEach(() => {
    prisma = criarPrismaMock()
    service = new ModulosService(prisma as never)
  })

  it('atualiza ordem de cada módulo pelo índice em uma transação', async () => {
    prisma.modulo.update.mockResolvedValue({} as never)
    await service.reordenar(['a', 'b', 'c'])
    expect(prisma.$transaction).toHaveBeenCalledOnce()
    expect(prisma.modulo.update).toHaveBeenCalledWith({ where: { id: 'a' }, data: { ordem: 0 } })
    expect(prisma.modulo.update).toHaveBeenCalledWith({ where: { id: 'b' }, data: { ordem: 1 } })
    expect(prisma.modulo.update).toHaveBeenCalledWith({ where: { id: 'c' }, data: { ordem: 2 } })
  })

  it('lista vazia ainda chama $transaction (com array vazio)', async () => {
    await service.reordenar([])
    expect(prisma.$transaction).toHaveBeenCalledWith([])
  })
})

describe('ModulosService.atualizar', () => {
  let prisma: PrismaMock
  let service: ModulosService

  beforeEach(() => {
    prisma = criarPrismaMock()
    service = new ModulosService(prisma as never)
  })

  it('atualiza módulo com sucesso', async () => {
    prisma.modulo.update.mockResolvedValue({ ...MODULO, nome: 'Novo' })
    const r = await service.atualizar('m1', { nome: 'Novo' })
    expect(prisma.modulo.update).toHaveBeenCalledWith({ where: { id: 'm1' }, data: { nome: 'Novo' } })
    expect(r.nome).toBe('Novo')
  })

  it('mapeia P2002 para CONFLITO', async () => {
    prisma.modulo.update.mockRejectedValue(erro('P2002'))
    await expect(service.atualizar('m1', { nome: 'X' })).rejects.toMatchObject({ code: 'CONFLITO' })
  })

  it('mapeia P2025 para RECURSO_NAO_ENCONTRADO', async () => {
    prisma.modulo.update.mockRejectedValue(erro('P2025'))
    await expect(service.atualizar('m1', { nome: 'X' })).rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
  })

  it('propaga erros Prisma desconhecidos', async () => {
    prisma.modulo.update.mockRejectedValue(erro('P9999'))
    await expect(service.atualizar('m1', { nome: 'X' })).rejects.toThrow()
  })

  it('propaga erros não-Prisma', async () => {
    prisma.modulo.update.mockRejectedValue(new Error('boom'))
    await expect(service.atualizar('m1', { nome: 'X' })).rejects.toThrow('boom')
  })
})

describe('ModulosService.excluir — cascata na transação', () => {
  let prisma: PrismaMock
  let service: ModulosService

  beforeEach(() => {
    prisma = criarPrismaMock()
    service = new ModulosService(prisma as never)
    prisma.modulo.findUnique.mockResolvedValue(MODULO)
    prisma.adminModulo.findUnique.mockResolvedValue({ ativo: true })
  })

  it('chama lixeiraService.salvarModulo quando informado', async () => {
    const salvarModulo = (await import('vitest')).vi.fn().mockResolvedValue(undefined)
    const lixeira = { salvarModulo } as unknown as import('../lixeira.js').LixeiraService

    prisma.menu.findMany.mockResolvedValue([])
    prisma.itemFuncionalidade.findMany.mockResolvedValue([])

    await service.excluir('m1', 'u1', lixeira)

    expect(salvarModulo).toHaveBeenCalledWith('m1', 'u1', expect.anything())
  })

  it('exclui em cascata com 3 níveis de profundidade', async () => {
    prisma.menu.findMany.mockResolvedValue([{ id: 'me1' }])
    prisma.itemFuncionalidade.findMany.mockResolvedValue([
      { id: 'raiz', parentId: null },
      { id: 'sub1', parentId: 'raiz' },
      { id: 'sub2', parentId: 'sub1' },
    ])

    await service.excluir('m1', 'u1')

    expect(prisma.permissaoAcesso.deleteMany).toHaveBeenCalledWith({
      where: { itemId: { in: ['raiz', 'sub1', 'sub2'] } },
    })
    // depth2: itens cujo pai também é pai-de-alguém → sub1
    expect(prisma.itemFuncionalidade.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['sub1'] } },
    })
    // depth1: itens com parentId não em depth2 → sub2
    expect(prisma.itemFuncionalidade.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['sub2'] } },
    })
    // depth0: sem parentId → raiz
    expect(prisma.itemFuncionalidade.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['raiz'] } },
    })
    expect(prisma.menu.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['me1'] } } })
    expect(prisma.adminModulo.deleteMany).toHaveBeenCalledWith({ where: { moduloId: 'm1' } })
    expect(prisma.modulo.delete).toHaveBeenCalledWith({ where: { id: 'm1' } })
  })

  it('pula deletemany para coleções vazias', async () => {
    prisma.menu.findMany.mockResolvedValue([])
    prisma.itemFuncionalidade.findMany.mockResolvedValue([])

    await service.excluir('m1', 'u1')

    expect(prisma.menu.deleteMany).not.toHaveBeenCalled()
    expect(prisma.itemFuncionalidade.deleteMany).not.toHaveBeenCalled()
    expect(prisma.modulo.delete).toHaveBeenCalledWith({ where: { id: 'm1' } })
  })
})
