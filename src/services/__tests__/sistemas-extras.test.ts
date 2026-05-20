import { describe, it, expect, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'
import { SistemasService } from '../sistemas.js'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'

const SISTEMA = { id: 's1', nome: 'Sis', descricao: null, ativo: true, criadoEm: new Date(), atualizadoEm: new Date() }
const erro = (code: string) => new Prisma.PrismaClientKnownRequestError('x', { code, clientVersion: '7.0.0' })

describe('SistemasService — leituras', () => {
  let prisma: PrismaMock
  let service: SistemasService

  beforeEach(() => {
    prisma = criarPrismaMock()
    service = new SistemasService(prisma as never)
  })

  it('listar ordena por nome asc', async () => {
    prisma.sistema.findMany.mockResolvedValue([SISTEMA])
    const r = await service.listar()
    expect(prisma.sistema.findMany).toHaveBeenCalledWith({ orderBy: { nome: 'asc' } })
    expect(r).toEqual([SISTEMA])
  })

  it('buscarPorId delega ao prisma', async () => {
    prisma.sistema.findUnique.mockResolvedValue(SISTEMA)
    const r = await service.buscarPorId('s1')
    expect(prisma.sistema.findUnique).toHaveBeenCalledWith({ where: { id: 's1' } })
    expect(r).toEqual(SISTEMA)
  })

  it('buscarComAdmins inclui usuário em cada admin', async () => {
    prisma.sistema.findUnique.mockResolvedValue({ ...SISTEMA, admins: [] })
    await service.buscarComAdmins('s1')
    expect(prisma.sistema.findUnique).toHaveBeenCalledWith({
      where: { id: 's1' },
      include: {
        admins: { include: { usuario: { select: { id: true, nomeCompleto: true } } } },
      },
    })
  })
})

describe('SistemasService.atualizar — erros Prisma', () => {
  let prisma: PrismaMock
  let service: SistemasService

  beforeEach(() => {
    prisma = criarPrismaMock()
    service = new SistemasService(prisma as never)
  })

  it('atualiza sistema com sucesso', async () => {
    prisma.sistema.update.mockResolvedValue({ ...SISTEMA, nome: 'Novo' })
    const r = await service.atualizar('s1', { nome: 'Novo' })
    expect(prisma.sistema.update).toHaveBeenCalledWith({ where: { id: 's1' }, data: { nome: 'Novo' } })
    expect(r.nome).toBe('Novo')
  })

  it('mapeia P2002 para CONFLITO', async () => {
    prisma.sistema.update.mockRejectedValue(erro('P2002'))
    await expect(service.atualizar('s1', { nome: 'X' })).rejects.toMatchObject({ code: 'CONFLITO' })
  })

  it('mapeia P2025 para RECURSO_NAO_ENCONTRADO', async () => {
    prisma.sistema.update.mockRejectedValue(erro('P2025'))
    await expect(service.atualizar('s1', { nome: 'X' })).rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
  })

  it('propaga erros Prisma desconhecidos', async () => {
    prisma.sistema.update.mockRejectedValue(erro('P9999'))
    await expect(service.atualizar('s1', { nome: 'X' })).rejects.toThrow()
  })

  it('propaga erros não-Prisma', async () => {
    prisma.sistema.update.mockRejectedValue(new Error('boom'))
    await expect(service.atualizar('s1', { nome: 'X' })).rejects.toThrow('boom')
  })
})

describe('SistemasService.trocarAdmin', () => {
  let prisma: PrismaMock
  let service: SistemasService

  beforeEach(() => {
    prisma = criarPrismaMock()
    service = new SistemasService(prisma as never)
  })

  it('lança RECURSO_NAO_ENCONTRADO quando novo admin não existe', async () => {
    prisma.usuario.findUnique.mockResolvedValue(null)
    await expect(service.trocarAdmin('s1', 'u-x')).rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('lança CONFLITO quando usuário está inativo', async () => {
    prisma.usuario.findUnique.mockResolvedValue({ id: 'u2', ativo: false })
    await expect(service.trocarAdmin('s1', 'u2')).rejects.toMatchObject({ code: 'CONFLITO' })
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('faz upsert do novo admin e remove os demais', async () => {
    prisma.usuario.findUnique.mockResolvedValue({ id: 'u2', ativo: true })
    prisma.adminSistema.upsert.mockResolvedValue({} as never)
    prisma.adminSistema.deleteMany.mockResolvedValue({ count: 1 })

    await service.trocarAdmin('s1', 'u2')

    expect(prisma.adminSistema.upsert).toHaveBeenCalledWith({
      where: { usuarioId_sistemaId: { usuarioId: 'u2', sistemaId: 's1' } },
      create: { usuarioId: 'u2', sistemaId: 's1' },
      update: {},
    })
    expect(prisma.adminSistema.deleteMany).toHaveBeenCalledWith({
      where: { sistemaId: 's1', usuarioId: { not: 'u2' } },
    })
  })
})

describe('SistemasService.excluir — cascata na transação', () => {
  let prisma: PrismaMock
  let service: SistemasService

  beforeEach(() => {
    prisma = criarPrismaMock()
    service = new SistemasService(prisma as never)
    prisma.sistema.findUnique.mockResolvedValue(SISTEMA)
    prisma.adminSistema.findUnique.mockResolvedValue({ ativo: true })
    prisma.relatorioFixo.count.mockResolvedValue(0)
  })

  it('chama lixeiraService.salvarSistema quando informado', async () => {
    const salvarSistema = (await import('vitest')).vi.fn().mockResolvedValue(undefined)
    const lixeira = { salvarSistema } as unknown as import('../lixeira.js').LixeiraService

    prisma.modulo.findMany.mockResolvedValue([])
    prisma.menu.findMany.mockResolvedValue([])
    prisma.itemFuncionalidade.findMany.mockResolvedValue([])

    await service.excluir('s1', 'u1', lixeira)

    expect(salvarSistema).toHaveBeenCalledWith('s1', 'u1', expect.anything())
  })

  it('exclui em cascata: itens, menus, módulos, vínculos e sistema', async () => {
    prisma.modulo.findMany.mockResolvedValue([{ id: 'mo1' }, { id: 'mo2' }])
    prisma.menu.findMany.mockResolvedValue([{ id: 'me1' }, { id: 'me2' }])
    prisma.itemFuncionalidade.findMany
      .mockResolvedValueOnce([{ id: 'it_raiz' }, { id: 'it_dep1' }, { id: 'it_dep2' }])  // todos os itens
      .mockResolvedValueOnce([                                                              // somente com parentId
        { id: 'it_dep1', parentId: 'it_raiz' },
        { id: 'it_dep2', parentId: 'it_dep1' },
      ])

    await service.excluir('s1', 'u1')

    expect(prisma.permissaoAcesso.deleteMany).toHaveBeenCalledWith({
      where: { itemId: { in: ['it_raiz', 'it_dep1', 'it_dep2'] } },
    })
    // depth2 (pais de outros itens): it_dep1 é pai de it_dep2
    expect(prisma.itemFuncionalidade.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['it_dep1'] } },
    })
    // depth1 (filhos): it_dep2
    expect(prisma.itemFuncionalidade.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['it_dep2'] } },
    })
    // depth0 (sem parent): it_raiz
    expect(prisma.itemFuncionalidade.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['it_raiz'] } },
    })
    expect(prisma.menu.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['me1', 'me2'] } } })
    expect(prisma.adminModulo.deleteMany).toHaveBeenCalledWith({ where: { moduloId: { in: ['mo1', 'mo2'] } } })
    expect(prisma.modulo.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['mo1', 'mo2'] } } })
    expect(prisma.adminSistema.deleteMany).toHaveBeenCalledWith({ where: { sistemaId: 's1' } })
    expect(prisma.sistema.delete).toHaveBeenCalledWith({ where: { id: 's1' } })
  })

  it('pula deletemany para coleções vazias (sem módulos/menus/itens)', async () => {
    prisma.modulo.findMany.mockResolvedValue([])
    prisma.menu.findMany.mockResolvedValue([])
    prisma.itemFuncionalidade.findMany.mockResolvedValue([])

    await service.excluir('s1', 'u1')

    expect(prisma.menu.deleteMany).not.toHaveBeenCalled()
    expect(prisma.modulo.deleteMany).not.toHaveBeenCalled()
    expect(prisma.adminModulo.deleteMany).not.toHaveBeenCalled()
    expect(prisma.itemFuncionalidade.deleteMany).not.toHaveBeenCalled()
    expect(prisma.sistema.delete).toHaveBeenCalledWith({ where: { id: 's1' } })
  })
})
