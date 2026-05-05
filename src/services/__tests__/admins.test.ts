import { describe, it, expect, beforeEach } from 'vitest'
import { AdminsService } from '../admins.js'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'

const ADMIN_ATIVO = { id: 'a1', usuarioId: 'u1', sistemaId: 's1', ativo: true, criadoEm: new Date() }
const ADMIN_INATIVO = { id: 'a2', usuarioId: 'u2', sistemaId: 's1', ativo: false, criadoEm: new Date() }

describe('AdminsService.removerAdminSistema', () => {
  let prisma: PrismaMock
  let service: AdminsService

  beforeEach(() => {
    prisma = criarPrismaMock()
    service = new AdminsService(prisma as never)
  })

  it('lança RECURSO_NAO_ENCONTRADO quando vínculo não existe', async () => {
    prisma.adminSistema.findUnique.mockResolvedValue(null)

    await expect(service.removerAdminSistema('s1', 'u-inexistente'))
      .rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })

    expect(prisma.adminSistema.delete).not.toHaveBeenCalled()
  })

  it('lança CONFLITO ao remover o único administrador ativo', async () => {
    prisma.adminSistema.findUnique.mockResolvedValue(ADMIN_ATIVO)
    prisma.adminSistema.count.mockResolvedValue(1) // apenas 1 ativo

    await expect(service.removerAdminSistema('s1', 'u1'))
      .rejects.toMatchObject({ code: 'CONFLITO' })

    expect(prisma.adminSistema.delete).not.toHaveBeenCalled()
  })

  it('permite remover quando há outros administradores ativos', async () => {
    prisma.adminSistema.findUnique.mockResolvedValue(ADMIN_ATIVO)
    prisma.adminSistema.count.mockResolvedValue(2) // 2 ativos
    prisma.adminSistema.delete.mockResolvedValue(ADMIN_ATIVO)

    await expect(service.removerAdminSistema('s1', 'u1')).resolves.not.toThrow()
    expect(prisma.adminSistema.delete).toHaveBeenCalledOnce()
  })

  it('permite remover admin inativo mesmo sendo o único (não viola a trava)', async () => {
    prisma.adminSistema.findUnique.mockResolvedValue(ADMIN_INATIVO)
    // count de ativos = 0, mas o admin a remover também está inativo — a trava só protege ativos
    prisma.adminSistema.count.mockResolvedValue(0)
    prisma.adminSistema.delete.mockResolvedValue(ADMIN_INATIVO)

    await expect(service.removerAdminSistema('s1', 'u2')).resolves.not.toThrow()
    expect(prisma.adminSistema.delete).toHaveBeenCalledOnce()
  })
})
