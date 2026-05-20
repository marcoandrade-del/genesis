import { describe, it, expect, beforeEach, vi } from 'vitest'

const {
  sistBuscarComAdminsMock, sistCriarMock, sistAtualizarMock, sistTrocarAdminMock, sistExcluirMock,
  modCriarMock, modAtualizarMock, modExcluirMock, modReordenarMock,
  menuCriarMock, menuAtualizarMock, menuExcluirMock, menuReordenarMock,
  itemCriarMock, itemAtualizarMock, itemExcluirMock, itemReordenarMock,
  itemCopiarMock, itemAtalhoMock, itemMoverMock,
  lixContarFilhosSistemaMock, lixContarFilhosModuloMock, lixContarFilhosMenuMock, lixContarFilhosItemMock,
} = vi.hoisted(() => ({
  sistBuscarComAdminsMock: vi.fn(),
  sistCriarMock: vi.fn(),
  sistAtualizarMock: vi.fn(),
  sistTrocarAdminMock: vi.fn(),
  sistExcluirMock: vi.fn(),
  modCriarMock: vi.fn(),
  modAtualizarMock: vi.fn(),
  modExcluirMock: vi.fn(),
  modReordenarMock: vi.fn(),
  menuCriarMock: vi.fn(),
  menuAtualizarMock: vi.fn(),
  menuExcluirMock: vi.fn(),
  menuReordenarMock: vi.fn(),
  itemCriarMock: vi.fn(),
  itemAtualizarMock: vi.fn(),
  itemExcluirMock: vi.fn(),
  itemReordenarMock: vi.fn(),
  itemCopiarMock: vi.fn(),
  itemAtalhoMock: vi.fn(),
  itemMoverMock: vi.fn(),
  lixContarFilhosSistemaMock: vi.fn(),
  lixContarFilhosModuloMock: vi.fn(),
  lixContarFilhosMenuMock: vi.fn(),
  lixContarFilhosItemMock: vi.fn(),
}))

vi.mock('../../services/sistemas.js', () => ({
  SistemasService: class {
    buscarComAdmins = sistBuscarComAdminsMock
    criar = sistCriarMock
    atualizar = sistAtualizarMock
    trocarAdmin = sistTrocarAdminMock
    excluir = sistExcluirMock
  },
}))
vi.mock('../../services/modulos.js', () => ({
  ModulosService: class {
    criar = modCriarMock
    atualizar = modAtualizarMock
    excluir = modExcluirMock
    reordenar = modReordenarMock
  },
}))
vi.mock('../../services/menus.js', () => ({
  MenusService: class {
    criar = menuCriarMock
    atualizar = menuAtualizarMock
    excluir = menuExcluirMock
    reordenar = menuReordenarMock
  },
}))
vi.mock('../../services/itens.js', () => ({
  ItensService: class {
    criar = itemCriarMock
    atualizar = itemAtualizarMock
    excluir = itemExcluirMock
    reordenar = itemReordenarMock
    copiar = itemCopiarMock
    criarAtalho = itemAtalhoMock
    mover = itemMoverMock
  },
}))
vi.mock('../../services/lixeira.js', () => ({
  LixeiraService: class {
    contarFilhosSistema = lixContarFilhosSistemaMock
    contarFilhosModulo = lixContarFilhosModuloMock
    contarFilhosMenu = lixContarFilhosMenuMock
    contarFilhosItem = lixContarFilhosItemMock
  },
}))

import { criarApp } from '../../routes/__tests__/helpers/criarApp.js'
import { adminMenusRoutes } from '../menus.js'
import type { FastifyInstance } from 'fastify'
import type { PrismaMock } from '../../services/__tests__/helpers/prisma-mock.js'

const SISTEMA_COMPLETO = {
  id: 's1', nome: 'ERP', descricao: '', ativo: true,
  admins: [{ usuario: { id: 'u1', nomeCompleto: 'Admin' } }],
  _count: { modulos: 0 },
}
const MODULO_COMPLETO = {
  id: 'm1', sistemaId: 's1', nome: 'Mod', descricao: '', ativo: true,
  sistema: { nome: 'ERP' }, _count: { menus: 0 },
}
const MENU_COMPLETO = {
  id: 'me1', moduloId: 'm1', nome: 'Menu A', icone: 'i', ordem: 0, ativo: true,
  modulo: { nome: 'Mod' },
}
const ITEM_COMPLETO = {
  id: 'i1', menuId: 'me1', parentId: null, nome: 'Item', tipo: 'FUNCIONALIDADE',
  tipoFuncionalidade: 'CRUD', rota: '/x', icone: 'i', ordem: 0, ativo: true, descricao: '',
  parent: null,
  menu: { id: 'me1', nome: 'Menu A' },
  _count: { subItens: 0 },
}

function form(obj: Record<string, string>) {
  return {
    payload: new URLSearchParams(obj).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  }
}

describe('adminMenusRoutes', () => {
  let app: FastifyInstance
  let prisma: PrismaMock

  beforeEach(async () => {
    const all = [
      sistBuscarComAdminsMock, sistCriarMock, sistAtualizarMock, sistTrocarAdminMock, sistExcluirMock,
      modCriarMock, modAtualizarMock, modExcluirMock, modReordenarMock,
      menuCriarMock, menuAtualizarMock, menuExcluirMock, menuReordenarMock,
      itemCriarMock, itemAtualizarMock, itemExcluirMock, itemReordenarMock,
      itemCopiarMock, itemAtalhoMock, itemMoverMock,
      lixContarFilhosSistemaMock, lixContarFilhosModuloMock, lixContarFilhosMenuMock, lixContarFilhosItemMock,
    ]
    all.forEach(m => m.mockReset())
    ;({ app, prisma } = await criarApp({
      registrar: adminMenusRoutes,
      comView: true,
      simularAdmin: { sub: 'admin1', email: 'admin@x.com' },
    }))
  })

  describe('GET / e GET /arvore', () => {
    it('renderiza árvore', async () => {
      prisma.sistema.findMany.mockResolvedValue([])
      const res = await app.inject({ method: 'GET', url: '/' })
      expect(res.statusCode).toBe(200)
    })

    it('renderiza partial árvore', async () => {
      prisma.sistema.findMany.mockResolvedValue([])
      const res = await app.inject({ method: 'GET', url: '/arvore' })
      expect(res.statusCode).toBe(200)
    })
  })

  describe('GET /painel/sistema/:id', () => {
    it('404 quando sistema não existe', async () => {
      prisma.sistema.findUnique.mockResolvedValue(null)
      const res = await app.inject({ method: 'GET', url: '/painel/sistema/s1' })
      expect(res.statusCode).toBe(404)
    })

    it('renderiza painel', async () => {
      prisma.sistema.findUnique.mockResolvedValue(SISTEMA_COMPLETO)
      const res = await app.inject({ method: 'GET', url: '/painel/sistema/s1' })
      expect(res.statusCode).toBe(200)
    })
  })

  describe('GET /painel/modulo/:id', () => {
    it('404 quando módulo não existe', async () => {
      prisma.modulo.findUnique.mockResolvedValue(null)
      const res = await app.inject({ method: 'GET', url: '/painel/modulo/m1' })
      expect(res.statusCode).toBe(404)
    })

    it('renderiza painel', async () => {
      prisma.modulo.findUnique.mockResolvedValue(MODULO_COMPLETO)
      const res = await app.inject({ method: 'GET', url: '/painel/modulo/m1' })
      expect(res.statusCode).toBe(200)
    })
  })

  describe('GET /painel/menu/:id', () => {
    it('404 quando menu não existe', async () => {
      prisma.menu.findUnique.mockResolvedValue(null)
      const res = await app.inject({ method: 'GET', url: '/painel/menu/me1' })
      expect(res.statusCode).toBe(404)
    })

    it('renderiza painel', async () => {
      prisma.menu.findUnique.mockResolvedValue(MENU_COMPLETO)
      const res = await app.inject({ method: 'GET', url: '/painel/menu/me1' })
      expect(res.statusCode).toBe(200)
    })
  })

  describe('GET /painel/item/:id', () => {
    it('404 quando item não existe', async () => {
      prisma.itemFuncionalidade.findUnique.mockResolvedValue(null)
      const res = await app.inject({ method: 'GET', url: '/painel/item/i1' })
      expect(res.statusCode).toBe(404)
    })

    it('renderiza painel', async () => {
      prisma.itemFuncionalidade.findUnique.mockResolvedValue(ITEM_COMPLETO)
      const res = await app.inject({ method: 'GET', url: '/painel/item/i1' })
      expect(res.statusCode).toBe(200)
    })
  })

  describe('GET /novo/sistema', () => {
    it('renderiza form vazio com adminPadrao', async () => {
      prisma.usuario.findUnique.mockResolvedValue({ id: 'admin1', nomeCompleto: 'Admin' })
      const res = await app.inject({ method: 'GET', url: '/novo/sistema' })
      expect(res.statusCode).toBe(200)
    })
  })

  describe('GET /painel/sistema/:id/editar', () => {
    it('404 quando sistema não existe', async () => {
      sistBuscarComAdminsMock.mockResolvedValue(null)
      const res = await app.inject({ method: 'GET', url: '/painel/sistema/s1/editar' })
      expect(res.statusCode).toBe(404)
    })

    it('renderiza form de edição', async () => {
      sistBuscarComAdminsMock.mockResolvedValue(SISTEMA_COMPLETO)
      const res = await app.inject({ method: 'GET', url: '/painel/sistema/s1/editar' })
      expect(res.statusCode).toBe(200)
    })
  })

  describe('GET /novo/modulo, /novo/menu, /novo/item', () => {
    it('renderiza form de novo módulo', async () => {
      prisma.sistema.findUnique.mockResolvedValue({ id: 's1', nome: 'ERP' })
      prisma.usuario.findUnique.mockResolvedValue({ id: 'admin1', nomeCompleto: 'Admin' })
      const res = await app.inject({ method: 'GET', url: '/novo/modulo?sistemaId=s1' })
      expect(res.statusCode).toBe(200)
    })

    it('renderiza form de novo menu', async () => {
      prisma.modulo.findUnique.mockResolvedValue({ id: 'm1', nome: 'Mod' })
      const res = await app.inject({ method: 'GET', url: '/novo/menu?moduloId=m1' })
      expect(res.statusCode).toBe(200)
    })

    it('renderiza form de novo item sem parent', async () => {
      prisma.menu.findUnique.mockResolvedValue({ id: 'me1', nome: 'Menu A' })
      const res = await app.inject({ method: 'GET', url: '/novo/item?menuId=me1' })
      expect(res.statusCode).toBe(200)
    })

    it('renderiza form de novo item com parent (profundidade 1)', async () => {
      prisma.menu.findUnique.mockResolvedValue({ id: 'me1', nome: 'Menu A' })
      prisma.itemFuncionalidade.findUnique.mockResolvedValue({ id: 'p1', nome: 'Pai', parentId: null })
      const res = await app.inject({ method: 'GET', url: '/novo/item?menuId=me1&parentId=p1' })
      expect(res.statusCode).toBe(200)
    })
  })

  describe('POST /novo/sistema', () => {
    it('valida nome obrigatório', async () => {
      prisma.usuario.findUnique.mockResolvedValue({ id: 'admin1', nomeCompleto: 'Admin' })
      const res = await app.inject({
        method: 'POST', url: '/novo/sistema',
        ...form({ nome: '  ', descricao: '', adminUsuarioId: 'u1' }),
      })
      expect(res.body).toMatch(/nome é obrigatório/i)
      expect(sistCriarMock).not.toHaveBeenCalled()
    })

    it('valida admin obrigatório', async () => {
      prisma.usuario.findUnique.mockResolvedValue({ id: 'admin1', nomeCompleto: 'Admin' })
      const res = await app.inject({
        method: 'POST', url: '/novo/sistema',
        ...form({ nome: 'ERP', descricao: '', adminUsuarioId: '' }),
      })
      expect(res.body).toMatch(/Selecione um administrador/)
    })

    it('cria sistema com HX-Trigger refresh-tree', async () => {
      sistCriarMock.mockResolvedValue({ id: 's1' })
      prisma.sistema.findUnique.mockResolvedValue(SISTEMA_COMPLETO)
      const res = await app.inject({
        method: 'POST', url: '/novo/sistema',
        ...form({ nome: 'ERP', descricao: 'd', adminUsuarioId: 'u1' }),
      })
      expect(res.statusCode).toBe(200)
      expect(res.headers['hx-trigger']).toContain('refresh-tree')
      expect(sistCriarMock).toHaveBeenCalledWith({ nome: 'ERP', adminUsuarioId: 'u1', descricao: 'd' })
    })

    it('renderiza erro quando service falha', async () => {
      prisma.usuario.findUnique.mockResolvedValue({ id: 'admin1', nomeCompleto: 'Admin' })
      sistCriarMock.mockRejectedValue(new Error('Dup.'))
      const res = await app.inject({
        method: 'POST', url: '/novo/sistema',
        ...form({ nome: 'X', descricao: '', adminUsuarioId: 'u1' }),
      })
      expect(res.body).toContain('Dup.')
    })
  })

  describe('PUT /sistema/:id', () => {
    it('valida nome obrigatório', async () => {
      sistBuscarComAdminsMock.mockResolvedValue(SISTEMA_COMPLETO)
      const res = await app.inject({
        method: 'PUT', url: '/sistema/s1',
        ...form({ nome: '', descricao: '', ativo: 'true' }),
      })
      expect(res.body).toMatch(/nome é obrigatório/i)
    })

    it('atualiza sem trocar admin', async () => {
      sistAtualizarMock.mockResolvedValue(undefined)
      prisma.sistema.findUnique.mockResolvedValue(SISTEMA_COMPLETO)
      const res = await app.inject({
        method: 'PUT', url: '/sistema/s1',
        ...form({ nome: 'Novo', descricao: 'd', ativo: 'true' }),
      })
      expect(res.statusCode).toBe(200)
      expect(sistAtualizarMock).toHaveBeenCalledWith('s1', { nome: 'Novo', descricao: 'd', ativo: true })
      expect(sistTrocarAdminMock).not.toHaveBeenCalled()
    })

    it('atualiza e troca admin', async () => {
      sistAtualizarMock.mockResolvedValue(undefined)
      sistTrocarAdminMock.mockResolvedValue(undefined)
      prisma.sistema.findUnique.mockResolvedValue(SISTEMA_COMPLETO)
      await app.inject({
        method: 'PUT', url: '/sistema/s1',
        ...form({ nome: 'N', descricao: '', ativo: 'true', adminUsuarioId: 'u2' }),
      })
      expect(sistTrocarAdminMock).toHaveBeenCalledWith('s1', 'u2')
    })

    it('renderiza erro quando falha', async () => {
      sistAtualizarMock.mockRejectedValue(new Error('Falhou.'))
      sistBuscarComAdminsMock.mockResolvedValue(SISTEMA_COMPLETO)
      const res = await app.inject({
        method: 'PUT', url: '/sistema/s1',
        ...form({ nome: 'N', descricao: '', ativo: 'true' }),
      })
      expect(res.body).toContain('Falhou.')
    })
  })

  describe('POST /novo/modulo', () => {
    it('valida nome obrigatório', async () => {
      prisma.sistema.findUnique.mockResolvedValue({ id: 's1', nome: 'ERP' })
      prisma.usuario.findUnique.mockResolvedValue({ id: 'admin1', nomeCompleto: 'Admin' })
      const res = await app.inject({
        method: 'POST', url: '/novo/modulo',
        ...form({ sistemaId: 's1', nome: '', descricao: '', adminUsuarioId: 'u1' }),
      })
      expect(res.body).toMatch(/nome é obrigatório/i)
    })

    it('valida admin obrigatório', async () => {
      prisma.sistema.findUnique.mockResolvedValue({ id: 's1', nome: 'ERP' })
      prisma.usuario.findUnique.mockResolvedValue({ id: 'admin1', nomeCompleto: 'Admin' })
      const res = await app.inject({
        method: 'POST', url: '/novo/modulo',
        ...form({ sistemaId: 's1', nome: 'Mod', descricao: '', adminUsuarioId: '' }),
      })
      expect(res.body).toMatch(/Selecione um administrador/)
    })

    it('cria módulo com refresh-tree', async () => {
      prisma.sistema.findUnique.mockResolvedValue({ id: 's1', nome: 'ERP' })
      prisma.usuario.findUnique.mockResolvedValue({ id: 'admin1', nomeCompleto: 'Admin' })
      modCriarMock.mockResolvedValue({ id: 'm1' })
      prisma.modulo.findUnique.mockResolvedValue(MODULO_COMPLETO)
      const res = await app.inject({
        method: 'POST', url: '/novo/modulo',
        ...form({ sistemaId: 's1', nome: 'Mod', descricao: 'd', adminUsuarioId: 'u1' }),
      })
      expect(res.headers['hx-trigger']).toContain('refresh-tree')
      expect(modCriarMock).toHaveBeenCalledWith('s1', { nome: 'Mod', adminUsuarioId: 'u1', descricao: 'd' })
    })

    it('renderiza erro quando service falha', async () => {
      prisma.sistema.findUnique.mockResolvedValue({ id: 's1', nome: 'ERP' })
      prisma.usuario.findUnique.mockResolvedValue({ id: 'admin1', nomeCompleto: 'Admin' })
      modCriarMock.mockRejectedValue(new Error('Erro.'))
      const res = await app.inject({
        method: 'POST', url: '/novo/modulo',
        ...form({ sistemaId: 's1', nome: 'Mod', descricao: '', adminUsuarioId: 'u1' }),
      })
      expect(res.body).toContain('Erro.')
    })
  })

  describe('POST /novo/menu', () => {
    it('valida moduloId obrigatório', async () => {
      const res = await app.inject({
        method: 'POST', url: '/novo/menu',
        ...form({ moduloId: '', nome: 'X' }),
      })
      expect(res.body).toMatch(/Módulo não encontrado/)
    })

    it('valida nome obrigatório', async () => {
      prisma.modulo.findUnique.mockResolvedValue({ id: 'm1', nome: 'Mod' })
      const res = await app.inject({
        method: 'POST', url: '/novo/menu',
        ...form({ moduloId: 'm1', nome: '  ' }),
      })
      expect(res.body).toMatch(/nome é obrigatório/i)
    })

    it('cria menu', async () => {
      prisma.modulo.findUnique.mockResolvedValue({ id: 'm1', nome: 'Mod' })
      menuCriarMock.mockResolvedValue({ id: 'me1' })
      prisma.menu.findUnique.mockResolvedValue(MENU_COMPLETO)
      const res = await app.inject({
        method: 'POST', url: '/novo/menu',
        ...form({ moduloId: 'm1', nome: 'Menu A', icone: 'i', ordem: '3' }),
      })
      expect(res.headers['hx-trigger']).toContain('refresh-tree')
      expect(menuCriarMock).toHaveBeenCalledWith('m1', { nome: 'Menu A', icone: 'i', ordem: 3 })
    })

    it('renderiza erro quando service falha', async () => {
      prisma.modulo.findUnique.mockResolvedValue({ id: 'm1', nome: 'Mod' })
      menuCriarMock.mockRejectedValue(new Error('Falha.'))
      const res = await app.inject({
        method: 'POST', url: '/novo/menu',
        ...form({ moduloId: 'm1', nome: 'X' }),
      })
      expect(res.body).toContain('Falha.')
    })
  })

  describe('POST /novo/item', () => {
    it('rejeita SUBMENU quando profundidade >= 1', async () => {
      prisma.menu.findUnique.mockResolvedValue({ id: 'me1', nome: 'Menu A' })
      prisma.itemFuncionalidade.findUnique.mockResolvedValue({ id: 'p1', nome: 'Pai', parentId: null })
      const res = await app.inject({
        method: 'POST', url: '/novo/item',
        ...form({ menuId: 'me1', parentId: 'p1', nome: 'X', tipo: 'SUBMENU' }),
      })
      expect(res.body).toMatch(/Submenu não pode ter outro submenu/)
      expect(itemCriarMock).not.toHaveBeenCalled()
    })

    it('cria item funcionalidade no topo do menu', async () => {
      prisma.menu.findUnique.mockResolvedValue({ id: 'me1', nome: 'Menu A' })
      itemCriarMock.mockResolvedValue({ id: 'i1' })
      prisma.itemFuncionalidade.findUnique.mockResolvedValue(ITEM_COMPLETO)
      const res = await app.inject({
        method: 'POST', url: '/novo/item',
        ...form({ menuId: 'me1', nome: 'It', tipo: 'FUNCIONALIDADE', tipoFuncionalidade: 'CRUD', rota: '/x' }),
      })
      expect(res.headers['hx-trigger']).toContain('refresh-tree')
      expect(itemCriarMock).toHaveBeenCalledWith('me1', {
        nome: 'It', tipo: 'FUNCIONALIDADE', tipoFuncionalidade: 'CRUD', rota: '/x',
      })
    })

    it('renderiza erro quando service falha', async () => {
      prisma.menu.findUnique.mockResolvedValue({ id: 'me1', nome: 'Menu A' })
      itemCriarMock.mockRejectedValue(new Error('Falha.'))
      const res = await app.inject({
        method: 'POST', url: '/novo/item',
        ...form({ menuId: 'me1', nome: 'X', tipo: 'FUNCIONALIDADE' }),
      })
      expect(res.body).toContain('Falha.')
    })
  })

  describe('PUT /modulo/:id, /menu/:id, /item/:id', () => {
    it('PUT /modulo valida nome e atualiza', async () => {
      prisma.modulo.findUnique.mockResolvedValue(MODULO_COMPLETO)
      modAtualizarMock.mockResolvedValue(undefined)
      const res = await app.inject({
        method: 'PUT', url: '/modulo/m1',
        ...form({ nome: 'Novo', descricao: 'd', ativo: 'true' }),
      })
      expect(res.statusCode).toBe(200)
      expect(res.headers['hx-trigger']).toContain('refresh-tree')
      expect(modAtualizarMock).toHaveBeenCalledWith('m1', { nome: 'Novo', descricao: 'd', ativo: true })
    })

    it('PUT /modulo valida nome vazio', async () => {
      prisma.modulo.findUnique.mockResolvedValue(MODULO_COMPLETO)
      const res = await app.inject({
        method: 'PUT', url: '/modulo/m1',
        ...form({ nome: '', descricao: '', ativo: 'true' }),
      })
      expect(res.body).toMatch(/nome é obrigatório/i)
    })

    it('PUT /menu atualiza', async () => {
      prisma.menu.findUnique.mockResolvedValue(MENU_COMPLETO)
      menuAtualizarMock.mockResolvedValue(undefined)
      const res = await app.inject({
        method: 'PUT', url: '/menu/me1',
        ...form({ nome: 'M', icone: 'i', ordem: '1', ativo: 'true' }),
      })
      expect(res.headers['hx-trigger']).toContain('refresh-tree')
      expect(menuAtualizarMock).toHaveBeenCalledWith('me1', { nome: 'M', icone: 'i', ordem: 1, ativo: true })
    })

    it('PUT /menu valida nome', async () => {
      prisma.menu.findUnique.mockResolvedValue(MENU_COMPLETO)
      const res = await app.inject({
        method: 'PUT', url: '/menu/me1',
        ...form({ nome: '', ativo: 'true' }),
      })
      expect(res.body).toMatch(/nome é obrigatório/i)
    })

    it('PUT /item atualiza', async () => {
      prisma.itemFuncionalidade.findUnique.mockResolvedValue(ITEM_COMPLETO)
      itemAtualizarMock.mockResolvedValue(undefined)
      const res = await app.inject({
        method: 'PUT', url: '/item/i1',
        ...form({ nome: 'It', descricao: 'd', tipoFuncionalidade: 'TELA', rota: '/x', icone: 'i', ordem: '2', ativo: 'true' }),
      })
      expect(res.headers['hx-trigger']).toContain('refresh-tree')
      expect(itemAtualizarMock).toHaveBeenCalledWith('i1', {
        nome: 'It', descricao: 'd', tipoFuncionalidade: 'TELA', rota: '/x', icone: 'i', ordem: 2, ativo: true,
      })
    })

    it('PUT /item valida nome', async () => {
      prisma.itemFuncionalidade.findUnique.mockResolvedValue(ITEM_COMPLETO)
      const res = await app.inject({
        method: 'PUT', url: '/item/i1',
        ...form({ nome: '', ativo: 'true' }),
      })
      expect(res.body).toMatch(/nome é obrigatório/i)
    })

    it('PUT /item renderiza erro quando falha', async () => {
      prisma.itemFuncionalidade.findUnique.mockResolvedValue(ITEM_COMPLETO)
      itemAtualizarMock.mockRejectedValue(new Error('XYZ.'))
      const res = await app.inject({
        method: 'PUT', url: '/item/i1',
        ...form({ nome: 'X', ativo: 'true' }),
      })
      expect(res.body).toContain('XYZ.')
    })
  })

  describe('DELETE', () => {
    it('exclui sistema com refresh-tree', async () => {
      sistExcluirMock.mockResolvedValue(undefined)
      const res = await app.inject({ method: 'DELETE', url: '/sistema/s1' })
      expect(res.statusCode).toBe(200)
      expect(res.headers['hx-trigger']).toContain('refresh-tree')
      expect(sistExcluirMock).toHaveBeenCalledWith('s1', 'admin1', expect.anything())
    })

    it('retorna 400 quando exclusão de sistema falha', async () => {
      sistExcluirMock.mockRejectedValue(new Error('Em uso.'))
      const res = await app.inject({ method: 'DELETE', url: '/sistema/s1' })
      expect(res.statusCode).toBe(400)
      expect(res.body).toBe('Em uso.')
    })

    it('exclui módulo', async () => {
      modExcluirMock.mockResolvedValue(undefined)
      const res = await app.inject({ method: 'DELETE', url: '/modulo/m1' })
      expect(res.statusCode).toBe(200)
      expect(modExcluirMock).toHaveBeenCalledWith('m1', 'admin1', expect.anything())
    })

    it('exclui menu', async () => {
      menuExcluirMock.mockResolvedValue(undefined)
      const res = await app.inject({ method: 'DELETE', url: '/menu/me1' })
      expect(res.statusCode).toBe(200)
    })

    it('exclui item', async () => {
      itemExcluirMock.mockResolvedValue(undefined)
      const res = await app.inject({ method: 'DELETE', url: '/item/i1' })
      expect(res.statusCode).toBe(200)
    })

    it('retorna 400 quando exclusão de item falha', async () => {
      itemExcluirMock.mockRejectedValue(new Error('Em uso.'))
      const res = await app.inject({ method: 'DELETE', url: '/item/i1' })
      expect(res.statusCode).toBe(400)
    })
  })

  describe('GET /contar-filhos/:tipo/:id', () => {
    it('sistema com relatórios bloqueia exclusão', async () => {
      lixContarFilhosSistemaMock.mockResolvedValue({ relatorios: 2, modulos: 0, menus: 0 })
      const res = await app.inject({ method: 'GET', url: '/contar-filhos/sistema/s1' })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.bloqueado).toBe(true)
      expect(body.mensagemBloqueio).toContain('relatório')
    })

    it('sistema sem relatórios soma módulos + menus', async () => {
      lixContarFilhosSistemaMock.mockResolvedValue({ relatorios: 0, modulos: 3, menus: 5 })
      const res = await app.inject({ method: 'GET', url: '/contar-filhos/sistema/s1' })
      expect(res.json().count).toBe(8)
    })

    it('conta filhos de módulo', async () => {
      lixContarFilhosModuloMock.mockResolvedValue(7)
      const res = await app.inject({ method: 'GET', url: '/contar-filhos/modulo/m1' })
      expect(res.json().count).toBe(7)
    })

    it('conta filhos de menu', async () => {
      lixContarFilhosMenuMock.mockResolvedValue(4)
      const res = await app.inject({ method: 'GET', url: '/contar-filhos/menu/me1' })
      expect(res.json().count).toBe(4)
    })

    it('conta filhos de item', async () => {
      lixContarFilhosItemMock.mockResolvedValue(1)
      const res = await app.inject({ method: 'GET', url: '/contar-filhos/item/i1' })
      expect(res.json().count).toBe(1)
    })

    it('retorna 500 quando falha', async () => {
      lixContarFilhosSistemaMock.mockRejectedValue(new Error('boom'))
      const res = await app.inject({ method: 'GET', url: '/contar-filhos/sistema/s1' })
      expect(res.statusCode).toBe(500)
    })
  })

  describe('POST /reordenar/*', () => {
    it('reordena módulos', async () => {
      modReordenarMock.mockResolvedValue(undefined)
      const res = await app.inject({
        method: 'POST', url: '/reordenar/modulos',
        ...form({ ids: JSON.stringify(['a', 'b']) }),
      })
      expect(res.statusCode).toBe(200)
      expect(modReordenarMock).toHaveBeenCalledWith(['a', 'b'])
    })

    it('reordena menus retorna 400 em erro', async () => {
      menuReordenarMock.mockRejectedValue(new Error('x'))
      const res = await app.inject({
        method: 'POST', url: '/reordenar/menus',
        ...form({ ids: JSON.stringify(['a']) }),
      })
      expect(res.statusCode).toBe(400)
    })

    it('reordena itens', async () => {
      itemReordenarMock.mockResolvedValue(undefined)
      const res = await app.inject({
        method: 'POST', url: '/reordenar/itens',
        ...form({ ids: JSON.stringify(['a', 'b']) }),
      })
      expect(res.statusCode).toBe(200)
    })
  })

  describe('POST /copiar/item e /atalho/item', () => {
    it('copia item', async () => {
      itemCopiarMock.mockResolvedValue(undefined)
      const res = await app.inject({
        method: 'POST', url: '/copiar/item',
        ...form({ itemId: 'i1', novoParentId: 'p1', novoMenuId: 'me2' }),
      })
      expect(res.statusCode).toBe(200)
      expect(itemCopiarMock).toHaveBeenCalledWith('i1', 'p1', 'me2')
    })

    it('copia item com parent vazio = null', async () => {
      itemCopiarMock.mockResolvedValue(undefined)
      await app.inject({
        method: 'POST', url: '/copiar/item',
        ...form({ itemId: 'i1', novoMenuId: 'me2' }),
      })
      expect(itemCopiarMock).toHaveBeenCalledWith('i1', null, 'me2')
    })

    it('cria atalho', async () => {
      itemAtalhoMock.mockResolvedValue(undefined)
      const res = await app.inject({
        method: 'POST', url: '/atalho/item',
        ...form({ itemId: 'i1', novoMenuId: 'me2' }),
      })
      expect(res.statusCode).toBe(200)
      expect(itemAtalhoMock).toHaveBeenCalledWith('i1', null, 'me2')
    })

    it('retorna 400 quando copiar falha', async () => {
      itemCopiarMock.mockRejectedValue(new Error('boom'))
      const res = await app.inject({
        method: 'POST', url: '/copiar/item',
        ...form({ itemId: 'i1', novoMenuId: 'me2' }),
      })
      expect(res.statusCode).toBe(400)
    })
  })

  describe('GET /destinos-item/:id', () => {
    it('404 quando item não existe', async () => {
      prisma.itemFuncionalidade.findUnique.mockResolvedValue(null)
      const res = await app.inject({ method: 'GET', url: '/destinos-item/i1' })
      expect(res.statusCode).toBe(404)
    })

    it('404 quando módulo não existe', async () => {
      prisma.itemFuncionalidade.findUnique.mockResolvedValue({
        tipo: 'FUNCIONALIDADE', menuId: 'me1', parentId: null, menu: { moduloId: 'm1' },
      })
      prisma.modulo.findUnique.mockResolvedValue(null)
      const res = await app.inject({ method: 'GET', url: '/destinos-item/i1' })
      expect(res.statusCode).toBe(404)
    })

    it('retorna destinos do mesmo módulo', async () => {
      prisma.itemFuncionalidade.findUnique.mockResolvedValue({
        tipo: 'FUNCIONALIDADE', menuId: 'me1', parentId: null, menu: { moduloId: 'm1' },
      })
      prisma.modulo.findUnique.mockResolvedValue({
        nome: 'Mod', sistema: { nome: 'ERP' },
        menus: [
          { id: 'me1', nome: 'Menu A', itens: [] },
          { id: 'me2', nome: 'Menu B', itens: [{ id: 'sub1', nome: 'Sub', subItens: [] }] },
        ],
      })
      const res = await app.inject({ method: 'GET', url: '/destinos-item/i1' })
      expect(res.statusCode).toBe(200)
      const destinos = res.json()
      expect(Array.isArray(destinos)).toBe(true)
      expect(destinos.length).toBeGreaterThan(0)
      const labels = destinos.map((d: { label: string }) => d.label)
      expect(labels.some((l: string) => l.includes('ERP › Mod'))).toBe(true)
    })
  })

  describe('POST /mover/item', () => {
    it('move item', async () => {
      itemMoverMock.mockResolvedValue(undefined)
      const res = await app.inject({
        method: 'POST', url: '/mover/item',
        ...form({ itemId: 'i1', novoParentId: 'p1', menuId: 'me1', mover: 'true' }),
      })
      expect(res.statusCode).toBe(200)
      expect(itemMoverMock).toHaveBeenCalledWith('i1', 'p1', 'me1')
    })

    it('apenas reordena via idsOrdem', async () => {
      prisma.itemFuncionalidade.update.mockResolvedValue(undefined as never)
      const res = await app.inject({
        method: 'POST', url: '/mover/item',
        ...form({ itemId: 'i1', idsOrdem: JSON.stringify(['a', 'b']) }),
      })
      expect(res.statusCode).toBe(200)
      expect(itemMoverMock).not.toHaveBeenCalled()
    })

    it('retorna 400 quando falha', async () => {
      itemMoverMock.mockRejectedValue(new Error('boom'))
      const res = await app.inject({
        method: 'POST', url: '/mover/item',
        ...form({ itemId: 'i1', mover: 'true' }),
      })
      expect(res.statusCode).toBe(400)
    })
  })
})
