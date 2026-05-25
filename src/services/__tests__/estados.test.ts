import { describe, it, expect, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'
import { EstadosService, ESTADOS_BRASIL, semearEstados } from '../estados.js'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'

const ESTADO = { id: 'e1', nome: 'Minas Gerais', sigla: 'MG', modeloContabilId: null, criadoEm: new Date(), atualizadoEm: new Date() }
const MODELO = { id: 'm1', descricao: 'PCASP-MG', ativo: true }

const erroP2002 = new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '7.0.0' })

let prisma: PrismaMock
let service: EstadosService

beforeEach(() => {
  prisma = criarPrismaMock()
  service = new EstadosService(prisma as never)
})

describe('EstadosService.listar', () => {
  it('retorna ordenado por nome', async () => {
    prisma.estado.findMany.mockResolvedValue([ESTADO])
    expect(await service.listar()).toEqual([ESTADO])
    expect(prisma.estado.findMany).toHaveBeenCalledWith({ orderBy: { nome: 'asc' } })
  })
})

describe('EstadosService.buscarPorId', () => {
  it('busca pelo id', async () => {
    prisma.estado.findUnique.mockResolvedValue(ESTADO)
    expect(await service.buscarPorId('e1')).toEqual(ESTADO)
  })
})

describe('EstadosService.definirModelo', () => {
  it('atualiza estado e propaga para municípios em transação', async () => {
    prisma.estado.findUnique.mockResolvedValue(ESTADO)
    prisma.modeloContabil.findUnique.mockResolvedValue(MODELO)
    prisma.estado.update.mockResolvedValue({ ...ESTADO, modeloContabilId: 'm1' })
    prisma.municipio.updateMany.mockResolvedValue({ count: 853 })

    const r = await service.definirModelo('e1', 'm1')

    expect(prisma.$transaction).toHaveBeenCalledOnce()
    expect(prisma.estado.update).toHaveBeenCalledWith({
      where: { id: 'e1' },
      data: { modeloContabilId: 'm1' },
    })
    expect(prisma.municipio.updateMany).toHaveBeenCalledWith({
      where: { estadoId: 'e1' },
      data: { modeloContabilId: 'm1' },
    })
    expect(r.municipiosAtualizados).toBe(853)
  })

  it('permite limpar o modelo (null) e propaga null aos municípios', async () => {
    prisma.estado.findUnique.mockResolvedValue({ ...ESTADO, modeloContabilId: 'm1' })
    prisma.estado.update.mockResolvedValue({ ...ESTADO, modeloContabilId: null })
    prisma.municipio.updateMany.mockResolvedValue({ count: 10 })

    await service.definirModelo('e1', null)

    expect(prisma.modeloContabil.findUnique).not.toHaveBeenCalled()
    expect(prisma.municipio.updateMany).toHaveBeenCalledWith({
      where: { estadoId: 'e1' },
      data: { modeloContabilId: null },
    })
  })

  it('lança RECURSO_NAO_ENCONTRADO quando estado não existe', async () => {
    prisma.estado.findUnique.mockResolvedValue(null)
    await expect(service.definirModelo('xx', 'm1')).rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('lança RECURSO_NAO_ENCONTRADO quando modelo não existe', async () => {
    prisma.estado.findUnique.mockResolvedValue(ESTADO)
    prisma.modeloContabil.findUnique.mockResolvedValue(null)
    await expect(service.definirModelo('e1', 'm-xx')).rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })
})

describe('EstadosService.garantirExistencia', () => {
  it('retorna o estado quando existe', async () => {
    prisma.estado.findUnique.mockResolvedValue(ESTADO)
    expect(await service.garantirExistencia('e1')).toEqual(ESTADO)
  })

  it('lança RECURSO_NAO_ENCONTRADO quando não existe', async () => {
    prisma.estado.findUnique.mockResolvedValue(null)
    await expect(service.garantirExistencia('xx')).rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
  })
})

describe('ESTADOS_BRASIL constante', () => {
  it('contém os 27 UFs', () => {
    expect(ESTADOS_BRASIL).toHaveLength(27)
  })

  it('tem todas as siglas em 2 letras maiúsculas', () => {
    for (const e of ESTADOS_BRASIL) expect(e.sigla).toMatch(/^[A-Z]{2}$/)
  })

  it('siglas são únicas', () => {
    const siglas = ESTADOS_BRASIL.map((e) => e.sigla)
    expect(new Set(siglas).size).toBe(27)
  })

  it('inclui DF', () => {
    expect(ESTADOS_BRASIL.find((e) => e.sigla === 'DF')).toBeDefined()
  })
})

describe('semearEstados', () => {
  it('cria todos os 27 quando banco vazio', async () => {
    prisma.estado.create.mockResolvedValue({})
    const n = await semearEstados(prisma as never)
    expect(n).toBe(27)
    expect(prisma.estado.create).toHaveBeenCalledTimes(27)
  })

  it('ignora P2002 (idempotente) e conta apenas os inseridos', async () => {
    let i = 0
    prisma.estado.create.mockImplementation(() => {
      i++
      if (i <= 25) return Promise.resolve({})
      return Promise.reject(erroP2002)
    })
    const n = await semearEstados(prisma as never)
    expect(n).toBe(25)
  })

  it('propaga erros que não são P2002', async () => {
    prisma.estado.create.mockRejectedValue(new Error('boom'))
    await expect(semearEstados(prisma as never)).rejects.toThrow('boom')
  })
})
