import { describe, it, expect, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'
import { AcessosEntidadeService } from '../acessos-entidade.js'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'

const USUARIO = { id: 'u1', nomeCompleto: 'Fulano', emailPrincipal: 'fulano@ex.com' }
const ENTIDADE = { id: 'ent1', nome: 'Prefeitura' }

let prisma: PrismaMock
let service: AcessosEntidadeService

beforeEach(() => {
  prisma = criarPrismaMock()
  service = new AcessosEntidadeService(prisma as never)
})

function dadosOk(over: Partial<Record<string, unknown>> = {}) {
  return { usuarioId: 'u1', entidadeId: 'ent1', nivel: 'LEITURA', ...over } as never
}

describe('AcessosEntidadeService.listarPorUsuario', () => {
  it('lista ativos com entidade aninhada', async () => {
    prisma.acessoEntidade.findMany.mockResolvedValue([])
    await service.listarPorUsuario('u1')
    expect(prisma.acessoEntidade.findMany).toHaveBeenCalledWith({
      where: { usuarioId: 'u1', ativo: true, entidade: { ativo: true } },
      include: {
        entidade: {
          include: { municipio: { include: { estado: { select: { sigla: true, nome: true } } } } },
        },
      },
      orderBy: [{ entidade: { municipio: { nome: 'asc' } } }, { entidade: { nome: 'asc' } }],
    })
  })
})

describe('AcessosEntidadeService.listarPorEntidade', () => {
  it('lista ativos com usuário', async () => {
    prisma.acessoEntidade.findMany.mockResolvedValue([])
    await service.listarPorEntidade('ent1')
    expect(prisma.acessoEntidade.findMany).toHaveBeenCalledWith({
      where: { entidadeId: 'ent1', ativo: true },
      include: { usuario: { select: { id: true, nomeCompleto: true, emailPrincipal: true } } },
      orderBy: { usuario: { nomeCompleto: 'asc' } },
    })
  })
})

describe('AcessosEntidadeService.buscarPorId', () => {
  it('busca pelo id', async () => {
    prisma.acessoEntidade.findUnique.mockResolvedValue(null)
    await service.buscarPorId('a1')
    expect(prisma.acessoEntidade.findUnique).toHaveBeenCalledWith({ where: { id: 'a1' } })
  })
})

describe('AcessosEntidadeService.usuarioPodeAcessar', () => {
  it('retorna false quando não existe acesso', async () => {
    prisma.acessoEntidade.findUnique.mockResolvedValue(null)
    expect(await service.usuarioPodeAcessar('u1', 'ent1')).toBe(false)
  })

  it('retorna false quando acesso está inativo', async () => {
    prisma.acessoEntidade.findUnique.mockResolvedValue({ nivel: 'ADMIN', ativo: false })
    expect(await service.usuarioPodeAcessar('u1', 'ent1', 'LEITURA')).toBe(false)
  })

  it('retorna false quando a entidade está inativa', async () => {
    prisma.acessoEntidade.findUnique.mockResolvedValue({
      nivel: 'ADMIN',
      ativo: true,
      entidade: { ativo: false },
    })
    expect(await service.usuarioPodeAcessar('u1', 'ent1', 'LEITURA')).toBe(false)
  })

  it('LEITURA cumpre LEITURA', async () => {
    prisma.acessoEntidade.findUnique.mockResolvedValue({ nivel: 'LEITURA', ativo: true, entidade: { ativo: true } })
    expect(await service.usuarioPodeAcessar('u1', 'ent1', 'LEITURA')).toBe(true)
  })

  it('LEITURA não cumpre ESCRITA', async () => {
    prisma.acessoEntidade.findUnique.mockResolvedValue({ nivel: 'LEITURA', ativo: true, entidade: { ativo: true } })
    expect(await service.usuarioPodeAcessar('u1', 'ent1', 'ESCRITA')).toBe(false)
  })

  it('ESCRITA cumpre LEITURA', async () => {
    prisma.acessoEntidade.findUnique.mockResolvedValue({ nivel: 'ESCRITA', ativo: true, entidade: { ativo: true } })
    expect(await service.usuarioPodeAcessar('u1', 'ent1', 'LEITURA')).toBe(true)
  })

  it('ESCRITA cumpre ESCRITA', async () => {
    prisma.acessoEntidade.findUnique.mockResolvedValue({ nivel: 'ESCRITA', ativo: true, entidade: { ativo: true } })
    expect(await service.usuarioPodeAcessar('u1', 'ent1', 'ESCRITA')).toBe(true)
  })

  it('ESCRITA não cumpre ADMIN', async () => {
    prisma.acessoEntidade.findUnique.mockResolvedValue({ nivel: 'ESCRITA', ativo: true, entidade: { ativo: true } })
    expect(await service.usuarioPodeAcessar('u1', 'ent1', 'ADMIN')).toBe(false)
  })

  it('ADMIN cumpre tudo', async () => {
    prisma.acessoEntidade.findUnique.mockResolvedValue({ nivel: 'ADMIN', ativo: true, entidade: { ativo: true } })
    expect(await service.usuarioPodeAcessar('u1', 'ent1', 'LEITURA')).toBe(true)
    prisma.acessoEntidade.findUnique.mockResolvedValue({ nivel: 'ADMIN', ativo: true, entidade: { ativo: true } })
    expect(await service.usuarioPodeAcessar('u1', 'ent1', 'ESCRITA')).toBe(true)
    prisma.acessoEntidade.findUnique.mockResolvedValue({ nivel: 'ADMIN', ativo: true, entidade: { ativo: true } })
    expect(await service.usuarioPodeAcessar('u1', 'ent1', 'ADMIN')).toBe(true)
  })

  it('default nivelMinimo = LEITURA', async () => {
    prisma.acessoEntidade.findUnique.mockResolvedValue({ nivel: 'LEITURA', ativo: true, entidade: { ativo: true } })
    expect(await service.usuarioPodeAcessar('u1', 'ent1')).toBe(true)
  })
})

describe('AcessosEntidadeService.conceder — validação', () => {
  it('rejeita usuarioId vazio', async () => {
    await expect(service.conceder(dadosOk({ usuarioId: '   ' }))).rejects.toMatchObject({
      code: 'REQUISICAO_INVALIDA',
    })
  })

  it('rejeita usuarioId undefined', async () => {
    await expect(service.conceder(dadosOk({ usuarioId: undefined }))).rejects.toMatchObject({
      code: 'REQUISICAO_INVALIDA',
    })
  })

  it('rejeita entidadeId vazio', async () => {
    await expect(service.conceder(dadosOk({ entidadeId: '   ' }))).rejects.toMatchObject({
      code: 'REQUISICAO_INVALIDA',
    })
  })

  it('rejeita entidadeId undefined', async () => {
    await expect(service.conceder(dadosOk({ entidadeId: undefined }))).rejects.toMatchObject({
      code: 'REQUISICAO_INVALIDA',
    })
  })

  it('rejeita nível inválido', async () => {
    await expect(service.conceder(dadosOk({ nivel: 'TOTAL' }))).rejects.toMatchObject({
      code: 'REQUISICAO_INVALIDA',
      message: expect.stringContaining('Nível inválido'),
    })
  })
})

describe('AcessosEntidadeService.conceder — fluxo', () => {
  it('404 quando usuário não existe', async () => {
    prisma.usuario.findUnique.mockResolvedValue(null)
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    await expect(service.conceder(dadosOk())).rejects.toMatchObject({
      code: 'RECURSO_NAO_ENCONTRADO',
      message: expect.stringContaining('Usuário'),
    })
  })

  it('404 quando entidade não existe', async () => {
    prisma.usuario.findUnique.mockResolvedValue(USUARIO)
    prisma.entidade.findUnique.mockResolvedValue(null)
    await expect(service.conceder(dadosOk())).rejects.toMatchObject({
      code: 'RECURSO_NAO_ENCONTRADO',
      message: expect.stringContaining('Entidade'),
    })
  })

  it('upsert no caminho feliz', async () => {
    prisma.usuario.findUnique.mockResolvedValue(USUARIO)
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    prisma.acessoEntidade.upsert.mockResolvedValue({ id: 'a1' })
    await service.conceder(dadosOk({ nivel: 'ESCRITA' }))
    expect(prisma.acessoEntidade.upsert).toHaveBeenCalledWith({
      where: { usuarioId_entidadeId: { usuarioId: 'u1', entidadeId: 'ent1' } },
      create: { usuarioId: 'u1', entidadeId: 'ent1', nivel: 'ESCRITA', ativo: true },
      update: { nivel: 'ESCRITA', ativo: true },
    })
  })

  it('respeita ativo=false', async () => {
    prisma.usuario.findUnique.mockResolvedValue(USUARIO)
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    prisma.acessoEntidade.upsert.mockResolvedValue({ id: 'a1' })
    await service.conceder(dadosOk({ ativo: false }))
    expect(prisma.acessoEntidade.upsert.mock.calls[0][0].create.ativo).toBe(false)
    expect(prisma.acessoEntidade.upsert.mock.calls[0][0].update.ativo).toBe(false)
  })
})

describe('AcessosEntidadeService.revogar', () => {
  it('404 quando não existe', async () => {
    prisma.acessoEntidade.findUnique.mockResolvedValue(null)
    await expect(service.revogar('xx')).rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
  })

  it('deleta no caminho feliz', async () => {
    prisma.acessoEntidade.findUnique.mockResolvedValue({ id: 'a1' })
    prisma.acessoEntidade.delete.mockResolvedValue({})
    await service.revogar('a1')
    expect(prisma.acessoEntidade.delete).toHaveBeenCalledWith({ where: { id: 'a1' } })
  })

  it('P2003 vira CONFLITO', async () => {
    prisma.acessoEntidade.findUnique.mockResolvedValue({ id: 'a1' })
    prisma.acessoEntidade.delete.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('fk', { code: 'P2003', clientVersion: '7.7.0' }),
    )
    await expect(service.revogar('a1')).rejects.toMatchObject({ code: 'CONFLITO' })
  })

  it('repassa outros erros', async () => {
    prisma.acessoEntidade.findUnique.mockResolvedValue({ id: 'a1' })
    prisma.acessoEntidade.delete.mockRejectedValue(new Error('boom'))
    await expect(service.revogar('a1')).rejects.toThrow('boom')
  })
})

describe('AcessosEntidadeService.atualizar', () => {
  it('404 quando não existe', async () => {
    prisma.acessoEntidade.findUnique.mockResolvedValue(null)
    await expect(service.atualizar('xx', { nivel: 'ADMIN' })).rejects.toMatchObject({
      code: 'RECURSO_NAO_ENCONTRADO',
    })
  })

  it('rejeita nível inválido', async () => {
    prisma.acessoEntidade.findUnique.mockResolvedValue({ id: 'a1' })
    await expect(service.atualizar('a1', { nivel: 'XX' })).rejects.toMatchObject({
      code: 'REQUISICAO_INVALIDA',
    })
  })

  it('atualiza só nível', async () => {
    prisma.acessoEntidade.findUnique.mockResolvedValue({ id: 'a1' })
    prisma.acessoEntidade.update.mockResolvedValue({ id: 'a1' })
    await service.atualizar('a1', { nivel: 'ADMIN' })
    expect(prisma.acessoEntidade.update).toHaveBeenCalledWith({
      where: { id: 'a1' },
      data: { nivel: 'ADMIN' },
    })
  })

  it('atualiza só ativo', async () => {
    prisma.acessoEntidade.findUnique.mockResolvedValue({ id: 'a1' })
    prisma.acessoEntidade.update.mockResolvedValue({ id: 'a1' })
    await service.atualizar('a1', { ativo: false })
    expect(prisma.acessoEntidade.update).toHaveBeenCalledWith({
      where: { id: 'a1' },
      data: { ativo: false },
    })
  })

  it('atualiza ambos', async () => {
    prisma.acessoEntidade.findUnique.mockResolvedValue({ id: 'a1' })
    prisma.acessoEntidade.update.mockResolvedValue({ id: 'a1' })
    await service.atualizar('a1', { nivel: 'ESCRITA', ativo: true, entidade: { ativo: true } })
    expect(prisma.acessoEntidade.update.mock.calls[0][0].data).toEqual({
      nivel: 'ESCRITA',
      ativo: true,
    })
  })

  it('aceita objeto vazio (no-op data)', async () => {
    prisma.acessoEntidade.findUnique.mockResolvedValue({ id: 'a1' })
    prisma.acessoEntidade.update.mockResolvedValue({ id: 'a1' })
    await service.atualizar('a1', {})
    expect(prisma.acessoEntidade.update.mock.calls[0][0].data).toEqual({})
  })
})
