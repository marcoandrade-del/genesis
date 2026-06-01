import { describe, it, expect, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'
import { AcoesService } from '../acoes.js'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'

const PROGRAMA = { id: 'p1', codigo: '0001', nome: 'X' }

let prisma: PrismaMock
let service: AcoesService

beforeEach(() => {
  prisma = criarPrismaMock()
  service = new AcoesService(prisma as never)
})

function dadosOk() {
  return {
    codigo: '2001',
    nome: 'MANUTENÇÃO DAS ESCOLAS',
    tipo: 'ATIVIDADE' as const,
    unidadeMedida: 'escola atendida',
    metaFisica: '25',
    ativa: true,
  }
}

describe('AcoesService.listar', () => {
  it('lista por programa, ordenado por código', async () => {
    prisma.acao.findMany.mockResolvedValue([])
    await service.listar('p1')
    expect(prisma.acao.findMany).toHaveBeenCalledWith({
      where: { programaId: 'p1' },
      orderBy: { codigo: 'asc' },
    })
  })
})

describe('AcoesService.buscarPorId', () => {
  it('busca por id', async () => {
    prisma.acao.findUnique.mockResolvedValue(null)
    await service.buscarPorId('a1')
    expect(prisma.acao.findUnique).toHaveBeenCalledWith({ where: { id: 'a1' } })
  })
})

describe('AcoesService.criar', () => {
  it('caminho feliz: cria com trim + Decimal', async () => {
    prisma.programa.findUnique.mockResolvedValue(PROGRAMA)
    prisma.acao.create.mockResolvedValue({ id: 'a1' })
    await service.criar('p1', dadosOk())
    const data = prisma.acao.create.mock.calls[0][0].data
    expect(data).toMatchObject({
      programaId: 'p1',
      codigo: '2001',
      nome: 'MANUTENÇÃO DAS ESCOLAS',
      tipo: 'ATIVIDADE',
      unidadeMedida: 'escola atendida',
      ativa: true,
    })
    expect(data.metaFisica.toString()).toBe('25')
  })

  it('metaFisica null/undefined/vazia → null', async () => {
    prisma.programa.findUnique.mockResolvedValue(PROGRAMA)
    prisma.acao.create.mockResolvedValue({ id: 'a1' })
    await service.criar('p1', { ...dadosOk(), metaFisica: null })
    expect(prisma.acao.create.mock.calls[0][0].data.metaFisica).toBeNull()
    prisma.acao.create.mockClear()
    await service.criar('p1', { ...dadosOk(), metaFisica: undefined })
    expect(prisma.acao.create.mock.calls[0][0].data.metaFisica).toBeNull()
    prisma.acao.create.mockClear()
    await service.criar('p1', { ...dadosOk(), metaFisica: '' })
    expect(prisma.acao.create.mock.calls[0][0].data.metaFisica).toBeNull()
  })

  it('unidadeMedida vazia/null/undefined → null', async () => {
    prisma.programa.findUnique.mockResolvedValue(PROGRAMA)
    prisma.acao.create.mockResolvedValue({ id: 'a1' })
    await service.criar('p1', { ...dadosOk(), unidadeMedida: '   ' })
    expect(prisma.acao.create.mock.calls[0][0].data.unidadeMedida).toBeNull()
    prisma.acao.create.mockClear()
    await service.criar('p1', { ...dadosOk(), unidadeMedida: null })
    expect(prisma.acao.create.mock.calls[0][0].data.unidadeMedida).toBeNull()
    prisma.acao.create.mockClear()
    await service.criar('p1', { ...dadosOk(), unidadeMedida: undefined })
    expect(prisma.acao.create.mock.calls[0][0].data.unidadeMedida).toBeNull()
  })

  it('ativa default true quando omitida', async () => {
    prisma.programa.findUnique.mockResolvedValue(PROGRAMA)
    prisma.acao.create.mockResolvedValue({ id: 'a1' })
    const d = dadosOk()
    delete (d as Partial<typeof d>).ativa
    await service.criar('p1', d)
    expect(prisma.acao.create.mock.calls[0][0].data.ativa).toBe(true)
  })

  it('rejeita código vazio', async () => {
    await expect(service.criar('p1', { ...dadosOk(), codigo: '   ' })).rejects.toMatchObject({
      code: 'REQUISICAO_INVALIDA',
    })
  })

  it('rejeita código undefined', async () => {
    await expect(
      service.criar('p1', { ...dadosOk(), codigo: undefined as never }),
    ).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
  })

  it('rejeita nome vazio', async () => {
    await expect(service.criar('p1', { ...dadosOk(), nome: '   ' })).rejects.toMatchObject({
      code: 'REQUISICAO_INVALIDA',
    })
  })

  it('rejeita nome undefined', async () => {
    await expect(
      service.criar('p1', { ...dadosOk(), nome: undefined as never }),
    ).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
  })

  it('rejeita tipo inválido', async () => {
    await expect(service.criar('p1', { ...dadosOk(), tipo: 'OUTRO' as never })).rejects.toMatchObject({
      code: 'REQUISICAO_INVALIDA',
      message: expect.stringContaining('Tipo inválido'),
    })
  })

  it('rejeita metaFisica não-numérica', async () => {
    await expect(service.criar('p1', { ...dadosOk(), metaFisica: 'abc' })).rejects.toMatchObject({
      code: 'REQUISICAO_INVALIDA',
      message: expect.stringContaining('Meta física inválida'),
    })
  })

  it('rejeita metaFisica negativa', async () => {
    await expect(service.criar('p1', { ...dadosOk(), metaFisica: '-5' })).rejects.toMatchObject({
      code: 'REQUISICAO_INVALIDA',
      message: expect.stringContaining('negativa'),
    })
  })

  it('aceita metaFisica como number', async () => {
    prisma.programa.findUnique.mockResolvedValue(PROGRAMA)
    prisma.acao.create.mockResolvedValue({ id: 'a1' })
    await service.criar('p1', { ...dadosOk(), metaFisica: 42.5 })
    expect(prisma.acao.create.mock.calls[0][0].data.metaFisica.toString()).toBe('42.5')
  })

  it('rejeita quando programa não existe', async () => {
    prisma.programa.findUnique.mockResolvedValue(null)
    await expect(service.criar('xx', dadosOk())).rejects.toMatchObject({
      code: 'RECURSO_NAO_ENCONTRADO',
    })
  })

  it('código duplicado vira CONFLITO', async () => {
    prisma.programa.findUnique.mockResolvedValue(PROGRAMA)
    prisma.acao.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '7.7.0' }),
    )
    await expect(service.criar('p1', dadosOk())).rejects.toMatchObject({ code: 'CONFLITO' })
  })

  it('repassa outros erros', async () => {
    prisma.programa.findUnique.mockResolvedValue(PROGRAMA)
    prisma.acao.create.mockRejectedValue(new Error('boom'))
    await expect(service.criar('p1', dadosOk())).rejects.toThrow('boom')
  })
})

describe('AcoesService.atualizar', () => {
  const EXISTENTE = { id: 'a1', programaId: 'p1', codigo: '2001', ativa: true }

  it('atualiza', async () => {
    prisma.acao.findUnique.mockResolvedValue(EXISTENTE)
    prisma.acao.update.mockResolvedValue(EXISTENTE)
    await service.atualizar('a1', dadosOk())
    expect(prisma.acao.update.mock.calls[0][0]).toMatchObject({
      where: { id: 'a1' },
      data: expect.objectContaining({ codigo: '2001', ativa: true }),
    })
  })

  it('preserva ativa quando omitida', async () => {
    prisma.acao.findUnique.mockResolvedValue({ ...EXISTENTE, ativa: false })
    prisma.acao.update.mockResolvedValue(EXISTENTE)
    const d = dadosOk()
    delete (d as Partial<typeof d>).ativa
    await service.atualizar('a1', d)
    expect(prisma.acao.update.mock.calls[0][0].data.ativa).toBe(false)
  })

  it('404 quando ação não existe', async () => {
    prisma.acao.findUnique.mockResolvedValue(null)
    await expect(service.atualizar('xx', dadosOk())).rejects.toMatchObject({
      code: 'RECURSO_NAO_ENCONTRADO',
    })
  })

  it('código duplicado vira CONFLITO', async () => {
    prisma.acao.findUnique.mockResolvedValue(EXISTENTE)
    prisma.acao.update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '7.7.0' }),
    )
    await expect(service.atualizar('a1', dadosOk())).rejects.toMatchObject({ code: 'CONFLITO' })
  })

  it('rejeita validação antes de qualquer query', async () => {
    await expect(service.atualizar('a1', { ...dadosOk(), codigo: '   ' })).rejects.toMatchObject({
      code: 'REQUISICAO_INVALIDA',
    })
    expect(prisma.acao.findUnique).not.toHaveBeenCalled()
  })

  it('repassa outros erros', async () => {
    prisma.acao.findUnique.mockResolvedValue(EXISTENTE)
    prisma.acao.update.mockRejectedValue(new Error('boom'))
    await expect(service.atualizar('a1', dadosOk())).rejects.toThrow('boom')
  })
})

describe('AcoesService.excluir', () => {
  it('exclui quando existe', async () => {
    prisma.acao.findUnique.mockResolvedValue({ id: 'a1' })
    prisma.acao.delete.mockResolvedValue({})
    await service.excluir('a1')
    expect(prisma.acao.delete).toHaveBeenCalledWith({ where: { id: 'a1' } })
  })

  it('404 quando não existe', async () => {
    prisma.acao.findUnique.mockResolvedValue(null)
    await expect(service.excluir('xx')).rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
    expect(prisma.acao.delete).not.toHaveBeenCalled()
  })
})
