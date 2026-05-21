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

function form(obj: Record<string, string>) {
  return {
    payload: new URLSearchParams(obj).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  }
}

describe('adminMenusRoutes — branches restantes', () => {
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

  // errMsg fallback (line 10)
  it('POST /novo/sistema com erro não-Error usa mensagem fallback', async () => {
    prisma.usuario.findUnique.mockResolvedValue({ id: 'admin1', nomeCompleto: 'Admin' })
    sistCriarMock.mockRejectedValue('string crua')
    const res = await app.inject({
      method: 'POST', url: '/novo/sistema',
      ...form({ nome: 'X', descricao: '', adminUsuarioId: 'u1' }),
    })
    expect(res.body).toContain('Erro ao criar sistema.')
  })

  // admins[0]?.usuario ?? null (linhas 80, 170)
  it('GET /painel/sistema/:id/editar lida com sistema sem admins', async () => {
    sistBuscarComAdminsMock.mockResolvedValue({
      id: 's1', nome: 'ERP', ativo: true, admins: [], _count: { modulos: 0 },
    })
    const res = await app.inject({ method: 'GET', url: '/painel/sistema/s1/editar' })
    expect(res.statusCode).toBe(200)
  })

  it('PUT /sistema/:id no catch lida com sistema sem admins', async () => {
    sistAtualizarMock.mockRejectedValue(new Error('Falhou.'))
    sistBuscarComAdminsMock.mockResolvedValue({
      id: 's1', nome: 'ERP', ativo: true, admins: [], _count: { modulos: 0 },
    })
    const res = await app.inject({
      method: 'PUT', url: '/sistema/s1',
      ...form({ nome: 'N', descricao: '', ativo: 'true' }),
    })
    expect(res.body).toContain('Falhou.')
  })

  // parentItem.parentId !== null → profundidade=2 (linhas 204, 342)
  it('GET /novo/item com parent que tem parentId calcula profundidade=2', async () => {
    prisma.menu.findUnique.mockResolvedValue({ id: 'me1', nome: 'Menu A' })
    prisma.itemFuncionalidade.findUnique.mockResolvedValue({
      id: 'p1', nome: 'Sub', parentId: 'avo1',
    })
    const res = await app.inject({ method: 'GET', url: '/novo/item?menuId=me1&parentId=p1' })
    expect(res.statusCode).toBe(200)
  })

  it('POST /novo/item com parent profundidade=2 bloqueia SUBMENU', async () => {
    prisma.menu.findUnique.mockResolvedValue({ id: 'me1', nome: 'Menu A' })
    prisma.itemFuncionalidade.findUnique.mockResolvedValue({
      id: 'p1', nome: 'Sub', parentId: 'avo1',
    })
    const res = await app.inject({
      method: 'POST', url: '/novo/item',
      ...form({ menuId: 'me1', parentId: 'p1', nome: 'X', tipo: 'SUBMENU' }),
    })
    expect(res.body).toContain('Submenu não pode ter outro submenu')
    expect(itemCriarMock).not.toHaveBeenCalled()
  })

  // Spread branches: descricao undefined em PUT (linhas 247, 380)
  it('PUT /sistema/:id omite descricao quando ausente', async () => {
    sistAtualizarMock.mockResolvedValue(undefined)
    prisma.sistema.findUnique.mockResolvedValue({
      id: 's1', nome: 'ERP', admins: [{ usuario: { id: 'u1', nomeCompleto: 'A' } }], _count: { modulos: 0 },
    })
    await app.inject({
      method: 'PUT', url: '/sistema/s1',
      ...form({ nome: 'N', ativo: 'true' }),
    })
    expect(sistAtualizarMock).toHaveBeenCalledWith('s1', { nome: 'N', ativo: true })
  })

  it('PUT /modulo/:id omite descricao quando ausente', async () => {
    modAtualizarMock.mockResolvedValue(undefined)
    prisma.modulo.findUnique.mockResolvedValue({
      id: 'm1', nome: 'M', sistema: { nome: 'ERP' }, _count: { menus: 0 },
    })
    await app.inject({
      method: 'PUT', url: '/modulo/m1',
      ...form({ nome: 'N', ativo: 'true' }),
    })
    expect(modAtualizarMock).toHaveBeenCalledWith('m1', { nome: 'N', ativo: true })
  })

  // Spread branches em PUT /menu (linhas 400, 401)
  it('PUT /menu/:id omite icone e ordem quando ausentes', async () => {
    menuAtualizarMock.mockResolvedValue(undefined)
    prisma.menu.findUnique.mockResolvedValue({
      id: 'me1', nome: 'M', modulo: { nome: 'Mod' },
    })
    await app.inject({
      method: 'PUT', url: '/menu/me1',
      ...form({ nome: 'N', ativo: 'true' }),
    })
    expect(menuAtualizarMock).toHaveBeenCalledWith('me1', { nome: 'N', ativo: true })
  })

  // Spread branches em POST /novo/item (linhas 354-357) — icone, ordem, descricao presentes
  it('POST /novo/item inclui icone, ordem, descricao e parentId quando presentes', async () => {
    prisma.menu.findUnique.mockResolvedValue({ id: 'me1', nome: 'Menu A' })
    prisma.itemFuncionalidade.findUnique.mockResolvedValue({ id: 'p1', nome: 'Pai', parentId: null })
    itemCriarMock.mockResolvedValue({ id: 'i1' })
    // buscarItemCompleto após criar
    prisma.itemFuncionalidade.findUnique
      .mockResolvedValueOnce({ id: 'p1', nome: 'Pai', parentId: null })
      .mockResolvedValueOnce({
        id: 'i1', nome: 'X', parentId: 'p1', tipo: 'FUNCIONALIDADE',
        parent: { id: 'p1', nome: 'Pai', parentId: null },
        menu: { nome: 'Menu A', id: 'me1' },
        _count: { subItens: 0 },
      })

    await app.inject({
      method: 'POST', url: '/novo/item',
      ...form({
        menuId: 'me1', parentId: 'p1', nome: 'X', tipo: 'FUNCIONALIDADE',
        tipoFuncionalidade: 'CRUD', rota: '/x', icone: 'i', ordem: '3', descricao: 'd',
      }),
    })

    expect(itemCriarMock).toHaveBeenCalledWith('me1', expect.objectContaining({
      nome: 'X', icone: 'i', ordem: 3, descricao: 'd', parentId: 'p1',
      rota: '/x', tipoFuncionalidade: 'CRUD',
    }))
  })

  // contar-filhos com tipo desconhecido (linha 495)
  it('GET /contar-filhos/:tipo/:id retorna count=0 para tipo desconhecido', async () => {
    const res = await app.inject({ method: 'GET', url: '/contar-filhos/outro/x1' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ count: 0 })
  })

  // destinos-item com SUBMENU não itera item.tipo === FUNCIONALIDADE (linha 603)
  it('GET /destinos-item/:id de item SUBMENU lista apenas menus (sem descer)', async () => {
    prisma.itemFuncionalidade.findUnique.mockResolvedValue({
      tipo: 'SUBMENU', menuId: 'me1', parentId: null, menu: { moduloId: 'm1' },
    })
    prisma.modulo.findUnique.mockResolvedValue({
      id: 'm1', nome: 'Mod', sistema: { nome: 'ERP' },
      menus: [
        { id: 'me2', nome: 'Outro Menu', itens: [
          { id: 'sub1', nome: 'S1', subItens: [
            { id: 'sub2', nome: 'S2' },
          ] },
        ] },
      ],
    })
    const res = await app.inject({ method: 'GET', url: '/destinos-item/i1' })
    expect(res.statusCode).toBe(200)
    const dest = res.json()
    // Deve incluir apenas o menu (sem submenus pq tipo=SUBMENU)
    expect(dest.some((d: { parentId: string | null }) => d.parentId === null)).toBe(true)
    expect(dest.some((d: { parentId: string | null }) => d.parentId === 'sub1')).toBe(false)
  })

  // calcProfundidade desce no chain item.parent.parent (linha 66 binary-expr i=1)
  it('POST /novo/item retorna item de profundidade=2 e calcProfundidade percorre o chain', async () => {
    prisma.menu.findUnique.mockResolvedValue({ id: 'me1', nome: 'Menu A' })
    prisma.itemFuncionalidade.findUnique
      .mockResolvedValueOnce({ id: 'p1', nome: 'Sub', parentId: 'avo1' })
      .mockResolvedValueOnce({
        id: 'i1', nome: 'X', parentId: 'p1', tipo: 'FUNCIONALIDADE',
        parent: { id: 'p1', nome: 'Sub', parentId: 'avo1' },
        menu: { nome: 'Menu A', id: 'me1' },
        _count: { subItens: 0 },
      })
    itemCriarMock.mockResolvedValue({ id: 'i1' })

    const res = await app.inject({
      method: 'POST', url: '/novo/item',
      ...form({ menuId: 'me1', parentId: 'p1', nome: 'X', tipo: 'FUNCIONALIDADE' }),
    })
    expect(res.statusCode).toBe(200)
  })

  // calcProfundidade(null) — buscarItemCompleto retorna null (linha 66)
  it('PUT /item/:id com nome vazio e item inexistente renderiza form sem profundidade', async () => {
    prisma.itemFuncionalidade.findUnique.mockResolvedValue(null)
    const res = await app.inject({
      method: 'PUT', url: '/item/i1',
      ...form({ nome: '', ativo: 'true' }),
    })
    expect(res.statusCode).toBe(200)
    expect(res.body).toMatch(/nome é obrigatório/i)
  })

  // destinos-item: item está exatamente no mesmo menu+sub1 (linha 605 if true + binary i=1)
  it('GET /destinos-item exclui a posição atual quando item está dentro de sub1', async () => {
    prisma.itemFuncionalidade.findUnique.mockResolvedValue({
      tipo: 'FUNCIONALIDADE', menuId: 'me2', parentId: 'sub1', menu: { moduloId: 'm1' },
    })
    prisma.modulo.findUnique.mockResolvedValue({
      id: 'm1', nome: 'Mod', sistema: { nome: 'ERP' },
      menus: [
        { id: 'me2', nome: 'Menu', itens: [
          { id: 'sub1', nome: 'S1', subItens: [
            { id: 'sub2', nome: 'S2' },
          ] },
        ] },
      ],
    })
    const res = await app.inject({ method: 'GET', url: '/destinos-item/i1' })
    expect(res.statusCode).toBe(200)
    const dest = res.json() as Array<{ parentId: string | null }>
    // sub1 deve estar excluído pois é a posição atual
    expect(dest.some(d => d.parentId === 'sub1')).toBe(false)
    // sub2 ainda é um destino válido
    expect(dest.some(d => d.parentId === 'sub2')).toBe(true)
  })

  // destinos-item: item está exatamente em sub2 (linha 609 if true + binary i=1)
  it('GET /destinos-item exclui a posição atual quando item está dentro de sub2', async () => {
    prisma.itemFuncionalidade.findUnique.mockResolvedValue({
      tipo: 'FUNCIONALIDADE', menuId: 'me2', parentId: 'sub2', menu: { moduloId: 'm1' },
    })
    prisma.modulo.findUnique.mockResolvedValue({
      id: 'm1', nome: 'Mod', sistema: { nome: 'ERP' },
      menus: [
        { id: 'me2', nome: 'Menu', itens: [
          { id: 'sub1', nome: 'S1', subItens: [
            { id: 'sub2', nome: 'S2' },
          ] },
        ] },
      ],
    })
    const res = await app.inject({ method: 'GET', url: '/destinos-item/i1' })
    expect(res.statusCode).toBe(200)
    const dest = res.json() as Array<{ parentId: string | null }>
    expect(dest.some(d => d.parentId === 'sub2')).toBe(false)
  })

  // PUT /modulo catch (linha 386)
  it('PUT /modulo/:id renderiza erro quando atualizar falha', async () => {
    modAtualizarMock.mockRejectedValue(new Error('Falha modulo.'))
    prisma.modulo.findUnique.mockResolvedValue({
      id: 'm1', nome: 'M', sistema: { nome: 'ERP' }, _count: { menus: 0 },
    })
    const res = await app.inject({
      method: 'PUT', url: '/modulo/m1',
      ...form({ nome: 'X', descricao: '', ativo: 'true' }),
    })
    expect(res.body).toContain('Falha modulo.')
  })

  // PUT /menu catch (linha 407)
  it('PUT /menu/:id renderiza erro quando atualizar falha', async () => {
    menuAtualizarMock.mockRejectedValue(new Error('Falha menu.'))
    prisma.menu.findUnique.mockResolvedValue({
      id: 'me1', nome: 'M', modulo: { nome: 'Mod' },
    })
    const res = await app.inject({
      method: 'PUT', url: '/menu/me1',
      ...form({ nome: 'X', ativo: 'true' }),
    })
    expect(res.body).toContain('Falha menu.')
  })

  // DELETE /modulo catch (linha 452)
  it('DELETE /modulo/:id retorna 400 quando excluir falha', async () => {
    modExcluirMock.mockRejectedValue(new Error('Em uso.'))
    const res = await app.inject({ method: 'DELETE', url: '/modulo/m1' })
    expect(res.statusCode).toBe(400)
    expect(res.body).toBe('Em uso.')
  })

  // DELETE /menu catch (linha 462)
  it('DELETE /menu/:id retorna 400 quando excluir falha', async () => {
    menuExcluirMock.mockRejectedValue(new Error('Em uso.'))
    const res = await app.inject({ method: 'DELETE', url: '/menu/me1' })
    expect(res.statusCode).toBe(400)
    expect(res.body).toBe('Em uso.')
  })

  // /reordenar/modulos catch (linhas 512-513)
  it('POST /reordenar/modulos retorna 400 quando service falha', async () => {
    modReordenarMock.mockRejectedValue(new Error('Falha.'))
    const res = await app.inject({
      method: 'POST', url: '/reordenar/modulos',
      ...form({ ids: JSON.stringify(['a', 'b']) }),
    })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({ ok: false })
  })

  // /reordenar/menus success (linha 522)
  it('POST /reordenar/menus reordena via service', async () => {
    menuReordenarMock.mockResolvedValue(undefined)
    const res = await app.inject({
      method: 'POST', url: '/reordenar/menus',
      ...form({ ids: JSON.stringify(['a', 'b']) }),
    })
    expect(res.statusCode).toBe(200)
    expect(menuReordenarMock).toHaveBeenCalledWith(['a', 'b'])
  })

  // catch de /reordenar/itens (linhas 536-537)
  it('POST /reordenar/itens retorna 400 quando service falha', async () => {
    itemReordenarMock.mockRejectedValue(new Error('Falha.'))
    const res = await app.inject({
      method: 'POST', url: '/reordenar/itens',
      ...form({ ids: JSON.stringify(['i1', 'i2']) }),
    })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({ ok: false })
  })

  // catch de /atalho/item (linha 559)
  it('POST /atalho/item retorna 400 com mensagem quando criarAtalho falha', async () => {
    itemAtalhoMock.mockRejectedValue(new Error('Já existe atalho.'))
    const res = await app.inject({
      method: 'POST', url: '/atalho/item',
      ...form({ itemId: 'i1', novoMenuId: 'me2' }),
    })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({ ok: false, erro: 'Já existe atalho.' })
  })

  // destinos-item com FUNCIONALIDADE: cobre o caso em que item está numa posição
  // diferente e iterações descem em sub1/sub2 que NÃO são a posição atual
  it('GET /destinos-item/:id de item FUNCIONALIDADE inclui submenus aninhados como destinos', async () => {
    prisma.itemFuncionalidade.findUnique.mockResolvedValue({
      tipo: 'FUNCIONALIDADE', menuId: 'me1', parentId: null, menu: { moduloId: 'm1' },
    })
    prisma.modulo.findUnique.mockResolvedValue({
      id: 'm1', nome: 'Mod', sistema: { nome: 'ERP' },
      menus: [
        { id: 'me2', nome: 'Menu Outro', itens: [
          { id: 'sub1', nome: 'S1', subItens: [
            { id: 'sub2', nome: 'S2' },
          ] },
        ] },
      ],
    })
    const res = await app.inject({ method: 'GET', url: '/destinos-item/i1' })
    expect(res.statusCode).toBe(200)
    const dest = res.json() as Array<{ parentId: string | null }>
    expect(dest.some(d => d.parentId === 'sub1')).toBe(true)
    expect(dest.some(d => d.parentId === 'sub2')).toBe(true)
  })
})
