import { describe, it, expect, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'
import { ItensService } from '../itens.js'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'

const MENU_ATIVO = { id: 'me1', nome: 'Cadastros', moduloId: 'mo1', ativo: true }
const MENU_INATIVO = { id: 'me2', nome: 'Antigo', moduloId: 'mo1', ativo: false }
const ITEM_FUNC = {
  id: 'it1',
  nome: 'Listar',
  descricao: null,
  tipo: 'FUNCIONALIDADE',
  tipoFuncionalidade: 'TELA',
  rota: '/listar',
  icone: null,
  ordem: 0,
  ativo: true,
  menuId: 'me1',
  parentId: null,
  subItens: [],
}
const ITEM_SUBMENU = { ...ITEM_FUNC, id: 'it2', nome: 'Pasta', tipo: 'SUBMENU', tipoFuncionalidade: null, rota: null }

const erroP2025 = new Prisma.PrismaClientKnownRequestError('Record not found', {
  code: 'P2025',
  clientVersion: '7.0.0',
})

describe('ItensService.listar', () => {
  let prisma: PrismaMock
  let service: ItensService

  beforeEach(() => {
    prisma = criarPrismaMock()
    service = new ItensService(prisma as never)
  })

  it('lança RECURSO_NAO_ENCONTRADO quando menu não existe', async () => {
    prisma.menu.findUnique.mockResolvedValue(null)

    await expect(service.listar('me-inexistente'))
      .rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
  })

  it('lista itens raiz com subItens incluídos', async () => {
    prisma.menu.findUnique.mockResolvedValue(MENU_ATIVO)
    prisma.itemFuncionalidade.findMany.mockResolvedValue([ITEM_FUNC])

    const resultado = await service.listar('me1')

    expect(prisma.itemFuncionalidade.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { menuId: 'me1', parentId: null } }),
    )
    expect(resultado).toEqual([ITEM_FUNC])
  })
})

describe('ItensService.criar', () => {
  let prisma: PrismaMock
  let service: ItensService

  beforeEach(() => {
    prisma = criarPrismaMock()
    service = new ItensService(prisma as never)
  })

  it('lança RECURSO_NAO_ENCONTRADO quando menu não existe', async () => {
    prisma.menu.findUnique.mockResolvedValue(null)

    await expect(service.criar('me-inexistente', { nome: 'X', tipo: 'FUNCIONALIDADE', tipoFuncionalidade: 'TELA' }))
      .rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
  })

  it('lança CONFLITO quando menu está inativo', async () => {
    prisma.menu.findUnique.mockResolvedValue(MENU_INATIVO)

    await expect(service.criar('me2', { nome: 'X', tipo: 'FUNCIONALIDADE', tipoFuncionalidade: 'TELA' }))
      .rejects.toMatchObject({ code: 'CONFLITO' })
  })

  it('exige tipoFuncionalidade para itens do tipo FUNCIONALIDADE', async () => {
    prisma.menu.findUnique.mockResolvedValue(MENU_ATIVO)

    await expect(service.criar('me1', { nome: 'X', tipo: 'FUNCIONALIDADE' }))
      .rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
  })

  it('proíbe tipoFuncionalidade em itens do tipo SUBMENU', async () => {
    prisma.menu.findUnique.mockResolvedValue(MENU_ATIVO)

    await expect(service.criar('me1', { nome: 'X', tipo: 'SUBMENU', tipoFuncionalidade: 'TELA' }))
      .rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
  })

  it('lança REQUISICAO_INVALIDA quando pai não é SUBMENU', async () => {
    prisma.menu.findUnique.mockResolvedValue(MENU_ATIVO)
    prisma.itemFuncionalidade.findUnique.mockResolvedValue(ITEM_FUNC)

    await expect(service.criar('me1', { nome: 'X', tipo: 'FUNCIONALIDADE', tipoFuncionalidade: 'TELA', parentId: 'it1' }))
      .rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
  })

  it('lança REQUISICAO_INVALIDA quando pai pertence a outro menu', async () => {
    prisma.menu.findUnique.mockResolvedValue(MENU_ATIVO)
    prisma.itemFuncionalidade.findUnique.mockResolvedValue({ ...ITEM_SUBMENU, menuId: 'outro-menu' })

    await expect(service.criar('me1', { nome: 'X', tipo: 'FUNCIONALIDADE', tipoFuncionalidade: 'TELA', parentId: 'it2' }))
      .rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
  })

  it('bloqueia criar SUBMENU sob outro SUBMENU já aninhado (profundidade máxima)', async () => {
    prisma.menu.findUnique.mockResolvedValue(MENU_ATIVO)
    // pai é submenu de profundidade 1 (já tem parentId)
    prisma.itemFuncionalidade.findUnique.mockResolvedValue({ ...ITEM_SUBMENU, parentId: 'it-raiz' })

    await expect(service.criar('me1', { nome: 'X', tipo: 'SUBMENU', parentId: 'it2' }))
      .rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
  })

  it('cria item válido com menuId injetado', async () => {
    prisma.menu.findUnique.mockResolvedValue(MENU_ATIVO)
    prisma.itemFuncionalidade.create.mockResolvedValue(ITEM_FUNC)

    const resultado = await service.criar('me1', { nome: 'Listar', tipo: 'FUNCIONALIDADE', tipoFuncionalidade: 'TELA' })

    expect(prisma.itemFuncionalidade.create).toHaveBeenCalledWith({
      data: { nome: 'Listar', tipo: 'FUNCIONALIDADE', tipoFuncionalidade: 'TELA', menuId: 'me1' },
    })
    expect(resultado).toEqual(ITEM_FUNC)
  })
})

describe('ItensService.atualizar', () => {
  let prisma: PrismaMock
  let service: ItensService

  beforeEach(() => {
    prisma = criarPrismaMock()
    service = new ItensService(prisma as never)
  })

  it('proíbe definir tipoFuncionalidade em item SUBMENU', async () => {
    prisma.itemFuncionalidade.findUnique.mockResolvedValue({ tipo: 'SUBMENU' })

    await expect(service.atualizar('it2', { tipoFuncionalidade: 'TELA' }))
      .rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
  })

  it('lança RECURSO_NAO_ENCONTRADO ao checar tipo de item inexistente', async () => {
    prisma.itemFuncionalidade.findUnique.mockResolvedValue(null)

    await expect(service.atualizar('it-x', { tipoFuncionalidade: 'TELA' }))
      .rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
  })

  it('atualiza item existente', async () => {
    prisma.itemFuncionalidade.update.mockResolvedValue({ ...ITEM_FUNC, nome: 'Novo' })

    const resultado = await service.atualizar('it1', { nome: 'Novo' })

    expect(resultado.nome).toBe('Novo')
  })

  it('mapeia P2025 para RECURSO_NAO_ENCONTRADO', async () => {
    prisma.itemFuncionalidade.update.mockRejectedValue(erroP2025)

    await expect(service.atualizar('it-x', { nome: 'Y' }))
      .rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
  })
})

describe('ItensService.excluir', () => {
  let prisma: PrismaMock
  let service: ItensService

  beforeEach(() => {
    prisma = criarPrismaMock()
    service = new ItensService(prisma as never)
  })

  it('lança RECURSO_NAO_ENCONTRADO quando item não existe', async () => {
    prisma.itemFuncionalidade.findUnique.mockResolvedValue(null)

    await expect(service.excluir('it-x')).rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
  })

  it('executa cascade em transação, removendo permissões e o item', async () => {
    prisma.itemFuncionalidade.findUnique.mockResolvedValue(ITEM_FUNC)
    prisma.itemFuncionalidade.findMany
      .mockResolvedValueOnce([{ id: 'it1', parentId: null }])
      .mockResolvedValueOnce([])

    await service.excluir('it1')

    expect(prisma.$transaction).toHaveBeenCalledOnce()
    expect(prisma.permissaoAcesso.deleteMany).toHaveBeenCalled()
    expect(prisma.itemFuncionalidade.delete).toHaveBeenCalledWith({ where: { id: 'it1' } })
  })
})

describe('ItensService.copiar', () => {
  let prisma: PrismaMock
  let service: ItensService

  beforeEach(() => {
    prisma = criarPrismaMock()
    service = new ItensService(prisma as never)
  })

  it('exige menu de destino', async () => {
    await expect(service.copiar('it1', null, ''))
      .rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
  })

  it('lança RECURSO_NAO_ENCONTRADO quando item de origem não existe', async () => {
    prisma.itemFuncionalidade.findUnique.mockResolvedValue(null)

    await expect(service.copiar('it-x', null, 'me1'))
      .rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
  })

  it('lança RECURSO_NAO_ENCONTRADO quando menu de destino não existe', async () => {
    prisma.itemFuncionalidade.findUnique.mockResolvedValue({ ...ITEM_FUNC, subItens: [] })
    prisma.menu.findUnique.mockResolvedValue(null)

    await expect(service.copiar('it1', null, 'me-inexistente'))
      .rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
  })

  it('copia item criando novo com sufixo "(cópia)" no nome raiz', async () => {
    prisma.itemFuncionalidade.findUnique.mockResolvedValue({ ...ITEM_FUNC, subItens: [] })
    prisma.menu.findUnique.mockResolvedValue({ id: 'me1' })
    prisma.itemFuncionalidade.create.mockResolvedValue({ ...ITEM_FUNC, id: 'it-novo' })

    await service.copiar('it1', null, 'me1')

    expect(prisma.itemFuncionalidade.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ nome: 'Listar (cópia)', menuId: 'me1', parentId: null }) }),
    )
  })
})

describe('ItensService.criarAtalho', () => {
  let prisma: PrismaMock
  let service: ItensService

  beforeEach(() => {
    prisma = criarPrismaMock()
    service = new ItensService(prisma as never)
  })

  it('exige menu de destino', async () => {
    await expect(service.criarAtalho('it1', null, ''))
      .rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
  })

  it('lança RECURSO_NAO_ENCONTRADO quando item de origem não existe', async () => {
    prisma.itemFuncionalidade.findUnique.mockResolvedValue(null)

    await expect(service.criarAtalho('it-x', null, 'me1'))
      .rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
  })

  it('proíbe atalho de atalho', async () => {
    prisma.itemFuncionalidade.findUnique.mockResolvedValue({ ...ITEM_FUNC, referenciaId: 'it0' })

    await expect(service.criarAtalho('it1', null, 'me1'))
      .rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
  })

  it('lança RECURSO_NAO_ENCONTRADO quando menu de destino não existe', async () => {
    prisma.itemFuncionalidade.findUnique.mockResolvedValue({ ...ITEM_FUNC, referenciaId: null })
    prisma.menu.findUnique.mockResolvedValue(null)

    await expect(service.criarAtalho('it1', null, 'me-inexistente'))
      .rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
  })

  it('cria atalho com referenciaId apontando para o item original (sem sufixo no nome)', async () => {
    prisma.itemFuncionalidade.findUnique
      .mockResolvedValueOnce({ ...ITEM_FUNC, referenciaId: null })
    prisma.menu.findUnique.mockResolvedValue({ id: 'me1' })
    prisma.itemFuncionalidade.create.mockResolvedValue({ ...ITEM_FUNC, id: 'it-atalho', referenciaId: 'it1' })

    await service.criarAtalho('it1', null, 'me1')

    expect(prisma.itemFuncionalidade.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        nome: 'Listar',
        menuId: 'me1',
        parentId: null,
        referenciaId: 'it1',
      }),
    })
  })

  it('valida que parent de destino pertence ao menu de destino', async () => {
    prisma.itemFuncionalidade.findUnique
      .mockResolvedValueOnce({ ...ITEM_FUNC, referenciaId: null })
      .mockResolvedValueOnce({ tipo: 'SUBMENU', menuId: 'outro-menu' })
    prisma.menu.findUnique.mockResolvedValue({ id: 'me1' })

    await expect(service.criarAtalho('it1', 'sub-fora', 'me1'))
      .rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
  })

  it('exige que parent seja do tipo SUBMENU', async () => {
    prisma.itemFuncionalidade.findUnique
      .mockResolvedValueOnce({ ...ITEM_FUNC, referenciaId: null })
      .mockResolvedValueOnce({ tipo: 'FUNCIONALIDADE', menuId: 'me1' })
    prisma.menu.findUnique.mockResolvedValue({ id: 'me1' })

    await expect(service.criarAtalho('it1', 'it-func', 'me1'))
      .rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
  })
})

describe('ItensService.mover', () => {
  let prisma: PrismaMock
  let service: ItensService

  beforeEach(() => {
    prisma = criarPrismaMock()
    service = new ItensService(prisma as never)
  })

  it('lança RECURSO_NAO_ENCONTRADO quando item não existe', async () => {
    prisma.itemFuncionalidade.findUnique.mockResolvedValue(null)

    await expect(service.mover('it-x', null))
      .rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
  })

  it('proíbe mover entre módulos diferentes', async () => {
    prisma.itemFuncionalidade.findUnique.mockResolvedValueOnce({ ...ITEM_FUNC, subItens: [] })
    prisma.menu.findUnique
      .mockResolvedValueOnce({ moduloId: 'mo1' }) // origem
      .mockResolvedValueOnce({ moduloId: 'mo2' }) // destino

    await expect(service.mover('it1', null, 'me-outro'))
      .rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
  })

  it('detecta ciclo ao mover item para dentro de seus descendentes', async () => {
    // primeira chamada: o próprio item (no início de mover)
    prisma.itemFuncionalidade.findUnique
      .mockResolvedValueOnce({ ...ITEM_SUBMENU, id: 'pai', subItens: [] })
      // chamadas em isDescendant: candidato 'filho' → pai = 'pai'
      .mockResolvedValueOnce({ parentId: 'pai' })

    await expect(service.mover('pai', 'filho'))
      .rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
  })

  it('bloqueia movimento que extrapola profundidade de 2 níveis', async () => {
    // item é SUBMENU com filhos que também têm filhos → profMaxFilhos = 2
    const itemComNetos = {
      ...ITEM_SUBMENU,
      id: 'pai',
      subItens: [{ id: 'f1', subItens: [{ id: 'n1' }] }],
    }
    prisma.itemFuncionalidade.findUnique
      .mockResolvedValueOnce(itemComNetos)
      // isDescendant: candidato 'novo-pai', parentId null → sai do loop sem encontrar
      .mockResolvedValueOnce({ parentId: null })
      // busca do novoParent
      .mockResolvedValueOnce({ id: 'novo-pai', tipo: 'SUBMENU', parentId: null })

    await expect(service.mover('pai', 'novo-pai'))
      .rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
  })

  it('atualiza parentId quando movimento é válido', async () => {
    prisma.itemFuncionalidade.findUnique
      .mockResolvedValueOnce({ ...ITEM_FUNC, tipo: 'FUNCIONALIDADE', subItens: [] })
      // isDescendant: novoParentId='novo-pai', parentId null → sai
      .mockResolvedValueOnce({ parentId: null })
      // busca novoParent
      .mockResolvedValueOnce({ id: 'novo-pai', tipo: 'SUBMENU', parentId: null })

    await service.mover('it1', 'novo-pai')

    expect(prisma.itemFuncionalidade.update).toHaveBeenCalledWith({
      where: { id: 'it1' },
      data: { parentId: 'novo-pai' },
    })
  })
})

describe('ItensService.reordenar', () => {
  let prisma: PrismaMock
  let service: ItensService

  beforeEach(() => {
    prisma = criarPrismaMock()
    service = new ItensService(prisma as never)
  })

  it('atualiza ordem de cada item na sequência fornecida', async () => {
    await service.reordenar(['a', 'b'])

    expect(prisma.itemFuncionalidade.update).toHaveBeenCalledTimes(2)
    expect(prisma.itemFuncionalidade.update).toHaveBeenNthCalledWith(1, { where: { id: 'a' }, data: { ordem: 0 } })
    expect(prisma.itemFuncionalidade.update).toHaveBeenNthCalledWith(2, { where: { id: 'b' }, data: { ordem: 1 } })
  })
})
