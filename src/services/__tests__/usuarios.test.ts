import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Prisma } from '@prisma/client'
import { UsuariosService } from '../usuarios.js'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'

vi.mock('argon2', () => ({ hash: vi.fn(async (s: string) => `hashed:${s}`) }))

const USUARIO = { id: 'u1', nomeCompleto: 'Marco', ativo: true }
const erroP2025 = new Prisma.PrismaClientKnownRequestError('Record not found', {
  code: 'P2025',
  clientVersion: '7.0.0',
})

describe('UsuariosService.atualizar', () => {
  let prisma: PrismaMock
  let service: UsuariosService

  beforeEach(() => {
    prisma = criarPrismaMock()
    service = new UsuariosService(prisma as never)
  })

  it('rejeita nomeCompleto vazio', async () => {
    await expect(service.atualizar('u1', { nomeCompleto: '   ' }))
      .rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
    expect(prisma.usuario.update).not.toHaveBeenCalled()
  })

  it('rejeita senha com menos de 8 caracteres', async () => {
    await expect(service.atualizar('u1', { senha: '1234567' }))
      .rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
    expect(prisma.usuario.update).not.toHaveBeenCalled()
  })

  it('rejeita dataNascimento inválida', async () => {
    await expect(service.atualizar('u1', { dataNascimento: 'data-invalida' }))
      .rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
    expect(prisma.usuario.update).not.toHaveBeenCalled()
  })

  it('converte dataNascimento string para Date e atualiza', async () => {
    prisma.usuario.update.mockResolvedValue(USUARIO)

    await service.atualizar('u1', { dataNascimento: '1990-05-10' })

    const chamada = prisma.usuario.update.mock.calls[0]![0]
    expect(chamada.data.dataNascimento).toBeInstanceOf(Date)
    expect(chamada.where).toEqual({ id: 'u1' })
  })

  it('hasheia senha antes de persistir', async () => {
    prisma.usuario.update.mockResolvedValue(USUARIO)

    await service.atualizar('u1', { senha: 'senhaSegura1' })

    const chamada = prisma.usuario.update.mock.calls[0]![0]
    expect(chamada.data.senhaHash).toBe('hashed:senhaSegura1')
    expect(chamada.data.senha).toBeUndefined()
  })

  it('mapeia P2025 para RECURSO_NAO_ENCONTRADO', async () => {
    prisma.usuario.update.mockRejectedValue(erroP2025)

    await expect(service.atualizar('u-x', { nomeCompleto: 'Outro' }))
      .rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
  })
})

describe('UsuariosService.excluir', () => {
  let prisma: PrismaMock
  let service: UsuariosService

  beforeEach(() => {
    prisma = criarPrismaMock()
    service = new UsuariosService(prisma as never)
  })

  it('lança RECURSO_NAO_ENCONTRADO quando usuário não existe', async () => {
    prisma.usuario.findUnique.mockResolvedValue(null)

    await expect(service.excluir('u-x'))
      .rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
  })

  it('lança CONFLITO quando usuário é admin de sistema', async () => {
    prisma.usuario.findUnique.mockResolvedValue(USUARIO)
    prisma.adminSistema.count.mockResolvedValue(2)

    await expect(service.excluir('u1')).rejects.toMatchObject({ code: 'CONFLITO' })
    expect(prisma.usuario.delete).not.toHaveBeenCalled()
  })

  it('lança CONFLITO quando usuário é admin de módulo', async () => {
    prisma.usuario.findUnique.mockResolvedValue(USUARIO)
    prisma.adminModulo.count.mockResolvedValue(1)

    await expect(service.excluir('u1')).rejects.toMatchObject({ code: 'CONFLITO' })
  })

  it('lança CONFLITO quando usuário tem permissões vinculadas', async () => {
    prisma.usuario.findUnique.mockResolvedValue(USUARIO)
    prisma.permissaoAcesso.count.mockResolvedValue(3)

    await expect(service.excluir('u1')).rejects.toMatchObject({ code: 'CONFLITO' })
  })

  it('lança CONFLITO quando usuário tem relatórios personalizados', async () => {
    prisma.usuario.findUnique.mockResolvedValue(USUARIO)
    prisma.relatorioPersonalizado.count.mockResolvedValue(1)

    await expect(service.excluir('u1')).rejects.toMatchObject({ code: 'CONFLITO' })
  })

  it('exclui usuário cascateando favoritos e pastas vinculados', async () => {
    prisma.usuario.findUnique.mockResolvedValue(USUARIO)
    prisma.usuario.delete.mockResolvedValue(USUARIO)

    const resultado = await service.excluir('u1')

    expect(prisma.favoritoRelatorio.deleteMany).toHaveBeenCalledWith({ where: { usuarioId: 'u1' } })
    expect(prisma.favoritoItem.deleteMany).toHaveBeenCalledWith({ where: { usuarioId: 'u1' } })
    expect(prisma.pastaFavorito.deleteMany).toHaveBeenCalledWith({ where: { usuarioId: 'u1', parentId: { not: null } } })
    expect(prisma.pastaFavorito.deleteMany).toHaveBeenCalledWith({ where: { usuarioId: 'u1' } })
    expect(prisma.usuario.delete).toHaveBeenCalledWith({ where: { id: 'u1' } })
    expect(resultado).toEqual(USUARIO)
  })
})
