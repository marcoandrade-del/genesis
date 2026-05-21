import { describe, it, expect, beforeEach, vi } from 'vitest'
import { UsuariosService } from '../usuarios.js'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'

vi.mock('argon2', () => ({ hash: vi.fn(async (s: string) => `hashed:${s}`) }))

const REGISTRADO = {
  id: 'u1', nomeCompleto: 'Marco', nomeSocial: 'Marco',
  cpf: '52998224725', idEstrangeiro: null,
  dataNascimento: new Date('1990-01-15'),
  emailPrincipal: 'marco@x.com', emailAlternativo: null,
  telefonePrincipal: '44999990000', telefoneAlternativo: null,
  emailValidado: false, celularValidado: false, ativo: false,
  criadoEm: new Date(), atualizadoEm: new Date(),
}

describe('UsuariosService.criar — branches restantes', () => {
  let prisma: PrismaMock
  let service: UsuariosService

  beforeEach(() => {
    prisma = criarPrismaMock()
    service = new UsuariosService(prisma as never)
  })

  // Line 38 if i=1 + line 45 — criar sem ativo retorna direto sem update
  it('retorna o usuário registrado sem fazer update quando ativo não é informado', async () => {
    prisma.usuario.create.mockResolvedValue(REGISTRADO)

    const resultado = await service.criar({
      nomeCompleto: 'Marco', nomeSocial: 'Marco', cpf: '529.982.247-25',
      dataNascimento: '1990-01-15', emailPrincipal: 'marco@x.com',
      telefonePrincipal: '44999990000', senha: 'senha1234',
    })

    expect(prisma.usuario.update).not.toHaveBeenCalled()
    expect(resultado).toEqual(REGISTRADO)
  })
})
