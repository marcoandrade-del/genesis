import { describe, it, expect, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'
import { TermosReferenciaService, totalTermoReferencia } from '../termos-referencia.js'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'

let prisma: PrismaMock
let service: TermosReferenciaService

beforeEach(() => {
  prisma = criarPrismaMock()
  service = new TermosReferenciaService(prisma as never)
})

function dadosOk(over: Partial<Record<string, unknown>> = {}) {
  return {
    objeto: 'Material de escritório',
    itens: [{ itemCatalogoId: 'c1', quantidade: '10', precoUnitarioEstimado: '5.50' }],
    ...over,
  } as never
}

function p2002() {
  return new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '7.7.0' })
}

describe('TermosReferenciaService.criar', () => {
  it('404 quando demanda não existe', async () => {
    prisma.documentoDemanda.findUnique.mockResolvedValue(null)
    await expect(service.criar('dod1', dadosOk())).rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
  })

  it('rejeita objeto vazio', async () => {
    prisma.documentoDemanda.findUnique.mockResolvedValue({ id: 'dod1' })
    await expect(service.criar('dod1', dadosOk({ objeto: '  ' }))).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
  })

  it('rejeita item do catálogo inexistente', async () => {
    prisma.documentoDemanda.findUnique.mockResolvedValue({ id: 'dod1' })
    prisma.itemCatalogo.findMany.mockResolvedValue([])
    await expect(service.criar('dod1', dadosOk())).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
  })

  it('cria TR e itens em transação', async () => {
    prisma.documentoDemanda.findUnique.mockResolvedValue({ id: 'dod1' })
    prisma.itemCatalogo.findMany.mockResolvedValue([{ id: 'c1' }])
    prisma.termoReferencia.create.mockResolvedValue({ id: 'tr1' })
    await service.criar('dod1', dadosOk())
    expect(prisma.termoReferencia.create).toHaveBeenCalledWith({
      data: { documentoDemandaId: 'dod1', objeto: 'Material de escritório', observacoes: null },
    })
    const item = prisma.itemTermoReferencia.createMany.mock.calls[0][0].data[0]
    expect(item).toMatchObject({ termoReferenciaId: 'tr1', itemCatalogoId: 'c1' })
    expect(item.precoUnitarioEstimado.toString()).toBe('5.5')
  })

  it('demanda que já tem TR vira CONFLITO', async () => {
    prisma.documentoDemanda.findUnique.mockResolvedValue({ id: 'dod1' })
    prisma.itemCatalogo.findMany.mockResolvedValue([{ id: 'c1' }])
    prisma.termoReferencia.create.mockRejectedValue(p2002())
    await expect(service.criar('dod1', dadosOk())).rejects.toMatchObject({ code: 'CONFLITO' })
  })
})

describe('TermosReferenciaService.atualizar', () => {
  it('404 quando não existe', async () => {
    prisma.termoReferencia.findUnique.mockResolvedValue(null)
    await expect(service.atualizar('x', dadosOk())).rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
  })

  it('substitui itens no caminho feliz', async () => {
    prisma.termoReferencia.findUnique.mockResolvedValue({ id: 'tr1' })
    prisma.itemCatalogo.findMany.mockResolvedValue([{ id: 'c1' }])
    prisma.termoReferencia.update.mockResolvedValue({ id: 'tr1' })
    await service.atualizar('tr1', dadosOk())
    expect(prisma.itemTermoReferencia.deleteMany).toHaveBeenCalledWith({ where: { termoReferenciaId: 'tr1' } })
    expect(prisma.itemTermoReferencia.createMany).toHaveBeenCalled()
  })
})

describe('TermosReferenciaService.excluir', () => {
  it('bloqueia quando há reservas', async () => {
    prisma.termoReferencia.findUnique.mockResolvedValue({ id: 'tr1', _count: { reservas: 1 } })
    await expect(service.excluir('tr1')).rejects.toMatchObject({ code: 'CONFLITO' })
  })

  it('exclui no caminho feliz', async () => {
    prisma.termoReferencia.findUnique.mockResolvedValue({ id: 'tr1', _count: { reservas: 0 } })
    prisma.termoReferencia.delete.mockResolvedValue({})
    await service.excluir('tr1')
    expect(prisma.termoReferencia.delete).toHaveBeenCalledWith({ where: { id: 'tr1' } })
  })
})

describe('totalTermoReferencia', () => {
  it('soma quantidade × preço unitário', () => {
    const total = totalTermoReferencia([
      { quantidade: new Prisma.Decimal('10'), precoUnitarioEstimado: new Prisma.Decimal('5.50') },
      { quantidade: new Prisma.Decimal('2'), precoUnitarioEstimado: new Prisma.Decimal('100') },
    ])
    expect(total.toString()).toBe('255') // 55 + 200
  })

  it('lista vazia → zero', () => {
    expect(totalTermoReferencia([]).toString()).toBe('0')
  })
})
