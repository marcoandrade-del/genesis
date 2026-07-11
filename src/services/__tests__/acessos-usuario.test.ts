import { describe, it, expect, beforeEach } from 'vitest'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'
import { AcessosUsuarioService } from '../acessos-usuario.js'

describe('AcessosUsuarioService', () => {
  let prisma: PrismaMock
  let svc: AcessosUsuarioService

  beforeEach(() => {
    prisma = criarPrismaMock()
    svc = new AcessosUsuarioService(prisma as never)
  })

  it('e-mail desconhecido devolve null (→ 404 no endpoint)', async () => {
    prisma.usuario.findUnique.mockResolvedValue(null)
    expect(await svc.municipiosPermitidos('fantasma@x.gov.br')).toBeNull()
    expect(prisma.usuario.findUnique.mock.calls[0]![0].where).toEqual({ emailPrincipal: 'fantasma@x.gov.br' })
  })

  it('mapeia só os acessos de PREFEITURA, com o nível (câmara é filtrada)', async () => {
    prisma.usuario.findUnique.mockResolvedValue({ id: 'u1' })
    prisma.acessoEntidade.findMany.mockResolvedValue([
      { nivel: 'ADMIN', entidade: { tipo: 'PREFEITURA', municipio: { id: 'mun-1', nome: 'Maringá', estado: { sigla: 'PR' } } } },
      { nivel: 'LEITURA', entidade: { tipo: 'CAMARA', municipio: { id: 'mun-1', nome: 'Maringá', estado: { sigla: 'PR' } } } },
      { nivel: 'ESCRITA', entidade: { tipo: 'PREFEITURA', municipio: { id: 'mun-2', nome: 'Londrina', estado: { sigla: 'PR' } } } },
    ])

    const r = await svc.municipiosPermitidos('gestor@x.gov.br')

    expect(r).toEqual({
      email: 'gestor@x.gov.br',
      municipios: [
        { id: 'mun-1', nome: 'Maringá', estado: 'PR', nivel: 'ADMIN' },
        { id: 'mun-2', nome: 'Londrina', estado: 'PR', nivel: 'ESCRITA' },
      ],
    })
  })
})
