import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Prisma } from '@prisma/client'
import { AuthService } from '../auth.js'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'

vi.mock('argon2', () => ({
  hash: vi.fn().mockResolvedValue('$argon2id$hash'),
  verify: vi.fn().mockResolvedValue(true),
}))

import { hash, verify } from 'argon2'

const DADOS_BASE = {
  nomeCompleto: 'João Silva',
  nomeSocial: 'João',
  dataNascimento: '1990-01-15',
  emailPrincipal: 'joao@exemplo.com',
  telefonePrincipal: '44999990000',
  senha: 'senha123',
}

// Simula o que o Prisma retorna com select: camposPublicos (sem senhaHash)
const USUARIO_DB = {
  id: 'u1',
  nomeCompleto: 'João Silva',
  nomeSocial: 'João',
  dataNascimento: new Date('1990-01-15'),
  emailPrincipal: 'joao@exemplo.com',
  emailAlternativo: null,
  telefonePrincipal: '44999990000',
  telefoneAlternativo: null,
  emailValidado: false,
  celularValidado: false,
  ativo: false,
  criadoEm: new Date(),
  atualizadoEm: new Date(),
  cpf: '52998224725',
  idEstrangeiro: null,
}

// Para o teste de login, o Prisma retorna o hash (select diferente em login)
const USUARIO_LOGIN_DB = {
  id: 'u1',
  emailPrincipal: 'joao@exemplo.com',
  senhaHash: '$argon2id$hash',
  ativo: true,
}

const erroP2002 = (target: string[]) =>
  Object.assign(
    new Prisma.PrismaClientKnownRequestError('Unique constraint', {
      code: 'P2002',
      clientVersion: '7.0.0',
      meta: { target },
    })
  )

describe('AuthService.registrar', () => {
  let prisma: PrismaMock
  let service: AuthService

  beforeEach(() => {
    prisma = criarPrismaMock()
    service = new AuthService(prisma as never)
    vi.mocked(hash).mockResolvedValue('$argon2id$hash' as never)
  })

  it('lança REQUISICAO_INVALIDA quando nem CPF nem ID estrangeiro são informados', async () => {
    await expect(service.registrar({ ...DADOS_BASE }))
      .rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
  })

  it('lança REQUISICAO_INVALIDA quando CPF e ID estrangeiro são informados juntos', async () => {
    await expect(service.registrar({ ...DADOS_BASE, cpf: '529.982.247-25', idEstrangeiro: 'PASS123' }))
      .rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
  })

  it('lança REQUISICAO_INVALIDA para CPF inválido', async () => {
    await expect(service.registrar({ ...DADOS_BASE, cpf: '000.000.000-00' }))
      .rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
  })

  it('lança REQUISICAO_INVALIDA para senha com menos de 8 caracteres', async () => {
    await expect(service.registrar({ ...DADOS_BASE, idEstrangeiro: 'PASS123', senha: '1234567' }))
      .rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
  })

  it('cria usuário com hash da senha e retorna sem senhaHash', async () => {
    prisma.usuario.create.mockResolvedValue(USUARIO_DB)

    const resultado = await service.registrar({ ...DADOS_BASE, cpf: '529.982.247-25' })

    expect(hash).toHaveBeenCalledWith('senha123')
    expect(prisma.usuario.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ senhaHash: '$argon2id$hash' }) })
    )
    // senhaHash não está no resultado (select: camposPublicos)
    expect(resultado).not.toHaveProperty('senhaHash')
  })

  it('lança CONFLITO para CPF duplicado (P2002 target: cpf)', async () => {
    prisma.usuario.create.mockRejectedValue(erroP2002(['cpf']))

    await expect(service.registrar({ ...DADOS_BASE, cpf: '529.982.247-25' }))
      .rejects.toMatchObject({ code: 'CONFLITO' })
  })

  it('lança CONFLITO para e-mail duplicado (P2002 target: email)', async () => {
    prisma.usuario.create.mockRejectedValue(erroP2002(['emailPrincipal']))

    await expect(service.registrar({ ...DADOS_BASE, cpf: '529.982.247-25' }))
      .rejects.toMatchObject({ code: 'CONFLITO' })
  })
})

describe('AuthService.login', () => {
  let prisma: PrismaMock
  let service: AuthService

  beforeEach(() => {
    prisma = criarPrismaMock()
    service = new AuthService(prisma as never)
    vi.mocked(verify).mockResolvedValue(true as never)
  })

  it('lança REQUISICAO_INVALIDA quando usuário não existe (sem revelar qual campo falhou)', async () => {
    prisma.usuario.findUnique.mockResolvedValue(null)

    await expect(service.login('nao@existe.com', 'qualquer'))
      .rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
  })

  it('lança REQUISICAO_INVALIDA quando senha está errada', async () => {
    prisma.usuario.findUnique.mockResolvedValue(USUARIO_LOGIN_DB)
    vi.mocked(verify).mockResolvedValue(false as never)

    await expect(service.login('joao@exemplo.com', 'errada'))
      .rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
  })

  it('lança CONFLITO quando conta não está ativada', async () => {
    prisma.usuario.findUnique.mockResolvedValue({ ...USUARIO_LOGIN_DB, ativo: false })

    await expect(service.login('joao@exemplo.com', 'senha123'))
      .rejects.toMatchObject({ code: 'CONFLITO' })
  })

  it('retorna payload JWT (sub + email) no login bem-sucedido', async () => {
    prisma.usuario.findUnique.mockResolvedValue(USUARIO_LOGIN_DB)

    const resultado = await service.login('joao@exemplo.com', 'senha123')

    expect(resultado).toEqual({ sub: 'u1', email: 'joao@exemplo.com' })
  })
})
