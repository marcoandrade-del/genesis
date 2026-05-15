import { describe, it, expect, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'
import { MenusService } from '../menus.js'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'

const MODULO_ATIVO = { id: 'mo1', nome: 'Contábil', sistemaId: 's1', ativo: true }
const MODULO_INATIVO = { id: 'mo2', nome: 'Antigo', sistemaId: 's1', ativo: false }
const MENU = { id: 'me1', nome: 'Cadastros', moduloId: 'mo1', ativo: true, ordem: 0 }

const erroP2002 = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
  code: 'P2002',
  clientVersion: '7.0.0',
})
const erroP2025 = new Prisma.PrismaClientKnownRequestError('Record not found', {
  code: 'P2025',
  clientVersion: '7.0.0',
})

describe('MenusService.listar', () => {
  let prisma: PrismaMock
  let service: MenusService

  beforeEach(() => {
    prisma = criarPrismaMock()
    service = new MenusService(prisma as never)
  })

  it('lança RECURSO_NAO_ENCONTRADO quando módulo não existe', async () => {
    prisma.modulo.findUnique.mockResolvedValue(null)

    await expect(service.listar('mo-inexistente'))
      .rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
  })

  it('retorna menus do módulo ordenados por ordem e nome', async () => {
    prisma.modulo.findUnique.mockResolvedValue(MODULO_ATIVO)
    prisma.menu.findMany.mockResolvedValue([MENU])

    const resultado = await service.listar('mo1')

    expect(prisma.menu.findMany).toHaveBeenCalledWith({
      where: { moduloId: 'mo1' },
      orderBy: [{ ordem: 'asc' }, { nome: 'asc' }],
    })
    expect(resultado).toEqual([MENU])
  })
})

describe('MenusService.criar', () => {
  let prisma: PrismaMock
  let service: MenusService

  beforeEach(() => {
    prisma = criarPrismaMock()
    service = new MenusService(prisma as never)
  })

  it('lança RECURSO_NAO_ENCONTRADO quando módulo não existe', async () => {
    prisma.modulo.findUnique.mockResolvedValue(null)

    await expect(service.criar('mo-inexistente', { nome: 'X' }))
      .rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
    expect(prisma.menu.create).not.toHaveBeenCalled()
  })

  it('lança CONFLITO quando módulo está inativo', async () => {
    prisma.modulo.findUnique.mockResolvedValue(MODULO_INATIVO)

    await expect(service.criar('mo2', { nome: 'X' }))
      .rejects.toMatchObject({ code: 'CONFLITO' })
    expect(prisma.menu.create).not.toHaveBeenCalled()
  })

  it('cria menu com moduloId injetado', async () => {
    prisma.modulo.findUnique.mockResolvedValue(MODULO_ATIVO)
    prisma.menu.create.mockResolvedValue(MENU)

    const resultado = await service.criar('mo1', { nome: 'Cadastros', icone: 'list' })

    expect(prisma.menu.create).toHaveBeenCalledWith({
      data: { nome: 'Cadastros', icone: 'list', moduloId: 'mo1' },
    })
    expect(resultado).toEqual(MENU)
  })

  it('lança CONFLITO quando nome do menu já existe (P2002)', async () => {
    prisma.modulo.findUnique.mockResolvedValue(MODULO_ATIVO)
    prisma.menu.create.mockRejectedValue(erroP2002)

    await expect(service.criar('mo1', { nome: 'Cadastros' }))
      .rejects.toMatchObject({ code: 'CONFLITO' })
  })
})

describe('MenusService.atualizar', () => {
  let prisma: PrismaMock
  let service: MenusService

  beforeEach(() => {
    prisma = criarPrismaMock()
    service = new MenusService(prisma as never)
  })

  it('atualiza menu existente', async () => {
    prisma.menu.update.mockResolvedValue({ ...MENU, nome: 'Novo' })

    const resultado = await service.atualizar('me1', { nome: 'Novo' })

    expect(prisma.menu.update).toHaveBeenCalledWith({ where: { id: 'me1' }, data: { nome: 'Novo' } })
    expect(resultado.nome).toBe('Novo')
  })

  it('lança CONFLITO quando nome duplica (P2002)', async () => {
    prisma.menu.update.mockRejectedValue(erroP2002)

    await expect(service.atualizar('me1', { nome: 'X' }))
      .rejects.toMatchObject({ code: 'CONFLITO' })
  })

  it('lança RECURSO_NAO_ENCONTRADO quando menu não existe (P2025)', async () => {
    prisma.menu.update.mockRejectedValue(erroP2025)

    await expect(service.atualizar('me-inexistente', { nome: 'X' }))
      .rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
  })
})

describe('MenusService.excluir', () => {
  let prisma: PrismaMock
  let service: MenusService

  beforeEach(() => {
    prisma = criarPrismaMock()
    service = new MenusService(prisma as never)
  })

  it('lança RECURSO_NAO_ENCONTRADO quando menu não existe', async () => {
    prisma.menu.findUnique.mockResolvedValue(null)

    await expect(service.excluir('me-inexistente', 'u1'))
      .rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('lança NAO_AUTORIZADO quando usuário não é admin do módulo pai', async () => {
    prisma.menu.findUnique.mockResolvedValue(MENU)
    prisma.adminModulo.findUnique.mockResolvedValue(null)
    prisma.modulo.findUnique.mockResolvedValue(MODULO_ATIVO)
    prisma.adminSistema.findUnique.mockResolvedValue(null)

    await expect(service.excluir('me1', 'u-outro'))
      .rejects.toMatchObject({ code: 'NAO_AUTORIZADO' })
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('inicia transação para excluir em cascata quando menu existe e usuário é admin', async () => {
    prisma.menu.findUnique.mockResolvedValue(MENU)
    prisma.adminModulo.findUnique.mockResolvedValue({ ativo: true })
    prisma.itemFuncionalidade.findMany.mockResolvedValue([])

    await service.excluir('me1', 'u1')

    expect(prisma.$transaction).toHaveBeenCalledOnce()
    expect(prisma.menu.delete).toHaveBeenCalledWith({ where: { id: 'me1' } })
  })
})

describe('MenusService.reordenar', () => {
  let prisma: PrismaMock
  let service: MenusService

  beforeEach(() => {
    prisma = criarPrismaMock()
    service = new MenusService(prisma as never)
  })

  it('atualiza ordem de cada menu na sequência fornecida', async () => {
    await service.reordenar(['m1', 'm2', 'm3'])

    expect(prisma.menu.update).toHaveBeenCalledTimes(3)
    expect(prisma.menu.update).toHaveBeenNthCalledWith(1, { where: { id: 'm1' }, data: { ordem: 0 } })
    expect(prisma.menu.update).toHaveBeenNthCalledWith(2, { where: { id: 'm2' }, data: { ordem: 1 } })
    expect(prisma.menu.update).toHaveBeenNthCalledWith(3, { where: { id: 'm3' }, data: { ordem: 2 } })
    expect(prisma.$transaction).toHaveBeenCalledOnce()
  })
})
