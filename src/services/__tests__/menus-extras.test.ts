import { describe, it, expect, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'
import { MenusService } from '../menus.js'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'

const erro = (code: string) => new Prisma.PrismaClientKnownRequestError('x', { code, clientVersion: '7.0.0' })
const MODULO = { id: 'mo1', nome: 'Mod', sistemaId: 's1', ativo: true }
const MENU = { id: 'me1', nome: 'Cad', moduloId: 'mo1', ativo: true, ordem: 0 }

describe('MenusService.buscarPorId', () => {
  it('delega ao prisma', async () => {
    const prisma = criarPrismaMock()
    const service = new MenusService(prisma as never)
    prisma.menu.findUnique.mockResolvedValue(MENU)
    const r = await service.buscarPorId('me1')
    expect(prisma.menu.findUnique).toHaveBeenCalledWith({ where: { id: 'me1' } })
    expect(r).toEqual(MENU)
  })
})

describe('MenusService.criar — erros Prisma desconhecidos', () => {
  let prisma: PrismaMock
  let service: MenusService

  beforeEach(() => {
    prisma = criarPrismaMock()
    service = new MenusService(prisma as never)
    prisma.modulo.findUnique.mockResolvedValue(MODULO)
  })

  it('propaga erros Prisma não-P2002', async () => {
    prisma.menu.create.mockRejectedValue(erro('P9999'))
    await expect(service.criar('mo1', { nome: 'X' })).rejects.toThrow()
  })

  it('propaga erros não-Prisma', async () => {
    prisma.menu.create.mockRejectedValue(new Error('boom'))
    await expect(service.criar('mo1', { nome: 'X' })).rejects.toThrow('boom')
  })
})

describe('MenusService.atualizar — branches restantes', () => {
  let prisma: PrismaMock
  let service: MenusService

  beforeEach(() => {
    prisma = criarPrismaMock()
    service = new MenusService(prisma as never)
  })

  it('propaga erros Prisma desconhecidos', async () => {
    prisma.menu.update.mockRejectedValue(erro('P9999'))
    await expect(service.atualizar('me1', { nome: 'X' })).rejects.toThrow()
  })

  it('propaga erros não-Prisma', async () => {
    prisma.menu.update.mockRejectedValue(new Error('boom'))
    await expect(service.atualizar('me1', { nome: 'X' })).rejects.toThrow('boom')
  })
})

describe('MenusService.excluir — cascata na transação', () => {
  let prisma: PrismaMock
  let service: MenusService

  beforeEach(() => {
    prisma = criarPrismaMock()
    service = new MenusService(prisma as never)
    prisma.menu.findUnique.mockResolvedValue(MENU)
    prisma.adminModulo.findUnique.mockResolvedValue({ ativo: true })
  })

  it('chama lixeiraService.salvarMenu quando informado', async () => {
    const salvarMenu = (await import('vitest')).vi.fn().mockResolvedValue(undefined)
    const lixeira = { salvarMenu } as unknown as import('../lixeira.js').LixeiraService
    prisma.itemFuncionalidade.findMany.mockResolvedValue([])

    await service.excluir('me1', 'u1', lixeira)

    expect(salvarMenu).toHaveBeenCalledWith('me1', 'u1', expect.anything())
  })

  it('exclui em cascata com 3 níveis de profundidade', async () => {
    prisma.itemFuncionalidade.findMany.mockResolvedValue([
      { id: 'raiz', parentId: null },
      { id: 'sub1', parentId: 'raiz' },
      { id: 'sub2', parentId: 'sub1' },
    ])

    await service.excluir('me1', 'u1')

    expect(prisma.permissaoAcesso.deleteMany).toHaveBeenCalledWith({
      where: { itemId: { in: ['raiz', 'sub1', 'sub2'] } },
    })
    expect(prisma.itemFuncionalidade.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['sub1'] } },
    })
    expect(prisma.itemFuncionalidade.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['sub2'] } },
    })
    expect(prisma.itemFuncionalidade.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['raiz'] } },
    })
    expect(prisma.menu.delete).toHaveBeenCalledWith({ where: { id: 'me1' } })
  })

  it('pula deletemany para coleções vazias quando só há itens depth0', async () => {
    prisma.itemFuncionalidade.findMany.mockResolvedValue([{ id: 'raiz', parentId: null }])

    await service.excluir('me1', 'u1')

    expect(prisma.itemFuncionalidade.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['raiz'] } } })
    expect(prisma.itemFuncionalidade.deleteMany).toHaveBeenCalledTimes(1)
    expect(prisma.menu.delete).toHaveBeenCalledWith({ where: { id: 'me1' } })
  })
})
