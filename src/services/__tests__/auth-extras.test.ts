import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Prisma } from '@prisma/client'
import { AuthService } from '../auth.js'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'

vi.mock('argon2', () => ({
  hash: vi.fn().mockResolvedValue('$argon2id$hash'),
  verify: vi.fn().mockResolvedValue(true),
}))

const DADOS_BASE = {
  nomeCompleto: 'João Silva',
  nomeSocial: 'João',
  dataNascimento: '1990-01-15',
  emailPrincipal: 'joao@exemplo.com',
  telefonePrincipal: '44999990000',
  senha: 'senha123',
}

function erroP2002(target: string[] | undefined) {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint', {
    code: 'P2002',
    clientVersion: '7.0.0',
    meta: target ? { target } : undefined as never,
  })
}

describe('AuthService.registrar — branches restantes', () => {
  let prisma: PrismaMock
  let service: AuthService

  beforeEach(() => {
    prisma = criarPrismaMock()
    service = new AuthService(prisma as never)
  })

  // Line 78 — P2002 target contém substring 'estrangeiro'
  it('lança CONFLITO específico quando P2002 target contém "estrangeiro"', async () => {
    prisma.usuario.create.mockRejectedValue(erroP2002(['id_estrangeiro_key']))
    await expect(service.registrar({ ...DADOS_BASE, idEstrangeiro: 'PASS123' }))
      .rejects.toMatchObject({ code: 'CONFLITO', message: expect.stringContaining('ID estrangeiro') })
  })

  // Lines 79-80 — P2002 target genérico cai no fallback "Dado duplicado."
  it('lança CONFLITO genérico quando P2002 target não bate com cpf/email/estrangeiro', async () => {
    prisma.usuario.create.mockRejectedValue(erroP2002(['campo_qualquer']))
    await expect(service.registrar({ ...DADOS_BASE, cpf: '529.982.247-25' }))
      .rejects.toMatchObject({ code: 'CONFLITO', message: 'Dado duplicado.' })
  })

  // Line 76 — P2002 sem meta.target cai no `?? []`
  it('lança CONFLITO genérico quando P2002 não traz meta', async () => {
    prisma.usuario.create.mockRejectedValue(erroP2002(undefined as never))
    await expect(service.registrar({ ...DADOS_BASE, cpf: '529.982.247-25' }))
      .rejects.toMatchObject({ code: 'CONFLITO', message: 'Dado duplicado.' })
  })
})
