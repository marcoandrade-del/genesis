import { describe, it, expect, beforeEach } from 'vitest'
import { LixeiraService } from '../lixeira.js'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'

function entrada(tipo: string, estrutura: unknown) {
  return { id: 'lx1', tipo, nome: 'X', estrutura, excluidoPorId: 'u1', excluidoEm: new Date() }
}

describe('LixeiraService.restaurar — branches restantes', () => {
  let prisma: PrismaMock
  let service: LixeiraService

  beforeEach(() => {
    prisma = criarPrismaMock()
    service = new LixeiraService(prisma as never)
  })

  // Line 82 if i=1 — tipo desconhecido cai pelo if-else sem ação
  it('tipo desconhecido apenas remove a entrada da lixeira (no-op)', async () => {
    prisma.lixeira.findUnique.mockResolvedValue(entrada('outro', { id: 'x' }))

    await service.restaurar('lx1')

    expect(prisma.lixeira.delete).toHaveBeenCalledWith({ where: { id: 'lx1' } })
  })

  // Line 93 i=1 — sistema sem admins (admins undefined → fallback [])
  it('restaura sistema sem campo admins (usa fallback ?? [])', async () => {
    const sistema = { id: 's1', nome: 'Sis', descricao: null, ativo: true, modulos: [] }
    prisma.lixeira.findUnique.mockResolvedValue(entrada('sistema', sistema))
    prisma.sistema.findUnique.mockResolvedValue(null)
    prisma.sistema.create.mockResolvedValue(sistema as never)

    await service.restaurar('lx1')

    expect(prisma.adminSistema.upsert).not.toHaveBeenCalled()
  })

  // Line 112 i=1 — módulo sem admins
  it('restaura módulo sem campo admins (usa fallback ?? [])', async () => {
    const modulo = { id: 'mo1', nome: 'Mod', sistemaId: 's1', ativo: true, ordem: 0, menus: [] }
    prisma.lixeira.findUnique.mockResolvedValue(entrada('modulo', modulo))
    prisma.sistema.findUnique.mockResolvedValue({ id: 's1' })
    prisma.modulo.findUnique.mockResolvedValue(null)
    prisma.modulo.create.mockResolvedValue({} as never)

    await service.restaurar('lx1')

    expect(prisma.adminModulo.upsert).not.toHaveBeenCalled()
  })

  // Line 114 if i=1 — adminModulo aponta para usuário inexistente, ignora upsert
  it('ignora admin de módulo quando usuário não existe', async () => {
    const modulo = {
      id: 'mo1', nome: 'Mod', sistemaId: 's1', ativo: true, ordem: 0,
      admins: [{ usuarioId: 'u_inexistente', ativo: true }],
      menus: [],
    }
    prisma.lixeira.findUnique.mockResolvedValue(entrada('modulo', modulo))
    prisma.sistema.findUnique.mockResolvedValue({ id: 's1' })
    prisma.modulo.findUnique.mockResolvedValue(null)
    prisma.modulo.create.mockResolvedValue({} as never)
    prisma.usuario.findUnique.mockResolvedValue(null)

    await service.restaurar('lx1')

    expect(prisma.adminModulo.upsert).not.toHaveBeenCalled()
  })

  // Line 139 if i=1 — _restaurarItem com parentId existente
  it('restaura item filho quando pai existe', async () => {
    const itemFilho = {
      id: 'it2', nome: 'Sub', descricao: null, tipo: 'FUNCIONALIDADE',
      tipoFuncionalidade: 'CRUD', rota: null, icone: null, ordem: 0, ativo: true,
      menuId: 'me1', parentId: 'pai_existe', subItens: [],
    }
    prisma.lixeira.findUnique.mockResolvedValue(entrada('item', itemFilho))
    prisma.menu.findUnique.mockResolvedValue({ id: 'me1' })
    prisma.itemFuncionalidade.findUnique
      .mockResolvedValueOnce({ id: 'pai_existe' })  // pai check
      .mockResolvedValueOnce(null)                  // item ainda não existe
    prisma.itemFuncionalidade.create.mockResolvedValue({} as never)

    await service.restaurar('lx1')

    expect(prisma.itemFuncionalidade.create).toHaveBeenCalled()
  })

  // Line 164 i=1 — _restaurarItemRecursivo com subItens undefined
  it('restaura item sem campo subItens (usa fallback ?? [])', async () => {
    const item: { subItens?: unknown[] } & Record<string, unknown> = {
      id: 'it1', nome: 'It', descricao: null, tipo: 'SUBMENU',
      tipoFuncionalidade: null, rota: null, icone: null, ordem: 0, ativo: true,
      menuId: 'me1', parentId: null,
    }
    prisma.lixeira.findUnique.mockResolvedValue(entrada('item', item))
    prisma.menu.findUnique.mockResolvedValue({ id: 'me1' })
    prisma.itemFuncionalidade.findUnique.mockResolvedValue(null)
    prisma.itemFuncionalidade.create.mockResolvedValue({} as never)

    await service.restaurar('lx1')

    expect(prisma.itemFuncionalidade.create).toHaveBeenCalledOnce()
  })
})
