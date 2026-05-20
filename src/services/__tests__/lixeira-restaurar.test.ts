import { describe, it, expect, beforeEach } from 'vitest'
import { LixeiraService } from '../lixeira.js'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'

function entrada(tipo: string, estrutura: unknown) {
  return { id: 'lx1', tipo, nome: 'X', estrutura, excluidoPorId: 'u1', excluidoEm: new Date() }
}

describe('LixeiraService — restauração recursiva', () => {
  let prisma: PrismaMock
  let service: LixeiraService

  beforeEach(() => {
    prisma = criarPrismaMock()
    service = new LixeiraService(prisma as never)
  })

  describe('_restaurarSistema (via restaurar)', () => {
    it('upserta admins quando usuário existe e ignora quando não existe', async () => {
      const sistema = {
        id: 's1', nome: 'Sis', descricao: null, ativo: true,
        admins: [
          { usuarioId: 'u1', ativo: true },
          { usuarioId: 'u_inexistente', ativo: false },
        ],
        modulos: [],
      }
      prisma.lixeira.findUnique.mockResolvedValue(entrada('sistema', sistema))
      prisma.sistema.findUnique.mockResolvedValue(null)
      prisma.sistema.create.mockResolvedValue(sistema as never)
      prisma.usuario.findUnique
        .mockResolvedValueOnce({ id: 'u1' })
        .mockResolvedValueOnce(null)
      prisma.adminSistema.upsert.mockResolvedValue({} as never)

      await service.restaurar('lx1')

      expect(prisma.adminSistema.upsert).toHaveBeenCalledTimes(1)
      expect(prisma.adminSistema.upsert).toHaveBeenCalledWith({
        where: { usuarioId_sistemaId: { usuarioId: 'u1', sistemaId: 's1' } },
        create: { usuarioId: 'u1', sistemaId: 's1', ativo: true },
        update: {},
      })
    })

    it('restaura sistema com módulos aninhados', async () => {
      const sistema = {
        id: 's1', nome: 'Sis', descricao: null, ativo: true,
        admins: [],
        modulos: [
          { id: 'mo1', nome: 'Mod', descricao: null, ativo: true, ordem: 0, sistemaId: 's1', admins: [], menus: [] },
        ],
      }
      prisma.lixeira.findUnique.mockResolvedValue(entrada('sistema', sistema))
      prisma.sistema.findUnique
        .mockResolvedValueOnce(null)              // _restaurarSistema verifica que não existe
        .mockResolvedValueOnce({ id: 's1' })      // _restaurarModulo verifica que sistema pai existe
      prisma.modulo.findUnique.mockResolvedValue(null)
      prisma.sistema.create.mockResolvedValue(sistema as never)
      prisma.modulo.create.mockResolvedValue({} as never)

      await service.restaurar('lx1')

      expect(prisma.modulo.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ id: 'mo1', sistemaId: 's1' }),
      }))
    })
  })

  describe('_restaurarModulo (via restaurar)', () => {
    it('lança CONFLITO quando módulo já existe', async () => {
      const modulo = { id: 'mo1', nome: 'Mod', sistemaId: 's1', ativo: true, ordem: 0, admins: [], menus: [] }
      prisma.lixeira.findUnique.mockResolvedValue(entrada('modulo', modulo))
      prisma.sistema.findUnique.mockResolvedValue({ id: 's1' })
      prisma.modulo.findUnique.mockResolvedValue({ id: 'mo1' })

      await expect(service.restaurar('lx1')).rejects.toMatchObject({ code: 'CONFLITO' })
    })

    it('upserta admins de módulo e restaura menus aninhados', async () => {
      const modulo = {
        id: 'mo1', nome: 'Mod', descricao: null, ativo: true, ordem: 0, sistemaId: 's1',
        admins: [{ usuarioId: 'u1', ativo: true }],
        menus: [{ id: 'me1', nome: 'Menu', icone: null, ordem: 0, ativo: true, moduloId: 'mo1', itens: [] }],
      }
      prisma.lixeira.findUnique.mockResolvedValue(entrada('modulo', modulo))
      prisma.sistema.findUnique.mockResolvedValue({ id: 's1' })
      prisma.modulo.findUnique
        .mockResolvedValueOnce(null)              // _restaurarModulo: não existe ainda
        .mockResolvedValueOnce({ id: 'mo1' })     // _restaurarMenu: módulo pai existe
      prisma.menu.findUnique.mockResolvedValue(null)
      prisma.usuario.findUnique.mockResolvedValue({ id: 'u1' })
      prisma.modulo.create.mockResolvedValue({} as never)
      prisma.menu.create.mockResolvedValue({} as never)
      prisma.adminModulo.upsert.mockResolvedValue({} as never)

      await service.restaurar('lx1')

      expect(prisma.adminModulo.upsert).toHaveBeenCalledWith({
        where: { usuarioId_moduloId: { usuarioId: 'u1', moduloId: 'mo1' } },
        create: { usuarioId: 'u1', moduloId: 'mo1', ativo: true },
        update: {},
      })
      expect(prisma.menu.create).toHaveBeenCalled()
    })
  })

  describe('_restaurarMenu (via restaurar)', () => {
    const menu = { id: 'me1', nome: 'Menu', icone: null, ordem: 0, ativo: true, moduloId: 'mo1', itens: [] }

    it('lança CONFLITO quando módulo pai não existe', async () => {
      prisma.lixeira.findUnique.mockResolvedValue(entrada('menu', menu))
      prisma.modulo.findUnique.mockResolvedValue(null)

      await expect(service.restaurar('lx1')).rejects.toMatchObject({ code: 'CONFLITO' })
    })

    it('lança CONFLITO quando menu já existe', async () => {
      prisma.lixeira.findUnique.mockResolvedValue(entrada('menu', menu))
      prisma.modulo.findUnique.mockResolvedValue({ id: 'mo1' })
      prisma.menu.findUnique.mockResolvedValue({ id: 'me1' })

      await expect(service.restaurar('lx1')).rejects.toMatchObject({ code: 'CONFLITO' })
    })

    it('restaura menu com itens aninhados', async () => {
      const menuComItens = {
        ...menu,
        itens: [{
          id: 'it1', nome: 'It', descricao: null, tipo: 'FUNCIONALIDADE',
          tipoFuncionalidade: 'TELA', rota: '/x', icone: null, ordem: 0, ativo: true,
          menuId: 'me1', parentId: null, subItens: [],
        }],
      }
      prisma.lixeira.findUnique.mockResolvedValue(entrada('menu', menuComItens))
      prisma.modulo.findUnique.mockResolvedValue({ id: 'mo1' })
      prisma.menu.findUnique.mockResolvedValue(null)
      prisma.itemFuncionalidade.findUnique.mockResolvedValue(null)
      prisma.menu.create.mockResolvedValue({} as never)
      prisma.itemFuncionalidade.create.mockResolvedValue({} as never)

      await service.restaurar('lx1')

      expect(prisma.itemFuncionalidade.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ id: 'it1', tipo: 'FUNCIONALIDADE', tipoFuncionalidade: 'TELA' }),
      }))
    })
  })

  describe('_restaurarItem (via restaurar)', () => {
    const itemRaiz = {
      id: 'it1', nome: 'It', descricao: null, tipo: 'SUBMENU',
      tipoFuncionalidade: null, rota: null, icone: null, ordem: 0, ativo: true,
      menuId: 'me1', parentId: null, subItens: [],
    }

    it('lança CONFLITO quando menu pai não existe', async () => {
      prisma.lixeira.findUnique.mockResolvedValue(entrada('item', itemRaiz))
      prisma.menu.findUnique.mockResolvedValue(null)

      await expect(service.restaurar('lx1')).rejects.toMatchObject({ code: 'CONFLITO' })
    })

    it('lança CONFLITO quando item pai não existe (parentId definido)', async () => {
      const itemFilho = { ...itemRaiz, parentId: 'pai_x' }
      prisma.lixeira.findUnique.mockResolvedValue(entrada('item', itemFilho))
      prisma.menu.findUnique.mockResolvedValue({ id: 'me1' })
      prisma.itemFuncionalidade.findUnique.mockResolvedValue(null)

      await expect(service.restaurar('lx1')).rejects.toMatchObject({ code: 'CONFLITO' })
    })

    it('restaura item raiz com subItens', async () => {
      const itemComSubs = {
        ...itemRaiz,
        subItens: [{
          id: 'sub1', nome: 'Sub', descricao: null, tipo: 'FUNCIONALIDADE',
          tipoFuncionalidade: 'CRUD', rota: null, icone: null, ordem: 0, ativo: true,
          menuId: 'me1', parentId: 'it1', subItens: [],
        }],
      }
      prisma.lixeira.findUnique.mockResolvedValue(entrada('item', itemComSubs))
      prisma.menu.findUnique.mockResolvedValue({ id: 'me1' })
      prisma.itemFuncionalidade.findUnique.mockResolvedValue(null)
      prisma.itemFuncionalidade.create.mockResolvedValue({} as never)

      await service.restaurar('lx1')

      expect(prisma.itemFuncionalidade.create).toHaveBeenCalledTimes(2)
    })

    it('pula criação quando item já existe (idempotência)', async () => {
      prisma.lixeira.findUnique.mockResolvedValue(entrada('item', itemRaiz))
      prisma.menu.findUnique.mockResolvedValue({ id: 'me1' })
      prisma.itemFuncionalidade.findUnique.mockResolvedValue({ id: 'it1' })

      await service.restaurar('lx1')

      expect(prisma.itemFuncionalidade.create).not.toHaveBeenCalled()
    })

    it('rejeita snapshot com tipo inválido', async () => {
      const itemInvalido = { ...itemRaiz, tipo: 'BIZARRO' }
      prisma.lixeira.findUnique.mockResolvedValue(entrada('item', itemInvalido))
      prisma.menu.findUnique.mockResolvedValue({ id: 'me1' })
      prisma.itemFuncionalidade.findUnique.mockResolvedValue(null)

      await expect(service.restaurar('lx1')).rejects.toMatchObject({ code: 'CONFLITO' })
    })

    it('rejeita snapshot com tipoFuncionalidade inválido', async () => {
      const itemInvalido = { ...itemRaiz, tipo: 'FUNCIONALIDADE', tipoFuncionalidade: 'BIZARRO' }
      prisma.lixeira.findUnique.mockResolvedValue(entrada('item', itemInvalido))
      prisma.menu.findUnique.mockResolvedValue({ id: 'me1' })
      prisma.itemFuncionalidade.findUnique.mockResolvedValue(null)

      await expect(service.restaurar('lx1')).rejects.toMatchObject({ code: 'CONFLITO' })
    })
  })
})

describe('LixeiraService.salvarModulo', () => {
  let prisma: PrismaMock
  let service: LixeiraService

  beforeEach(() => {
    prisma = criarPrismaMock()
    service = new LixeiraService(prisma as never)
  })

  it('lança RECURSO_NAO_ENCONTRADO quando módulo não existe', async () => {
    prisma.modulo.findUnique.mockResolvedValue(null)
    await expect(service.salvarModulo('mo-x', 'u1'))
      .rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
  })

  it('snapshot do módulo é gravado na lixeira', async () => {
    const modulo = { id: 'mo1', nome: 'Mod', sistemaId: 's1', admins: [], menus: [] }
    prisma.modulo.findUnique.mockResolvedValue(modulo)

    await service.salvarModulo('mo1', 'u1')

    expect(prisma.lixeira.create).toHaveBeenCalledWith({
      data: { tipo: 'modulo', nome: 'Mod', estrutura: modulo, excluidoPorId: 'u1' },
    })
  })
})

describe('LixeiraService.salvarItem', () => {
  let prisma: PrismaMock
  let service: LixeiraService

  beforeEach(() => {
    prisma = criarPrismaMock()
    service = new LixeiraService(prisma as never)
  })

  it('lança RECURSO_NAO_ENCONTRADO quando item não existe', async () => {
    prisma.itemFuncionalidade.findUnique.mockResolvedValue(null)
    await expect(service.salvarItem('it-x', 'u1'))
      .rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
  })

  it('snapshot do item é gravado na lixeira', async () => {
    const item = { id: 'it1', nome: 'It', subItens: [] }
    prisma.itemFuncionalidade.findUnique.mockResolvedValue(item)

    await service.salvarItem('it1', 'u1')

    expect(prisma.lixeira.create).toHaveBeenCalledWith({
      data: { tipo: 'item', nome: 'It', estrutura: item, excluidoPorId: 'u1' },
    })
  })
})
