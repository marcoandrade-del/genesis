import { describe, it, expect, beforeEach } from 'vitest'
import { PermissoesService } from '../permissoes.js'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'

const USUARIO = { id: 'u1', ativo: true }
const ITEM = { id: 'i1', ativo: true, nome: 'Cadastro', tipo: 'FUNCIONALIDADE' }
const PERMISSAO_DB = { id: 'p1', usuarioId: 'u1', itemId: 'i1', nivel: 'VISUALIZAR', criadoEm: new Date() }

describe('PermissoesService.listarPorUsuario', () => {
  let prisma: PrismaMock
  let service: PermissoesService

  beforeEach(() => {
    prisma = criarPrismaMock()
    service = new PermissoesService(prisma as never)
  })

  it('lança RECURSO_NAO_ENCONTRADO quando usuário não existe', async () => {
    prisma.usuario.findUnique.mockResolvedValue(null)

    await expect(service.listarPorUsuario('u-x'))
      .rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
    expect(prisma.permissaoAcesso.findMany).not.toHaveBeenCalled()
  })

  it('retorna lista de permissões quando usuário existe', async () => {
    prisma.usuario.findUnique.mockResolvedValue(USUARIO)
    prisma.permissaoAcesso.findMany.mockResolvedValue([PERMISSAO_DB])

    const resultado = await service.listarPorUsuario('u1')

    expect(prisma.permissaoAcesso.findMany).toHaveBeenCalledWith({
      where: { usuarioId: 'u1' },
      include: { item: { select: { id: true, nome: true, tipoFuncionalidade: true } } },
      orderBy: { criadoEm: 'asc' },
    })
    expect(resultado).toEqual([PERMISSAO_DB])
  })
})

describe('PermissoesService.listarPorItem', () => {
  let prisma: PrismaMock
  let service: PermissoesService

  beforeEach(() => {
    prisma = criarPrismaMock()
    service = new PermissoesService(prisma as never)
  })

  it('lança RECURSO_NAO_ENCONTRADO quando item não existe', async () => {
    prisma.itemFuncionalidade.findUnique.mockResolvedValue(null)

    await expect(service.listarPorItem('i-x'))
      .rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
    expect(prisma.permissaoAcesso.findMany).not.toHaveBeenCalled()
  })

  it('retorna lista de permissões quando item existe', async () => {
    prisma.itemFuncionalidade.findUnique.mockResolvedValue(ITEM)
    prisma.permissaoAcesso.findMany.mockResolvedValue([PERMISSAO_DB])

    const resultado = await service.listarPorItem('i1')

    expect(prisma.permissaoAcesso.findMany).toHaveBeenCalledWith({
      where: { itemId: 'i1' },
      include: { usuario: { select: { id: true, nomeCompleto: true, emailPrincipal: true } } },
      orderBy: { criadoEm: 'asc' },
    })
    expect(resultado).toEqual([PERMISSAO_DB])
  })
})

describe('PermissoesService — delegações simples', () => {
  let prisma: PrismaMock
  let service: PermissoesService

  beforeEach(() => {
    prisma = criarPrismaMock()
    service = new PermissoesService(prisma as never)
  })

  it('buscarPorId delega para prisma.permissaoAcesso.findUnique', () => {
    prisma.permissaoAcesso.findUnique.mockResolvedValue(PERMISSAO_DB)
    service.buscarPorId('p1')
    expect(prisma.permissaoAcesso.findUnique).toHaveBeenCalledWith({ where: { id: 'p1' } })
  })

  it('atualizar delega para prisma.permissaoAcesso.update', async () => {
    prisma.permissaoAcesso.update.mockResolvedValue({ ...PERMISSAO_DB, nivel: 'EDITAR' })
    const resultado = await service.atualizar('p1', 'EDITAR')
    expect(prisma.permissaoAcesso.update).toHaveBeenCalledWith({
      where: { id: 'p1' }, data: { nivel: 'EDITAR' },
    })
    expect(resultado.nivel).toBe('EDITAR')
  })

  it('revogar delega para prisma.permissaoAcesso.delete', async () => {
    prisma.permissaoAcesso.delete.mockResolvedValue(PERMISSAO_DB)
    const resultado = await service.revogar('p1')
    expect(prisma.permissaoAcesso.delete).toHaveBeenCalledWith({ where: { id: 'p1' } })
    expect(resultado).toEqual(PERMISSAO_DB)
  })
})

describe('PermissoesService.conceder — propagação de erros não-P2002', () => {
  it('propaga erro genérico do prisma sem mapear', async () => {
    const prisma = criarPrismaMock()
    const service = new PermissoesService(prisma as never)
    const erroGenerico = new Error('Falha de conexão')

    prisma.usuario.findUnique.mockResolvedValue(USUARIO)
    prisma.itemFuncionalidade.findUnique.mockResolvedValue(ITEM)
    prisma.permissaoAcesso.create.mockRejectedValue(erroGenerico)

    await expect(service.conceder('u1', { itemId: 'i1', nivel: 'VISUALIZAR' }))
      .rejects.toThrow('Falha de conexão')
  })
})
