import { describe, it, expect, beforeEach } from 'vitest'
import { ModulosService } from '../modulos.js'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'

const USUARIO_ATIVO = { id: 'u1', ativo: true }
const SISTEMA_ATIVO = { id: 's1', ativo: true }
const SISTEMA_INATIVO = { id: 's2', ativo: false }
const MODULO_CRIADO = { id: 'm1', nome: 'Contabilidade', sistemaId: 's1', ativo: true, criadoEm: new Date(), atualizadoEm: new Date() }

describe('ModulosService.criar', () => {
  let prisma: PrismaMock
  let service: ModulosService

  beforeEach(() => {
    prisma = criarPrismaMock()
    service = new ModulosService(prisma as never)
  })

  it('cria módulo e admin inicial em transação atômica', async () => {
    prisma.sistema.findUnique.mockResolvedValue(SISTEMA_ATIVO)
    prisma.usuario.findUnique.mockResolvedValue(USUARIO_ATIVO)
    prisma.modulo.create.mockResolvedValue(MODULO_CRIADO)
    prisma.adminModulo.create.mockResolvedValue({})

    const resultado = await service.criar('s1', { nome: 'Contabilidade', adminUsuarioId: 'u1' })

    expect(prisma.$transaction).toHaveBeenCalledOnce()
    expect(prisma.modulo.create).toHaveBeenCalledWith({ data: { nome: 'Contabilidade', sistemaId: 's1' } })
    expect(prisma.adminModulo.create).toHaveBeenCalledWith({
      data: { moduloId: MODULO_CRIADO.id, usuarioId: 'u1' },
    })
    expect(resultado).toEqual(MODULO_CRIADO)
  })

  it('lança RECURSO_NAO_ENCONTRADO quando sistema não existe', async () => {
    prisma.sistema.findUnique.mockResolvedValue(null)

    await expect(service.criar('s-inexistente', { nome: 'X', adminUsuarioId: 'u1' }))
      .rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })

    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('lança CONFLITO quando sistema está inativo', async () => {
    prisma.sistema.findUnique.mockResolvedValue(SISTEMA_INATIVO)

    await expect(service.criar('s2', { nome: 'X', adminUsuarioId: 'u1' }))
      .rejects.toMatchObject({ code: 'CONFLITO' })

    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('lança RECURSO_NAO_ENCONTRADO quando usuário admin não existe', async () => {
    prisma.sistema.findUnique.mockResolvedValue(SISTEMA_ATIVO)
    prisma.usuario.findUnique.mockResolvedValue(null)

    await expect(service.criar('s1', { nome: 'X', adminUsuarioId: 'u-inexistente' }))
      .rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })

    expect(prisma.$transaction).not.toHaveBeenCalled()
  })
})

describe('ModulosService.excluir', () => {
  let prisma: PrismaMock
  let service: ModulosService

  beforeEach(() => {
    prisma = criarPrismaMock()
    service = new ModulosService(prisma as never)
  })

  it('lança RECURSO_NAO_ENCONTRADO quando módulo não existe', async () => {
    prisma.modulo.findUnique.mockResolvedValue(null)

    await expect(service.excluir('m-inexistente', 'u1')).rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
  })

  it('lança NAO_AUTORIZADO quando usuário não é admin nem do módulo nem do sistema pai', async () => {
    prisma.modulo.findUnique.mockResolvedValue(MODULO_CRIADO)
    prisma.adminModulo.findUnique.mockResolvedValue(null)
    prisma.adminSistema.findUnique.mockResolvedValue(null)

    await expect(service.excluir('m1', 'u-outro')).rejects.toMatchObject({ code: 'NAO_AUTORIZADO' })
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('inicia transação para excluir em cascata quando módulo existe e usuário é admin', async () => {
    prisma.modulo.findUnique.mockResolvedValue(MODULO_CRIADO)
    prisma.adminModulo.findUnique.mockResolvedValue({ ativo: true })

    await service.excluir('m1', 'u1')

    expect(prisma.$transaction).toHaveBeenCalledOnce()
  })
})
