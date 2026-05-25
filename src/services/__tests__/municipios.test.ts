import { describe, it, expect, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'
import { MunicipiosService } from '../municipios.js'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'

const ESTADO = { id: 'e1', nome: 'Minas Gerais', sigla: 'MG', modeloContabilId: 'm1' }
const MUNICIPIO = { id: 'mun1', nome: 'Belo Horizonte', estadoId: 'e1', modeloContabilId: null, criadoEm: new Date(), atualizadoEm: new Date() }
const MODELO = { id: 'm1', descricao: 'PCASP-MG', ativo: true }

const erroP2002 = new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '7.0.0' })
const erroP2025 = new Prisma.PrismaClientKnownRequestError('not found', { code: 'P2025', clientVersion: '7.0.0' })

let prisma: PrismaMock
let service: MunicipiosService

beforeEach(() => {
  prisma = criarPrismaMock()
  service = new MunicipiosService(prisma as never)
})

describe('MunicipiosService.listar', () => {
  it('lista todos quando não passa estadoId', async () => {
    prisma.municipio.findMany.mockResolvedValue([MUNICIPIO])
    expect(await service.listar()).toEqual([MUNICIPIO])
    expect(prisma.municipio.findMany).toHaveBeenCalledWith({ where: undefined, orderBy: { nome: 'asc' } })
  })

  it('filtra por estadoId', async () => {
    prisma.municipio.findMany.mockResolvedValue([MUNICIPIO])
    await service.listar('e1')
    expect(prisma.municipio.findMany).toHaveBeenCalledWith({ where: { estadoId: 'e1' }, orderBy: { nome: 'asc' } })
  })
})

describe('MunicipiosService.buscarPorId', () => {
  it('busca pelo id', async () => {
    prisma.municipio.findUnique.mockResolvedValue(MUNICIPIO)
    expect(await service.buscarPorId('mun1')).toEqual(MUNICIPIO)
  })
})

describe('MunicipiosService.buscarComModeloEfetivo', () => {
  it('retorna null quando município não existe', async () => {
    prisma.municipio.findUnique.mockResolvedValue(null)
    expect(await service.buscarComModeloEfetivo('xx')).toBeNull()
  })

  it('herda o modelo do estado quando município não tem próprio', async () => {
    prisma.municipio.findUnique.mockResolvedValue({
      ...MUNICIPIO,
      modeloContabilId: null,
      estado: { modeloContabilId: 'm1' },
    })
    const r = await service.buscarComModeloEfetivo('mun1')
    expect(r).toMatchObject({
      modeloContabilId: null,
      modeloContabilEfetivoId: 'm1',
      herdaDoEstado: true,
    })
  })

  it('usa modelo próprio quando definido (sobrescreve a herança)', async () => {
    prisma.municipio.findUnique.mockResolvedValue({
      ...MUNICIPIO,
      modeloContabilId: 'm2',
      estado: { modeloContabilId: 'm1' },
    })
    const r = await service.buscarComModeloEfetivo('mun1')
    expect(r).toMatchObject({
      modeloContabilId: 'm2',
      modeloContabilEfetivoId: 'm2',
      herdaDoEstado: false,
    })
  })

  it('efetivo fica null quando nem município nem estado têm modelo', async () => {
    prisma.municipio.findUnique.mockResolvedValue({
      ...MUNICIPIO,
      modeloContabilId: null,
      estado: { modeloContabilId: null },
    })
    const r = await service.buscarComModeloEfetivo('mun1')
    expect(r?.modeloContabilEfetivoId).toBeNull()
  })
})

describe('MunicipiosService.criar', () => {
  it('cria com sucesso quando estado existe (sem modelo próprio → herda)', async () => {
    prisma.estado.findUnique.mockResolvedValue(ESTADO)
    prisma.municipio.create.mockResolvedValue(MUNICIPIO)
    const r = await service.criar({ nome: 'Belo Horizonte', estadoId: 'e1' })
    expect(r).toEqual(MUNICIPIO)
    expect(prisma.modeloContabil.findUnique).not.toHaveBeenCalled()
  })

  it('valida modelo próprio quando informado', async () => {
    prisma.estado.findUnique.mockResolvedValue(ESTADO)
    prisma.modeloContabil.findUnique.mockResolvedValue(MODELO)
    prisma.municipio.create.mockResolvedValue({ ...MUNICIPIO, modeloContabilId: 'm1' })
    await service.criar({ nome: 'BH', estadoId: 'e1', modeloContabilId: 'm1' })
    expect(prisma.modeloContabil.findUnique).toHaveBeenCalledWith({ where: { id: 'm1' } })
  })

  it('lança RECURSO_NAO_ENCONTRADO quando estado não existe', async () => {
    prisma.estado.findUnique.mockResolvedValue(null)
    await expect(service.criar({ nome: 'X', estadoId: 'xx' })).rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
    expect(prisma.municipio.create).not.toHaveBeenCalled()
  })

  it('lança RECURSO_NAO_ENCONTRADO quando modelo informado não existe', async () => {
    prisma.estado.findUnique.mockResolvedValue(ESTADO)
    prisma.modeloContabil.findUnique.mockResolvedValue(null)
    await expect(service.criar({ nome: 'X', estadoId: 'e1', modeloContabilId: 'mx' })).rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
  })

  it('lança CONFLITO em P2002 (nome duplicado no estado)', async () => {
    prisma.estado.findUnique.mockResolvedValue(ESTADO)
    prisma.municipio.create.mockRejectedValue(erroP2002)
    await expect(service.criar({ nome: 'BH', estadoId: 'e1' })).rejects.toMatchObject({ code: 'CONFLITO' })
  })

  it('propaga erros não-Prisma', async () => {
    prisma.estado.findUnique.mockResolvedValue(ESTADO)
    prisma.municipio.create.mockRejectedValue(new Error('boom'))
    await expect(service.criar({ nome: 'X', estadoId: 'e1' })).rejects.toThrow('boom')
  })
})

describe('MunicipiosService.atualizar', () => {
  it('atualiza nome com sucesso', async () => {
    prisma.municipio.update.mockResolvedValue({ ...MUNICIPIO, nome: 'Belo Hor.' })
    const r = await service.atualizar('mun1', { nome: 'Belo Hor.' })
    expect(r.nome).toBe('Belo Hor.')
    expect(prisma.modeloContabil.findUnique).not.toHaveBeenCalled()
  })

  it('valida modelo quando informado não-nulo', async () => {
    prisma.modeloContabil.findUnique.mockResolvedValue(MODELO)
    prisma.municipio.update.mockResolvedValue({ ...MUNICIPIO, modeloContabilId: 'm1' })
    await service.atualizar('mun1', { modeloContabilId: 'm1' })
    expect(prisma.modeloContabil.findUnique).toHaveBeenCalled()
  })

  it('aceita modeloContabilId=null sem validar (restaura herança)', async () => {
    prisma.municipio.update.mockResolvedValue({ ...MUNICIPIO, modeloContabilId: null })
    await service.atualizar('mun1', { modeloContabilId: null })
    expect(prisma.modeloContabil.findUnique).not.toHaveBeenCalled()
    expect(prisma.municipio.update).toHaveBeenCalledWith({
      where: { id: 'mun1' },
      data: { modeloContabilId: null },
    })
  })

  it('lança RECURSO_NAO_ENCONTRADO quando modelo informado não existe', async () => {
    prisma.modeloContabil.findUnique.mockResolvedValue(null)
    await expect(service.atualizar('mun1', { modeloContabilId: 'mx' })).rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
  })

  it('lança CONFLITO em P2002', async () => {
    prisma.municipio.update.mockRejectedValue(erroP2002)
    await expect(service.atualizar('mun1', { nome: 'X' })).rejects.toMatchObject({ code: 'CONFLITO' })
  })

  it('lança RECURSO_NAO_ENCONTRADO em P2025', async () => {
    prisma.municipio.update.mockRejectedValue(erroP2025)
    await expect(service.atualizar('mun1', { nome: 'X' })).rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
  })

  it('propaga erros não-Prisma', async () => {
    prisma.municipio.update.mockRejectedValue(new Error('boom'))
    await expect(service.atualizar('mun1', { nome: 'X' })).rejects.toThrow('boom')
  })

  it('propaga Prisma error com código não tratado', async () => {
    const erro = new Prisma.PrismaClientKnownRequestError('fk', { code: 'P2003', clientVersion: '7.0.0' })
    prisma.municipio.update.mockRejectedValue(erro)
    await expect(service.atualizar('mun1', { nome: 'X' })).rejects.toBe(erro)
  })
})

describe('MunicipiosService.excluir', () => {
  beforeEach(() => {
    prisma.municipio.findUnique.mockResolvedValue(MUNICIPIO)
    prisma.lancamento.count.mockResolvedValue(0)
    prisma.resumoMensalConta.count.mockResolvedValue(0)
    prisma.saldoInicialAno.count.mockResolvedValue(0)
  })

  it('exclui quando sem movimentação', async () => {
    await service.excluir('mun1')
    expect(prisma.municipio.delete).toHaveBeenCalledWith({ where: { id: 'mun1' } })
  })

  it('lança RECURSO_NAO_ENCONTRADO quando não existe', async () => {
    prisma.municipio.findUnique.mockResolvedValue(null)
    await expect(service.excluir('xx')).rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
  })

  it('lança CONFLITO quando há lançamentos', async () => {
    prisma.lancamento.count.mockResolvedValue(5)
    await expect(service.excluir('mun1')).rejects.toMatchObject({ code: 'CONFLITO' })
  })

  it('lança CONFLITO quando há resumos mensais', async () => {
    prisma.resumoMensalConta.count.mockResolvedValue(1)
    await expect(service.excluir('mun1')).rejects.toMatchObject({ code: 'CONFLITO' })
  })

  it('lança CONFLITO quando há saldos iniciais', async () => {
    prisma.saldoInicialAno.count.mockResolvedValue(1)
    await expect(service.excluir('mun1')).rejects.toMatchObject({ code: 'CONFLITO' })
  })
})
