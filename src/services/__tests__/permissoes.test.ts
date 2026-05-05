import { describe, it, expect, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'
import { PermissoesService } from '../permissoes.js'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'

const USUARIO_ATIVO = { id: 'u1', ativo: true }
const USUARIO_INATIVO = { id: 'u2', ativo: false }
const ITEM_ATIVO = { id: 'i1', ativo: true, nome: 'Cadastro', tipo: 'FUNCIONALIDADE' }
const ITEM_INATIVO = { id: 'i2', ativo: false, nome: 'Relatório', tipo: 'FUNCIONALIDADE' }
const PERMISSAO_DB = { id: 'p1', usuarioId: 'u1', itemId: 'i1', nivel: 'VISUALIZAR', criadoEm: new Date() }

const erroP2002 = new Prisma.PrismaClientKnownRequestError('Unique constraint', {
  code: 'P2002',
  clientVersion: '7.0.0',
})

describe('PermissoesService.conceder', () => {
  let prisma: PrismaMock
  let service: PermissoesService

  beforeEach(() => {
    prisma = criarPrismaMock()
    service = new PermissoesService(prisma as never)
  })

  it('lança RECURSO_NAO_ENCONTRADO quando usuário não existe', async () => {
    prisma.usuario.findUnique.mockResolvedValue(null)
    prisma.itemFuncionalidade.findUnique.mockResolvedValue(ITEM_ATIVO)

    await expect(service.conceder('u-inexistente', { itemId: 'i1', nivel: 'VISUALIZAR' }))
      .rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })

    expect(prisma.permissaoAcesso.create).not.toHaveBeenCalled()
  })

  it('lança CONFLITO quando usuário está inativo', async () => {
    prisma.usuario.findUnique.mockResolvedValue(USUARIO_INATIVO)
    prisma.itemFuncionalidade.findUnique.mockResolvedValue(ITEM_ATIVO)

    await expect(service.conceder('u2', { itemId: 'i1', nivel: 'VISUALIZAR' }))
      .rejects.toMatchObject({ code: 'CONFLITO' })

    expect(prisma.permissaoAcesso.create).not.toHaveBeenCalled()
  })

  it('lança RECURSO_NAO_ENCONTRADO quando item não existe', async () => {
    prisma.usuario.findUnique.mockResolvedValue(USUARIO_ATIVO)
    prisma.itemFuncionalidade.findUnique.mockResolvedValue(null)

    await expect(service.conceder('u1', { itemId: 'i-inexistente', nivel: 'VISUALIZAR' }))
      .rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })

    expect(prisma.permissaoAcesso.create).not.toHaveBeenCalled()
  })

  it('lança CONFLITO quando item está inativo', async () => {
    prisma.usuario.findUnique.mockResolvedValue(USUARIO_ATIVO)
    prisma.itemFuncionalidade.findUnique.mockResolvedValue(ITEM_INATIVO)

    await expect(service.conceder('u1', { itemId: 'i2', nivel: 'VISUALIZAR' }))
      .rejects.toMatchObject({ code: 'CONFLITO' })

    expect(prisma.permissaoAcesso.create).not.toHaveBeenCalled()
  })

  it('concede permissão quando usuário e item estão ativos', async () => {
    prisma.usuario.findUnique.mockResolvedValue(USUARIO_ATIVO)
    prisma.itemFuncionalidade.findUnique.mockResolvedValue(ITEM_ATIVO)
    prisma.permissaoAcesso.create.mockResolvedValue(PERMISSAO_DB)

    const resultado = await service.conceder('u1', { itemId: 'i1', nivel: 'VISUALIZAR' })

    expect(prisma.permissaoAcesso.create).toHaveBeenCalledWith({
      data: { usuarioId: 'u1', itemId: 'i1', nivel: 'VISUALIZAR' },
    })
    expect(resultado).toEqual(PERMISSAO_DB)
  })

  it('lança CONFLITO quando permissão duplicada (P2002)', async () => {
    prisma.usuario.findUnique.mockResolvedValue(USUARIO_ATIVO)
    prisma.itemFuncionalidade.findUnique.mockResolvedValue(ITEM_ATIVO)
    prisma.permissaoAcesso.create.mockRejectedValue(erroP2002)

    await expect(service.conceder('u1', { itemId: 'i1', nivel: 'VISUALIZAR' }))
      .rejects.toMatchObject({ code: 'CONFLITO' })
  })
})
