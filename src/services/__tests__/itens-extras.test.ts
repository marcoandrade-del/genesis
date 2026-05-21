import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ItensService } from '../itens.js'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'

const MENU_ATIVO = { id: 'me1', nome: 'Cadastros', moduloId: 'mo1', ativo: true }
const ITEM_FUNC = {
  id: 'it1', nome: 'Listar', descricao: null, tipo: 'FUNCIONALIDADE',
  tipoFuncionalidade: 'TELA', rota: '/listar', icone: null, ordem: 0, ativo: true,
  menuId: 'me1', parentId: null, subItens: [],
}
const ITEM_SUBMENU = { ...ITEM_FUNC, id: 'it2', nome: 'Pasta', tipo: 'SUBMENU', tipoFuncionalidade: null, rota: null }

describe('ItensService.buscarPorId', () => {
  let prisma: PrismaMock
  let service: ItensService

  beforeEach(() => {
    prisma = criarPrismaMock()
    service = new ItensService(prisma as never)
  })

  it('delega para prisma.itemFuncionalidade.findUnique com subItens', () => {
    prisma.itemFuncionalidade.findUnique.mockResolvedValue(ITEM_FUNC)
    service.buscarPorId('it1')
    expect(prisma.itemFuncionalidade.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'it1' } }),
    )
  })
})

describe('ItensService.criar — branches restantes', () => {
  let prisma: PrismaMock
  let service: ItensService

  beforeEach(() => {
    prisma = criarPrismaMock()
    service = new ItensService(prisma as never)
  })

  it('lança RECURSO_NAO_ENCONTRADO quando pai não existe', async () => {
    prisma.menu.findUnique.mockResolvedValue(MENU_ATIVO)
    prisma.itemFuncionalidade.findUnique.mockResolvedValue(null)

    await expect(service.criar('me1', {
      nome: 'X', tipo: 'FUNCIONALIDADE', tipoFuncionalidade: 'TELA', parentId: 'inexistente',
    })).rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
  })

  it('cria SUBMENU sob outro SUBMENU raiz (parent.parentId null) com sucesso', async () => {
    prisma.menu.findUnique.mockResolvedValue(MENU_ATIVO)
    prisma.itemFuncionalidade.findUnique.mockResolvedValue({ ...ITEM_SUBMENU, parentId: null, menuId: 'me1' })
    prisma.itemFuncionalidade.create.mockResolvedValue({ ...ITEM_SUBMENU, id: 'it-novo' })

    const r = await service.criar('me1', { nome: 'NovaPasta', tipo: 'SUBMENU', parentId: 'it2' })
    expect(r.id).toBe('it-novo')
  })
})

describe('ItensService.atualizar — branches restantes', () => {
  let prisma: PrismaMock
  let service: ItensService

  beforeEach(() => {
    prisma = criarPrismaMock()
    service = new ItensService(prisma as never)
  })

  it('permite atualizar tipoFuncionalidade em item FUNCIONALIDADE', async () => {
    prisma.itemFuncionalidade.findUnique.mockResolvedValue({ tipo: 'FUNCIONALIDADE' })
    prisma.itemFuncionalidade.update.mockResolvedValue({ ...ITEM_FUNC, tipoFuncionalidade: 'RELATORIO' })

    const r = await service.atualizar('it1', { tipoFuncionalidade: 'RELATORIO' })
    expect(r.tipoFuncionalidade).toBe('RELATORIO')
  })

  it('propaga erro não-P2025 do prisma', async () => {
    const erro = new Error('db down')
    prisma.itemFuncionalidade.update.mockRejectedValue(erro)

    await expect(service.atualizar('it1', { nome: 'X' })).rejects.toThrow('db down')
  })
})

describe('ItensService.excluir — branches restantes', () => {
  let prisma: PrismaMock
  let service: ItensService

  beforeEach(() => {
    prisma = criarPrismaMock()
    service = new ItensService(prisma as never)
  })

  it('chama lixeiraService.salvarItem quando fornecido com usuarioId', async () => {
    prisma.itemFuncionalidade.findUnique.mockResolvedValue(ITEM_SUBMENU)
    prisma.itemFuncionalidade.findMany
      .mockResolvedValueOnce([{ id: 'it2', parentId: null }])
      .mockResolvedValueOnce([])

    const lixeiraService = { salvarItem: async () => {} }
    const spy = vi.spyOn(lixeiraService, 'salvarItem')

    await service.excluir('it2', 'usr1', lixeiraService as never)

    expect(spy).toHaveBeenCalledWith('it2', 'usr1', expect.anything())
  })

  it('cascateia subItens e sub-sub-itens', async () => {
    prisma.itemFuncionalidade.findUnique.mockResolvedValue(ITEM_SUBMENU)
    prisma.itemFuncionalidade.findMany
      .mockResolvedValueOnce([
        { id: 'it2', parentId: null },
        { id: 'sub1', parentId: 'it2' },
      ])
      .mockResolvedValueOnce([{ id: 'subsub1' }])

    await service.excluir('it2')

    expect(prisma.itemFuncionalidade.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['subsub1'] } } })
    expect(prisma.itemFuncionalidade.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['sub1'] } } })
    expect(prisma.itemFuncionalidade.delete).toHaveBeenCalledWith({ where: { id: 'it2' } })
  })
})

describe('ItensService.copiar — novoParentId branches', () => {
  let prisma: PrismaMock
  let service: ItensService

  beforeEach(() => {
    prisma = criarPrismaMock()
    service = new ItensService(prisma as never)
  })

  it('lança RECURSO_NAO_ENCONTRADO quando novoParent não existe', async () => {
    prisma.itemFuncionalidade.findUnique
      .mockResolvedValueOnce({ ...ITEM_FUNC, subItens: [] })
      .mockResolvedValueOnce(null)
    prisma.menu.findUnique.mockResolvedValue({ id: 'me1' })

    await expect(service.copiar('it1', 'pai-x', 'me1'))
      .rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
  })

  it('lança REQUISICAO_INVALIDA quando novoParent não é SUBMENU', async () => {
    prisma.itemFuncionalidade.findUnique
      .mockResolvedValueOnce({ ...ITEM_FUNC, subItens: [] })
      .mockResolvedValueOnce({ tipo: 'FUNCIONALIDADE', parentId: null })
    prisma.menu.findUnique.mockResolvedValue({ id: 'me1' })

    await expect(service.copiar('it1', 'pai', 'me1'))
      .rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
  })

  it('bloqueia copiar SUBMENU para dentro de outro SUBMENU já profundo', async () => {
    prisma.itemFuncionalidade.findUnique
      .mockResolvedValueOnce({ ...ITEM_SUBMENU, subItens: [] })
      .mockResolvedValueOnce({ tipo: 'SUBMENU', parentId: 'algum-pai' })
    prisma.menu.findUnique.mockResolvedValue({ id: 'me1' })

    await expect(service.copiar('it2', 'pai-profundo', 'me1'))
      .rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
  })

  it('copia recursivamente itens com subItens', async () => {
    const submenuComFilhos = {
      ...ITEM_SUBMENU,
      subItens: [
        { ...ITEM_FUNC, id: 'f1', subItens: [] },
        { ...ITEM_FUNC, id: 'f2', subItens: [] },
      ],
    }
    prisma.itemFuncionalidade.findUnique.mockResolvedValue(submenuComFilhos)
    prisma.menu.findUnique.mockResolvedValue({ id: 'me1' })
    prisma.itemFuncionalidade.create.mockResolvedValue({ ...ITEM_SUBMENU, id: 'novo' })

    await service.copiar('it2', null, 'me1')

    expect(prisma.itemFuncionalidade.create).toHaveBeenCalledTimes(3)
  })

  // Line 137 i=1 — copiar com novoParent.parentId null (SUBMENU raiz), item FUNCIONALIDADE
  it('copia FUNCIONALIDADE para dentro de SUBMENU raiz (parentId null)', async () => {
    prisma.itemFuncionalidade.findUnique
      .mockResolvedValueOnce({ ...ITEM_FUNC, subItens: [] })
      .mockResolvedValueOnce({ tipo: 'SUBMENU', parentId: null })
    prisma.menu.findUnique.mockResolvedValue({ id: 'me1' })
    prisma.itemFuncionalidade.create.mockResolvedValue({ ...ITEM_FUNC, id: 'novo' })

    await service.copiar('it1', 'pai-raiz', 'me1')

    expect(prisma.itemFuncionalidade.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ parentId: 'pai-raiz' }) }),
    )
  })

  // Line 169 i=1 — _copiarRecursivo com sub-item sem campo subItens
  it('copia recursivamente quando sub-item não traz campo subItens (usa fallback ?? [])', async () => {
    const submenu = {
      ...ITEM_SUBMENU,
      subItens: [
        // sub sem subItens — força o fallback `?? []` no `_copiarRecursivo`
        { ...ITEM_FUNC, id: 'f1' },
      ],
    }
    delete (submenu.subItens[0] as { subItens?: unknown[] }).subItens
    prisma.itemFuncionalidade.findUnique.mockResolvedValue(submenu)
    prisma.menu.findUnique.mockResolvedValue({ id: 'me1' })
    prisma.itemFuncionalidade.create.mockResolvedValue({ ...ITEM_SUBMENU, id: 'novo' })

    await service.copiar('it2', null, 'me1')

    expect(prisma.itemFuncionalidade.create).toHaveBeenCalledTimes(2)
  })
})

describe('ItensService.criarAtalho — branches restantes', () => {
  let prisma: PrismaMock
  let service: ItensService

  beforeEach(() => {
    prisma = criarPrismaMock()
    service = new ItensService(prisma as never)
  })

  it('lança RECURSO_NAO_ENCONTRADO quando novoParent não existe', async () => {
    prisma.itemFuncionalidade.findUnique
      .mockResolvedValueOnce({ ...ITEM_FUNC, referenciaId: null })
      .mockResolvedValueOnce(null)
    prisma.menu.findUnique.mockResolvedValue({ id: 'me1' })

    await expect(service.criarAtalho('it1', 'pai-x', 'me1'))
      .rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
  })

  it('cria atalho com parentId válido (SUBMENU no mesmo menu)', async () => {
    prisma.itemFuncionalidade.findUnique
      .mockResolvedValueOnce({ ...ITEM_FUNC, referenciaId: null })
      .mockResolvedValueOnce({ tipo: 'SUBMENU', menuId: 'me1' })
    prisma.menu.findUnique.mockResolvedValue({ id: 'me1' })
    prisma.itemFuncionalidade.create.mockResolvedValue({ ...ITEM_FUNC, id: 'atalho', referenciaId: 'it1' })

    await service.criarAtalho('it1', 'sub-pai', 'me1')
    expect(prisma.itemFuncionalidade.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ parentId: 'sub-pai', referenciaId: 'it1' }) }),
    )
  })
})

describe('ItensService.mover — branches restantes', () => {
  let prisma: PrismaMock
  let service: ItensService

  beforeEach(() => {
    prisma = criarPrismaMock()
    service = new ItensService(prisma as never)
  })

  it('lança RECURSO_NAO_ENCONTRADO quando menu de destino não existe', async () => {
    prisma.itemFuncionalidade.findUnique.mockResolvedValueOnce({ ...ITEM_FUNC, subItens: [] })
    prisma.menu.findUnique
      .mockResolvedValueOnce({ moduloId: 'mo1' })
      .mockResolvedValueOnce(null)

    await expect(service.mover('it1', null, 'me-inexistente'))
      .rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
  })

  it('lança RECURSO_NAO_ENCONTRADO quando novoParent não existe', async () => {
    prisma.itemFuncionalidade.findUnique
      .mockResolvedValueOnce({ ...ITEM_FUNC, subItens: [] })
      .mockResolvedValueOnce({ parentId: null })
      .mockResolvedValueOnce(null)

    await expect(service.mover('it1', 'pai-x'))
      .rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
  })

  it('lança REQUISICAO_INVALIDA quando novoParent não é SUBMENU', async () => {
    prisma.itemFuncionalidade.findUnique
      .mockResolvedValueOnce({ ...ITEM_FUNC, subItens: [] })
      .mockResolvedValueOnce({ parentId: null })
      .mockResolvedValueOnce({ id: 'pai', tipo: 'FUNCIONALIDADE', parentId: null })

    await expect(service.mover('it1', 'pai'))
      .rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
  })

  it('permite mover SUBMENU sem netos para sob outro SUBMENU raiz', async () => {
    const submenuSemNetos = { ...ITEM_SUBMENU, subItens: [{ id: 'f1', subItens: [] }] }
    prisma.itemFuncionalidade.findUnique
      .mockResolvedValueOnce(submenuSemNetos)
      .mockResolvedValueOnce({ parentId: null })
      .mockResolvedValueOnce({ id: 'novo-pai', tipo: 'SUBMENU', parentId: null })

    await service.mover('it2', 'novo-pai')

    expect(prisma.itemFuncionalidade.update).toHaveBeenCalledWith({
      where: { id: 'it2' },
      data: { parentId: 'novo-pai' },
    })
  })

  // Line 272 i=0 — mover sob novoParent com parentId truthy (profDest=1)
  it('permite mover FUNCIONALIDADE sob SUBMENU filho (novoParent.parentId truthy)', async () => {
    prisma.itemFuncionalidade.findUnique
      .mockResolvedValueOnce({ ...ITEM_FUNC, subItens: [] })
      .mockResolvedValueOnce({ parentId: null })
      .mockResolvedValueOnce({ id: 'novo-pai', tipo: 'SUBMENU', parentId: 'avo' })

    await service.mover('it1', 'novo-pai')

    expect(prisma.itemFuncionalidade.update).toHaveBeenCalledWith({
      where: { id: 'it1' },
      data: { parentId: 'novo-pai' },
    })
  })

  it('move com menuId quando destino é o mesmo módulo', async () => {
    prisma.itemFuncionalidade.findUnique
      .mockResolvedValueOnce({ ...ITEM_FUNC, subItens: [] })
    prisma.menu.findUnique
      .mockResolvedValueOnce({ moduloId: 'mo1' })
      .mockResolvedValueOnce({ moduloId: 'mo1' })

    await service.mover('it1', null, 'me-outro')

    expect(prisma.itemFuncionalidade.update).toHaveBeenCalledWith({
      where: { id: 'it1' },
      data: { parentId: null, menuId: 'me-outro' },
    })
  })
})
