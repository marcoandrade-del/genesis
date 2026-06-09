import { describe, it, expect, beforeEach } from 'vitest'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'
import { MenuAppService } from '../menu-app.js'

type ItemRow = {
  id: string; nome: string; descricao: string | null; rota: string | null
  icone: string | null; tipo: 'FUNCIONALIDADE' | 'SUBMENU'; parentId: string | null
}
const item = (over: Partial<ItemRow> & { id: string }): ItemRow => ({
  nome: over.id, descricao: null, rota: `/${over.id}`, icone: null,
  tipo: 'FUNCIONALIDADE', parentId: null, ...over,
})

describe('MenuAppService.arvorePermitida', () => {
  let prisma: PrismaMock
  let service: MenuAppService

  beforeEach(() => {
    prisma = criarPrismaMock()
    service = new MenuAppService(prisma as never)
  })

  it('retorna [] e nem consulta itens quando o usuário não tem permissões', async () => {
    prisma.permissaoAcesso.findMany.mockResolvedValue([])
    expect(await service.arvorePermitida('u1')).toEqual([])
    expect(prisma.itemFuncionalidade.findMany).not.toHaveBeenCalled()
  })

  it('monta árvore de 2 níveis (pai SUBMENU + filhos na ordem da query)', async () => {
    prisma.permissaoAcesso.findMany.mockResolvedValue([{ itemId: 'orc' }, { itemId: 'saldo' }, { itemId: 'cred' }])
    prisma.itemFuncionalidade.findMany.mockResolvedValue([
      item({ id: 'orc', nome: 'Orçamento', rota: '/app/orcamento', tipo: 'SUBMENU' }),
      item({ id: 'saldo', nome: 'Saldos', rota: '/app/orcamento/saldo', parentId: 'orc' }),
      item({ id: 'cred', nome: 'Créditos', rota: '/app/orcamento/creditos', parentId: 'orc' }),
    ])
    const arvore = await service.arvorePermitida('u1')
    expect(arvore).toHaveLength(1)
    expect(arvore[0]).toMatchObject({ id: 'orc', tipo: 'SUBMENU' })
    expect(arvore[0]!.filhos.map((f) => f.id)).toEqual(['saldo', 'cred'])
  })

  it('exclui item sem permissão', async () => {
    prisma.permissaoAcesso.findMany.mockResolvedValue([{ itemId: 'a' }])
    prisma.itemFuncionalidade.findMany.mockResolvedValue([item({ id: 'a' }), item({ id: 'b' })])
    expect((await service.arvorePermitida('u1')).map((n) => n.id)).toEqual(['a'])
  })

  it('filho permitido mas pai não-visível → filho some (sem âncora)', async () => {
    prisma.permissaoAcesso.findMany.mockResolvedValue([{ itemId: 'filho' }])
    prisma.itemFuncionalidade.findMany.mockResolvedValue([
      item({ id: 'pai', tipo: 'SUBMENU' }), // não permitido
      item({ id: 'filho', parentId: 'pai' }), // permitido, mas órfão
    ])
    expect(await service.arvorePermitida('u1')).toEqual([])
  })

  it('filtra por sistema do /app + ativo e ordena por ordem,nome', async () => {
    prisma.permissaoAcesso.findMany.mockResolvedValue([{ itemId: 'a' }])
    prisma.itemFuncionalidade.findMany.mockResolvedValue([item({ id: 'a' })])
    await service.arvorePermitida('u1')
    const args = prisma.itemFuncionalidade.findMany.mock.calls[0]![0]
    expect(args.orderBy).toEqual([{ ordem: 'asc' }, { nome: 'asc' }])
    expect(args.where).toMatchObject({ ativo: true })
    expect(args.where.menu.modulo.sistema).toMatchObject({ ativo: true })
  })
})
