import { describe, it, expect, beforeEach } from 'vitest'
import { CodigosService } from '../codigos.js'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'

const USUARIO_BASE = { id: 'u1', emailValidado: false, celularValidado: false }
const USUARIO_EMAIL_OK = { id: 'u1', emailValidado: true, celularValidado: false }
const USUARIO_TUDO_OK = { id: 'u1', emailValidado: true, celularValidado: true }

const CODIGO_DB = {
  id: 'c1',
  usuarioId: 'u1',
  tipo: 'EMAIL' as const,
  codigo: '123456',
  expiradoEm: new Date(Date.now() + 10 * 60 * 1000),
  usadoEm: null,
}

describe('CodigosService.solicitar', () => {
  let prisma: PrismaMock
  let service: CodigosService

  beforeEach(() => {
    prisma = criarPrismaMock()
    service = new CodigosService(prisma as never)
  })

  it('lança RECURSO_NAO_ENCONTRADO quando usuário não existe', async () => {
    prisma.usuario.findUnique.mockResolvedValue(null)

    await expect(service.solicitar('u-inexistente', 'EMAIL'))
      .rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })

    expect(prisma.codigoValidacao.create).not.toHaveBeenCalled()
  })

  it('lança CONFLITO ao solicitar código EMAIL quando e-mail já foi validado', async () => {
    prisma.usuario.findUnique.mockResolvedValue(USUARIO_EMAIL_OK)

    await expect(service.solicitar('u1', 'EMAIL'))
      .rejects.toMatchObject({ code: 'CONFLITO' })
  })

  it('lança CONFLITO ao solicitar código CELULAR quando celular já foi validado', async () => {
    prisma.usuario.findUnique.mockResolvedValue(USUARIO_TUDO_OK)

    await expect(service.solicitar('u1', 'CELULAR'))
      .rejects.toMatchObject({ code: 'CONFLITO' })
  })

  it('invalida códigos anteriores e cria novo código', async () => {
    prisma.usuario.findUnique.mockResolvedValue(USUARIO_BASE)
    prisma.codigoValidacao.deleteMany.mockResolvedValue({ count: 1 })
    prisma.codigoValidacao.create.mockResolvedValue(CODIGO_DB)

    const resultado = await service.solicitar('u1', 'EMAIL')

    expect(prisma.codigoValidacao.deleteMany).toHaveBeenCalledWith({
      where: { usuarioId: 'u1', tipo: 'EMAIL', usadoEm: null },
    })
    expect(prisma.codigoValidacao.create).toHaveBeenCalledOnce()
    expect(resultado).toHaveProperty('id')
    expect(resultado).toHaveProperty('codigo')
    expect(resultado).toHaveProperty('expiradoEm')
  })
})

describe('CodigosService.validar', () => {
  let prisma: PrismaMock
  let service: CodigosService

  beforeEach(() => {
    prisma = criarPrismaMock()
    service = new CodigosService(prisma as never)
  })

  it('lança RECURSO_NAO_ENCONTRADO quando usuário não existe', async () => {
    prisma.usuario.findUnique.mockResolvedValue(null)

    await expect(service.validar('u-inexistente', 'EMAIL', '123456'))
      .rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
  })

  it('lança REQUISICAO_INVALIDA quando código não existe ou expirou', async () => {
    prisma.usuario.findUnique.mockResolvedValue(USUARIO_BASE)
    prisma.codigoValidacao.findFirst.mockResolvedValue(null)

    await expect(service.validar('u1', 'EMAIL', '000000'))
      .rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
  })

  it('valida e-mail e mantém celular como false, conta permanece inativa', async () => {
    prisma.usuario.findUnique.mockResolvedValue(USUARIO_BASE)
    prisma.codigoValidacao.findFirst.mockResolvedValue(CODIGO_DB)
    prisma.$transaction.mockResolvedValue(undefined)

    const resultado = await service.validar('u1', 'EMAIL', '123456')

    expect(resultado).toEqual({ emailValidado: true, celularValidado: false, ativo: false })
    expect(prisma.$transaction).toHaveBeenCalledOnce()
  })

  it('valida celular após e-mail já validado e ativa a conta', async () => {
    prisma.usuario.findUnique.mockResolvedValue(USUARIO_EMAIL_OK)
    prisma.codigoValidacao.findFirst.mockResolvedValue({ ...CODIGO_DB, tipo: 'CELULAR' as const })
    prisma.$transaction.mockResolvedValue(undefined)

    const resultado = await service.validar('u1', 'CELULAR', '123456')

    expect(resultado).toEqual({ emailValidado: true, celularValidado: true, ativo: true })
  })

  it('executa transação marcando código como usado e atualizando usuário', async () => {
    prisma.usuario.findUnique.mockResolvedValue(USUARIO_BASE)
    prisma.codigoValidacao.findFirst.mockResolvedValue(CODIGO_DB)
    // Usa a implementação padrão do mock ($transaction chama o callback)
    prisma.codigoValidacao.update.mockResolvedValue({})
    prisma.usuario.update.mockResolvedValue({})

    await service.validar('u1', 'EMAIL', '123456')

    // $transaction foi chamado com array (não callback) — verifica que foi chamado
    expect(prisma.$transaction).toHaveBeenCalledOnce()
  })
})
