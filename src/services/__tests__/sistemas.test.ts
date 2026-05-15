import { describe, it, expect, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'
import { SistemasService } from '../sistemas.js'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'

const USUARIO_ATIVO = { id: 'u1', ativo: true }
const USUARIO_INATIVO = { id: 'u2', ativo: false }
const SISTEMA_CRIADO = { id: 's1', nome: 'Financeiro', descricao: null, ativo: true, criadoEm: new Date(), atualizadoEm: new Date() }

const erroP2002 = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
  code: 'P2002',
  clientVersion: '7.0.0',
})

describe('SistemasService.criar', () => {
  let prisma: PrismaMock
  let service: SistemasService

  beforeEach(() => {
    prisma = criarPrismaMock()
    service = new SistemasService(prisma as never)
  })

  it('cria sistema e admin inicial em transação atômica', async () => {
    prisma.usuario.findUnique.mockResolvedValue(USUARIO_ATIVO)
    prisma.sistema.create.mockResolvedValue(SISTEMA_CRIADO)
    prisma.adminSistema.create.mockResolvedValue({})

    const resultado = await service.criar({ nome: 'Financeiro', adminUsuarioId: 'u1' })

    expect(prisma.$transaction).toHaveBeenCalledOnce()
    expect(prisma.sistema.create).toHaveBeenCalledWith({ data: { nome: 'Financeiro' } })
    expect(prisma.adminSistema.create).toHaveBeenCalledWith({
      data: { sistemaId: SISTEMA_CRIADO.id, usuarioId: 'u1' },
    })
    expect(resultado).toEqual(SISTEMA_CRIADO)
  })

  it('lança RECURSO_NAO_ENCONTRADO quando usuário não existe', async () => {
    prisma.usuario.findUnique.mockResolvedValue(null)

    await expect(service.criar({ nome: 'Financeiro', adminUsuarioId: 'u-inexistente' }))
      .rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })

    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('lança CONFLITO quando usuário está inativo', async () => {
    prisma.usuario.findUnique.mockResolvedValue(USUARIO_INATIVO)

    await expect(service.criar({ nome: 'Financeiro', adminUsuarioId: 'u2' }))
      .rejects.toMatchObject({ code: 'CONFLITO' })

    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('lança CONFLITO quando nome do sistema já existe (P2002)', async () => {
    prisma.usuario.findUnique.mockResolvedValue(USUARIO_ATIVO)
    prisma.sistema.create.mockRejectedValue(erroP2002)

    await expect(service.criar({ nome: 'Financeiro', adminUsuarioId: 'u1' }))
      .rejects.toMatchObject({ code: 'CONFLITO' })
  })
})

describe('SistemasService.excluir', () => {
  let prisma: PrismaMock
  let service: SistemasService

  beforeEach(() => {
    prisma = criarPrismaMock()
    service = new SistemasService(prisma as never)
  })

  it('lança RECURSO_NAO_ENCONTRADO quando sistema não existe', async () => {
    prisma.sistema.findUnique.mockResolvedValue(null)

    await expect(service.excluir('s-inexistente', 'u1')).rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
  })

  it('lança NAO_AUTORIZADO quando usuário não é admin do sistema', async () => {
    prisma.sistema.findUnique.mockResolvedValue(SISTEMA_CRIADO)
    prisma.adminSistema.findUnique.mockResolvedValue(null)

    await expect(service.excluir('s1', 'u-outro')).rejects.toMatchObject({ code: 'NAO_AUTORIZADO' })
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('lança CONFLITO quando há relatórios fixos vinculados', async () => {
    prisma.sistema.findUnique.mockResolvedValue(SISTEMA_CRIADO)
    prisma.adminSistema.findUnique.mockResolvedValue({ ativo: true })
    prisma.relatorioFixo.count.mockResolvedValue(3)

    await expect(service.excluir('s1', 'u1')).rejects.toMatchObject({ code: 'CONFLITO' })
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('inicia transação para excluir em cascata quando não há relatórios', async () => {
    prisma.sistema.findUnique.mockResolvedValue(SISTEMA_CRIADO)
    prisma.adminSistema.findUnique.mockResolvedValue({ ativo: true })
    prisma.relatorioFixo.count.mockResolvedValue(0)

    await service.excluir('s1', 'u1')

    expect(prisma.$transaction).toHaveBeenCalledOnce()
  })
})
