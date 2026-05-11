import { describe, it, expect, beforeEach } from 'vitest'
import { LixeiraService } from '../lixeira.js'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'

const SISTEMA = { id: 's1', nome: 'Sis', descricao: null, ativo: true, admins: [], modulos: [] }
const ENTRADA_LIXEIRA = {
  id: 'lx1',
  tipo: 'sistema',
  nome: 'Sis',
  estrutura: SISTEMA,
  excluidoPorId: 'u1',
  excluidoEm: new Date(),
}

describe('LixeiraService.listar', () => {
  let prisma: PrismaMock
  let service: LixeiraService

  beforeEach(() => {
    prisma = criarPrismaMock()
    service = new LixeiraService(prisma as never)
  })

  it('retorna itens ordenados por data de exclusão (desc)', async () => {
    prisma.lixeira.findMany.mockResolvedValue([ENTRADA_LIXEIRA])

    const resultado = await service.listar()

    expect(prisma.lixeira.findMany).toHaveBeenCalledWith({
      orderBy: { excluidoEm: 'desc' },
      include: { excluidoPor: { select: { nomeCompleto: true } } },
    })
    expect(resultado).toEqual([ENTRADA_LIXEIRA])
  })
})

describe('LixeiraService.excluirPermanente', () => {
  let prisma: PrismaMock
  let service: LixeiraService

  beforeEach(() => {
    prisma = criarPrismaMock()
    service = new LixeiraService(prisma as never)
  })

  it('lança RECURSO_NAO_ENCONTRADO quando entrada não existe', async () => {
    prisma.lixeira.findUnique.mockResolvedValue(null)

    await expect(service.excluirPermanente('lx-x'))
      .rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
    expect(prisma.lixeira.delete).not.toHaveBeenCalled()
  })

  it('exclui entrada definitivamente', async () => {
    prisma.lixeira.findUnique.mockResolvedValue(ENTRADA_LIXEIRA)
    prisma.lixeira.delete.mockResolvedValue(ENTRADA_LIXEIRA)

    await service.excluirPermanente('lx1')

    expect(prisma.lixeira.delete).toHaveBeenCalledWith({ where: { id: 'lx1' } })
  })
})

describe('LixeiraService.restaurar', () => {
  let prisma: PrismaMock
  let service: LixeiraService

  beforeEach(() => {
    prisma = criarPrismaMock()
    service = new LixeiraService(prisma as never)
  })

  it('lança RECURSO_NAO_ENCONTRADO quando entrada não existe', async () => {
    prisma.lixeira.findUnique.mockResolvedValue(null)

    await expect(service.restaurar('lx-x'))
      .rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('restaura sistema e remove entrada da lixeira', async () => {
    prisma.lixeira.findUnique.mockResolvedValue(ENTRADA_LIXEIRA)
    prisma.sistema.findUnique.mockResolvedValue(null)
    prisma.sistema.create.mockResolvedValue(SISTEMA)

    await service.restaurar('lx1')

    expect(prisma.sistema.create).toHaveBeenCalledWith({
      data: { id: 's1', nome: 'Sis', descricao: null, ativo: true },
    })
    expect(prisma.lixeira.delete).toHaveBeenCalledWith({ where: { id: 'lx1' } })
  })

  it('lança CONFLITO ao restaurar sistema que já existe', async () => {
    prisma.lixeira.findUnique.mockResolvedValue(ENTRADA_LIXEIRA)
    prisma.sistema.findUnique.mockResolvedValue(SISTEMA)

    await expect(service.restaurar('lx1'))
      .rejects.toMatchObject({ code: 'CONFLITO' })
    expect(prisma.lixeira.delete).not.toHaveBeenCalled()
  })

  it('lança CONFLITO ao restaurar módulo cujo sistema pai não existe', async () => {
    const moduloLx = {
      ...ENTRADA_LIXEIRA,
      tipo: 'modulo',
      estrutura: { id: 'mo1', nome: 'M', sistemaId: 's1', ativo: true, ordem: 0, admins: [], menus: [] },
    }
    prisma.lixeira.findUnique.mockResolvedValue(moduloLx)
    prisma.sistema.findUnique.mockResolvedValue(null)

    await expect(service.restaurar('lx1'))
      .rejects.toMatchObject({ code: 'CONFLITO' })
  })
})

describe('LixeiraService.salvarSistema', () => {
  let prisma: PrismaMock
  let service: LixeiraService

  beforeEach(() => {
    prisma = criarPrismaMock()
    service = new LixeiraService(prisma as never)
  })

  it('lança RECURSO_NAO_ENCONTRADO quando sistema não existe', async () => {
    prisma.sistema.findUnique.mockResolvedValue(null)

    await expect(service.salvarSistema('s-x', 'u1'))
      .rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
  })

  it('snapshot do sistema é gravado na lixeira', async () => {
    prisma.sistema.findUnique.mockResolvedValue(SISTEMA)

    await service.salvarSistema('s1', 'u1')

    expect(prisma.lixeira.create).toHaveBeenCalledWith({
      data: { tipo: 'sistema', nome: 'Sis', estrutura: SISTEMA, excluidoPorId: 'u1' },
    })
  })
})

describe('LixeiraService.salvarMenu', () => {
  let prisma: PrismaMock
  let service: LixeiraService

  beforeEach(() => {
    prisma = criarPrismaMock()
    service = new LixeiraService(prisma as never)
  })

  it('lança RECURSO_NAO_ENCONTRADO quando menu não existe', async () => {
    prisma.menu.findUnique.mockResolvedValue(null)

    await expect(service.salvarMenu('me-x', 'u1'))
      .rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
  })

  it('snapshot do menu é gravado na lixeira', async () => {
    const menu = { id: 'me1', nome: 'Menu', moduloId: 'mo1', itens: [] }
    prisma.menu.findUnique.mockResolvedValue(menu)

    await service.salvarMenu('me1', 'u1')

    expect(prisma.lixeira.create).toHaveBeenCalledWith({
      data: { tipo: 'menu', nome: 'Menu', estrutura: menu, excluidoPorId: 'u1' },
    })
  })
})

describe('LixeiraService.contar*', () => {
  let prisma: PrismaMock
  let service: LixeiraService

  beforeEach(() => {
    prisma = criarPrismaMock()
    service = new LixeiraService(prisma as never)
  })

  it('contarFilhosSistema soma módulos, menus e relatórios', async () => {
    prisma.modulo.findMany.mockResolvedValue([
      { id: 'mo1', _count: { menus: 2 } },
      { id: 'mo2', _count: { menus: 1 } },
    ])
    prisma.relatorioFixo.count.mockResolvedValue(5)

    const resultado = await service.contarFilhosSistema('s1')

    expect(resultado).toEqual({ modulos: 2, menus: 3, relatorios: 5 })
  })

  it('contarFilhosModulo retorna número de menus', async () => {
    prisma.menu.count.mockResolvedValue(4)

    const resultado = await service.contarFilhosModulo('mo1')

    expect(prisma.menu.count).toHaveBeenCalledWith({ where: { moduloId: 'mo1' } })
    expect(resultado).toBe(4)
  })

  it('contarFilhosMenu retorna número de itens', async () => {
    prisma.itemFuncionalidade.count.mockResolvedValue(7)

    const resultado = await service.contarFilhosMenu('me1')

    expect(prisma.itemFuncionalidade.count).toHaveBeenCalledWith({ where: { menuId: 'me1' } })
    expect(resultado).toBe(7)
  })

  it('contarFilhosItem retorna número de subitens (parentId=itemId)', async () => {
    prisma.itemFuncionalidade.count.mockResolvedValue(2)

    const resultado = await service.contarFilhosItem('it1')

    expect(prisma.itemFuncionalidade.count).toHaveBeenCalledWith({ where: { parentId: 'it1' } })
    expect(resultado).toBe(2)
  })
})
