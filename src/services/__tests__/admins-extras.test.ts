import { describe, it, expect, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'
import { AdminsService } from '../admins.js'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'

const erro = (code: string) => new Prisma.PrismaClientKnownRequestError('x', { code, clientVersion: '7.0.0' })
const USUARIO_ATIVO = { id: 'u1', ativo: true }
const USUARIO_INATIVO = { id: 'u2', ativo: false }

describe('AdminsService — AdminSistema (listar/adicionar)', () => {
  let prisma: PrismaMock
  let service: AdminsService

  beforeEach(() => {
    prisma = criarPrismaMock()
    service = new AdminsService(prisma as never)
  })

  describe('listarAdminsSistema', () => {
    it('lança RECURSO_NAO_ENCONTRADO quando sistema não existe', async () => {
      prisma.sistema.findUnique.mockResolvedValue(null)
      await expect(service.listarAdminsSistema('s-x'))
        .rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
      expect(prisma.adminSistema.findMany).not.toHaveBeenCalled()
    })

    it('lista admins ordenados por criadoEm asc', async () => {
      prisma.sistema.findUnique.mockResolvedValue({ id: 's1' })
      prisma.adminSistema.findMany.mockResolvedValue([])
      await service.listarAdminsSistema('s1')
      expect(prisma.adminSistema.findMany).toHaveBeenCalledWith({
        where: { sistemaId: 's1' },
        include: { usuario: { select: { id: true, nomeCompleto: true, emailPrincipal: true, ativo: true } } },
        orderBy: { criadoEm: 'asc' },
      })
    })
  })

  describe('adicionarAdminSistema', () => {
    it('lança RECURSO_NAO_ENCONTRADO quando sistema não existe', async () => {
      prisma.sistema.findUnique.mockResolvedValue(null)
      prisma.usuario.findUnique.mockResolvedValue(USUARIO_ATIVO)
      await expect(service.adicionarAdminSistema('s-x', 'u1'))
        .rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
    })

    it('lança RECURSO_NAO_ENCONTRADO quando usuário não existe', async () => {
      prisma.sistema.findUnique.mockResolvedValue({ id: 's1' })
      prisma.usuario.findUnique.mockResolvedValue(null)
      await expect(service.adicionarAdminSistema('s1', 'u-x'))
        .rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
    })

    it('lança CONFLITO quando usuário está inativo', async () => {
      prisma.sistema.findUnique.mockResolvedValue({ id: 's1' })
      prisma.usuario.findUnique.mockResolvedValue(USUARIO_INATIVO)
      await expect(service.adicionarAdminSistema('s1', 'u2'))
        .rejects.toMatchObject({ code: 'CONFLITO' })
    })

    it('cria vínculo quando dados são válidos', async () => {
      prisma.sistema.findUnique.mockResolvedValue({ id: 's1' })
      prisma.usuario.findUnique.mockResolvedValue(USUARIO_ATIVO)
      prisma.adminSistema.create.mockResolvedValue({} as never)
      await service.adicionarAdminSistema('s1', 'u1')
      expect(prisma.adminSistema.create).toHaveBeenCalledWith({ data: { sistemaId: 's1', usuarioId: 'u1' } })
    })

    it('mapeia P2002 para CONFLITO (já é admin)', async () => {
      prisma.sistema.findUnique.mockResolvedValue({ id: 's1' })
      prisma.usuario.findUnique.mockResolvedValue(USUARIO_ATIVO)
      prisma.adminSistema.create.mockRejectedValue(erro('P2002'))
      await expect(service.adicionarAdminSistema('s1', 'u1'))
        .rejects.toMatchObject({ code: 'CONFLITO' })
    })

    it('propaga erros Prisma desconhecidos', async () => {
      prisma.sistema.findUnique.mockResolvedValue({ id: 's1' })
      prisma.usuario.findUnique.mockResolvedValue(USUARIO_ATIVO)
      prisma.adminSistema.create.mockRejectedValue(erro('P9999'))
      await expect(service.adicionarAdminSistema('s1', 'u1')).rejects.toThrow()
    })
  })
})

describe('AdminsService — AdminModulo', () => {
  let prisma: PrismaMock
  let service: AdminsService

  beforeEach(() => {
    prisma = criarPrismaMock()
    service = new AdminsService(prisma as never)
  })

  describe('listarAdminsModulo', () => {
    it('lança RECURSO_NAO_ENCONTRADO quando módulo não existe', async () => {
      prisma.modulo.findUnique.mockResolvedValue(null)
      await expect(service.listarAdminsModulo('mo-x'))
        .rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
    })

    it('lista admins do módulo', async () => {
      prisma.modulo.findUnique.mockResolvedValue({ id: 'mo1' })
      prisma.adminModulo.findMany.mockResolvedValue([])
      await service.listarAdminsModulo('mo1')
      expect(prisma.adminModulo.findMany).toHaveBeenCalledWith({
        where: { moduloId: 'mo1' },
        include: { usuario: { select: { id: true, nomeCompleto: true, emailPrincipal: true, ativo: true } } },
        orderBy: { criadoEm: 'asc' },
      })
    })
  })

  describe('adicionarAdminModulo', () => {
    it('lança RECURSO_NAO_ENCONTRADO quando módulo não existe', async () => {
      prisma.modulo.findUnique.mockResolvedValue(null)
      prisma.usuario.findUnique.mockResolvedValue(USUARIO_ATIVO)
      await expect(service.adicionarAdminModulo('mo-x', 'u1'))
        .rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
    })

    it('lança RECURSO_NAO_ENCONTRADO quando usuário não existe', async () => {
      prisma.modulo.findUnique.mockResolvedValue({ id: 'mo1' })
      prisma.usuario.findUnique.mockResolvedValue(null)
      await expect(service.adicionarAdminModulo('mo1', 'u-x'))
        .rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
    })

    it('lança CONFLITO quando usuário está inativo', async () => {
      prisma.modulo.findUnique.mockResolvedValue({ id: 'mo1' })
      prisma.usuario.findUnique.mockResolvedValue(USUARIO_INATIVO)
      await expect(service.adicionarAdminModulo('mo1', 'u2'))
        .rejects.toMatchObject({ code: 'CONFLITO' })
    })

    it('cria vínculo quando dados são válidos', async () => {
      prisma.modulo.findUnique.mockResolvedValue({ id: 'mo1' })
      prisma.usuario.findUnique.mockResolvedValue(USUARIO_ATIVO)
      prisma.adminModulo.create.mockResolvedValue({} as never)
      await service.adicionarAdminModulo('mo1', 'u1')
      expect(prisma.adminModulo.create).toHaveBeenCalledWith({ data: { moduloId: 'mo1', usuarioId: 'u1' } })
    })

    it('mapeia P2002 para CONFLITO', async () => {
      prisma.modulo.findUnique.mockResolvedValue({ id: 'mo1' })
      prisma.usuario.findUnique.mockResolvedValue(USUARIO_ATIVO)
      prisma.adminModulo.create.mockRejectedValue(erro('P2002'))
      await expect(service.adicionarAdminModulo('mo1', 'u1'))
        .rejects.toMatchObject({ code: 'CONFLITO' })
    })

    it('propaga erros Prisma desconhecidos', async () => {
      prisma.modulo.findUnique.mockResolvedValue({ id: 'mo1' })
      prisma.usuario.findUnique.mockResolvedValue(USUARIO_ATIVO)
      prisma.adminModulo.create.mockRejectedValue(erro('P9999'))
      await expect(service.adicionarAdminModulo('mo1', 'u1')).rejects.toThrow()
    })
  })

  describe('removerAdminModulo', () => {
    const ADMIN_ATIVO = { id: 'a1', usuarioId: 'u1', moduloId: 'mo1', ativo: true }
    const ADMIN_INATIVO = { id: 'a2', usuarioId: 'u2', moduloId: 'mo1', ativo: false }

    it('lança RECURSO_NAO_ENCONTRADO quando vínculo não existe', async () => {
      prisma.adminModulo.findUnique.mockResolvedValue(null)
      await expect(service.removerAdminModulo('mo1', 'u-x'))
        .rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
      expect(prisma.adminModulo.delete).not.toHaveBeenCalled()
    })

    it('lança CONFLITO ao remover o único admin ativo', async () => {
      prisma.adminModulo.findUnique.mockResolvedValue(ADMIN_ATIVO)
      prisma.adminModulo.count.mockResolvedValue(1)
      await expect(service.removerAdminModulo('mo1', 'u1'))
        .rejects.toMatchObject({ code: 'CONFLITO' })
      expect(prisma.adminModulo.delete).not.toHaveBeenCalled()
    })

    it('remove quando há outros admins ativos', async () => {
      prisma.adminModulo.findUnique.mockResolvedValue(ADMIN_ATIVO)
      prisma.adminModulo.count.mockResolvedValue(2)
      prisma.adminModulo.delete.mockResolvedValue(ADMIN_ATIVO as never)
      await service.removerAdminModulo('mo1', 'u1')
      expect(prisma.adminModulo.delete).toHaveBeenCalledOnce()
    })

    it('remove admin inativo mesmo sendo único ativo=0 (trava só vale para ativos)', async () => {
      prisma.adminModulo.findUnique.mockResolvedValue(ADMIN_INATIVO)
      prisma.adminModulo.count.mockResolvedValue(0)
      prisma.adminModulo.delete.mockResolvedValue(ADMIN_INATIVO as never)
      await service.removerAdminModulo('mo1', 'u2')
      expect(prisma.adminModulo.delete).toHaveBeenCalledOnce()
    })
  })
})
