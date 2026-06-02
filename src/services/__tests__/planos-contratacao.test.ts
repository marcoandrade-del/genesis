import { describe, it, expect, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'
import { PlanosContratacaoService } from '../planos-contratacao.js'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'

let prisma: PrismaMock
let service: PlanosContratacaoService

beforeEach(() => {
  prisma = criarPrismaMock()
  service = new PlanosContratacaoService(prisma as never)
})

function dadosOk(over: Partial<Record<string, unknown>> = {}) {
  return {
    observacoes: 'plano 2026',
    itens: [{ itemCatalogoId: 'c1', quantidadeEstimada: '10', valorUnitarioEstimado: '5.50' }],
    ...over,
  } as never
}

function mockCatalogoOk(ids: string[] = ['c1']) {
  prisma.itemCatalogo.findMany.mockResolvedValue(ids.map((id) => ({ id })))
}

function p2002() {
  return new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '7.7.0' })
}

describe('PlanosContratacaoService.criar — validação', () => {
  it('rejeita ano inválido', async () => {
    await expect(service.criar('ent1', 1800, dadosOk())).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
  })

  it('404 quando entidade não existe', async () => {
    prisma.entidade.findUnique.mockResolvedValue(null)
    await expect(service.criar('ent1', 2026, dadosOk())).rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
  })

  it('rejeita quantidade zero', async () => {
    prisma.entidade.findUnique.mockResolvedValue({ id: 'ent1' })
    await expect(
      service.criar('ent1', 2026, dadosOk({ itens: [{ itemCatalogoId: 'c1', quantidadeEstimada: '0', valorUnitarioEstimado: '5' }] })),
    ).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
  })

  it('rejeita valor negativo', async () => {
    prisma.entidade.findUnique.mockResolvedValue({ id: 'ent1' })
    await expect(
      service.criar('ent1', 2026, dadosOk({ itens: [{ itemCatalogoId: 'c1', quantidadeEstimada: '1', valorUnitarioEstimado: '-5' }] })),
    ).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
  })

  it('rejeita item do catálogo repetido', async () => {
    prisma.entidade.findUnique.mockResolvedValue({ id: 'ent1' })
    const itens = [
      { itemCatalogoId: 'c1', quantidadeEstimada: '1', valorUnitarioEstimado: '5' },
      { itemCatalogoId: 'c1', quantidadeEstimada: '2', valorUnitarioEstimado: '6' },
    ]
    await expect(service.criar('ent1', 2026, dadosOk({ itens }))).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
  })

  it('rejeita item do catálogo inexistente', async () => {
    prisma.entidade.findUnique.mockResolvedValue({ id: 'ent1' })
    prisma.itemCatalogo.findMany.mockResolvedValue([]) // nenhum encontrado
    await expect(service.criar('ent1', 2026, dadosOk())).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
  })
})

describe('PlanosContratacaoService.criar — persistência', () => {
  it('cria PCA e itens em transação', async () => {
    prisma.entidade.findUnique.mockResolvedValue({ id: 'ent1' })
    mockCatalogoOk(['c1'])
    prisma.planoContratacaoAnual.create.mockResolvedValue({ id: 'pca1' })
    await service.criar('ent1', 2026, dadosOk())
    expect(prisma.planoContratacaoAnual.create).toHaveBeenCalledWith({
      data: { entidadeId: 'ent1', ano: 2026, observacoes: 'plano 2026' },
    })
    expect(prisma.itemPca.createMany).toHaveBeenCalled()
    const arg = prisma.itemPca.createMany.mock.calls[0][0]
    expect(arg.data[0]).toMatchObject({ pcaId: 'pca1', itemCatalogoId: 'c1' })
    expect(arg.data[0].quantidadeEstimada.toString()).toBe('10')
  })

  it('aceita lista de itens vazia (não chama createMany)', async () => {
    prisma.entidade.findUnique.mockResolvedValue({ id: 'ent1' })
    prisma.planoContratacaoAnual.create.mockResolvedValue({ id: 'pca1' })
    await service.criar('ent1', 2026, dadosOk({ itens: [] }))
    expect(prisma.itemPca.createMany).not.toHaveBeenCalled()
  })

  it('PCA duplicado (ano) vira CONFLITO', async () => {
    prisma.entidade.findUnique.mockResolvedValue({ id: 'ent1' })
    mockCatalogoOk(['c1'])
    prisma.planoContratacaoAnual.create.mockRejectedValue(p2002())
    await expect(service.criar('ent1', 2026, dadosOk())).rejects.toMatchObject({ code: 'CONFLITO' })
  })
})

describe('PlanosContratacaoService.atualizar', () => {
  it('404 quando não existe', async () => {
    prisma.planoContratacaoAnual.findUnique.mockResolvedValue(null)
    await expect(service.atualizar('x', dadosOk())).rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
  })

  it('bloqueia edição fora de RASCUNHO', async () => {
    prisma.planoContratacaoAnual.findUnique.mockResolvedValue({ id: 'pca1', status: 'APROVADO' })
    await expect(service.atualizar('pca1', dadosOk())).rejects.toMatchObject({ code: 'CONFLITO' })
  })

  it('substitui itens no caminho feliz', async () => {
    prisma.planoContratacaoAnual.findUnique.mockResolvedValue({ id: 'pca1', status: 'RASCUNHO' })
    mockCatalogoOk(['c1'])
    prisma.planoContratacaoAnual.update.mockResolvedValue({ id: 'pca1' })
    await service.atualizar('pca1', dadosOk())
    expect(prisma.itemPca.deleteMany).toHaveBeenCalledWith({ where: { pcaId: 'pca1' } })
    expect(prisma.itemPca.createMany).toHaveBeenCalled()
  })
})

describe('PlanosContratacaoService.alterarStatus', () => {
  it('RASCUNHO → APROVADO ok', async () => {
    prisma.planoContratacaoAnual.findUnique.mockResolvedValue({ id: 'pca1', status: 'RASCUNHO' })
    prisma.planoContratacaoAnual.update.mockResolvedValue({ id: 'pca1', status: 'APROVADO' })
    await service.alterarStatus('pca1', 'APROVADO')
    expect(prisma.planoContratacaoAnual.update).toHaveBeenCalledWith({ where: { id: 'pca1' }, data: { status: 'APROVADO' } })
  })

  it('transição inválida vira CONFLITO', async () => {
    prisma.planoContratacaoAnual.findUnique.mockResolvedValue({ id: 'pca1', status: 'APROVADO' })
    await expect(service.alterarStatus('pca1', 'APROVADO')).rejects.toMatchObject({ code: 'CONFLITO' })
  })
})

describe('PlanosContratacaoService.excluir', () => {
  it('bloqueia fora de RASCUNHO', async () => {
    prisma.planoContratacaoAnual.findUnique.mockResolvedValue({ id: 'pca1', status: 'APROVADO', _count: { demandas: 0 } })
    await expect(service.excluir('pca1')).rejects.toMatchObject({ code: 'CONFLITO' })
  })

  it('bloqueia com demandas vinculadas', async () => {
    prisma.planoContratacaoAnual.findUnique.mockResolvedValue({ id: 'pca1', status: 'RASCUNHO', _count: { demandas: 2 } })
    await expect(service.excluir('pca1')).rejects.toMatchObject({ code: 'CONFLITO' })
  })

  it('exclui no caminho feliz', async () => {
    prisma.planoContratacaoAnual.findUnique.mockResolvedValue({ id: 'pca1', status: 'RASCUNHO', _count: { demandas: 0 } })
    prisma.planoContratacaoAnual.delete.mockResolvedValue({})
    await service.excluir('pca1')
    expect(prisma.planoContratacaoAnual.delete).toHaveBeenCalledWith({ where: { id: 'pca1' } })
  })
})
