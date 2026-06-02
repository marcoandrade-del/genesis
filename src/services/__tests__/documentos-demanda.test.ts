import { describe, it, expect, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'
import { DocumentosDemandaService } from '../documentos-demanda.js'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'

let prisma: PrismaMock
let service: DocumentosDemandaService

beforeEach(() => {
  prisma = criarPrismaMock()
  service = new DocumentosDemandaService(prisma as never)
})

function dadosOk(over: Partial<Record<string, unknown>> = {}) {
  return {
    ano: 2026,
    numero: '2026/0001',
    unidadeOrcamentariaId: 'uo1',
    justificativa: 'Aquisição de material de escritório',
    itens: [{ itemCatalogoId: 'c1', quantidade: '10' }],
    ...over,
  } as never
}

function mockRefsOk() {
  prisma.unidadeOrcamentaria.findUnique.mockResolvedValue({ id: 'uo1', entidadeId: 'ent1' })
  prisma.itemCatalogo.findMany.mockResolvedValue([{ id: 'c1' }])
}

function p2002() {
  return new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '7.7.0' })
}

describe('DocumentosDemandaService.criar — validação', () => {
  it('rejeita ano inválido', async () => {
    await expect(service.criar('ent1', dadosOk({ ano: 1800 }))).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
  })
  it.each(['numero', 'unidadeOrcamentariaId', 'justificativa'])('rejeita %s vazio', async (campo) => {
    await expect(service.criar('ent1', dadosOk({ [campo]: '  ' }))).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
  })

  it('rejeita UO de outra entidade', async () => {
    prisma.unidadeOrcamentaria.findUnique.mockResolvedValue({ id: 'uo1', entidadeId: 'outra' })
    await expect(service.criar('ent1', dadosOk())).rejects.toMatchObject({
      code: 'REQUISICAO_INVALIDA',
      message: expect.stringContaining('Unidade'),
    })
  })

  it('rejeita PCA de outra entidade', async () => {
    prisma.unidadeOrcamentaria.findUnique.mockResolvedValue({ id: 'uo1', entidadeId: 'ent1' })
    prisma.planoContratacaoAnual.findUnique.mockResolvedValue({ id: 'pca1', entidadeId: 'outra' })
    await expect(service.criar('ent1', dadosOk({ pcaId: 'pca1' }))).rejects.toMatchObject({
      code: 'REQUISICAO_INVALIDA',
      message: expect.stringContaining('PCA'),
    })
  })

  it('rejeita item do catálogo inexistente', async () => {
    prisma.unidadeOrcamentaria.findUnique.mockResolvedValue({ id: 'uo1', entidadeId: 'ent1' })
    prisma.itemCatalogo.findMany.mockResolvedValue([])
    await expect(service.criar('ent1', dadosOk())).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
  })
})

describe('DocumentosDemandaService.criar — persistência', () => {
  it('cria DOD e itens em transação', async () => {
    mockRefsOk()
    prisma.documentoDemanda.create.mockResolvedValue({ id: 'dod1' })
    await service.criar('ent1', dadosOk())
    expect(prisma.documentoDemanda.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        entidadeId: 'ent1',
        ano: 2026,
        numero: '2026/0001',
        unidadeOrcamentariaId: 'uo1',
        pcaId: null,
        justificativa: 'Aquisição de material de escritório',
      }),
    })
    expect(prisma.itemDemanda.createMany.mock.calls[0][0].data[0]).toMatchObject({ documentoDemandaId: 'dod1', itemCatalogoId: 'c1' })
  })

  it('número duplicado vira CONFLITO', async () => {
    mockRefsOk()
    prisma.documentoDemanda.create.mockRejectedValue(p2002())
    await expect(service.criar('ent1', dadosOk())).rejects.toMatchObject({ code: 'CONFLITO' })
  })
})

describe('DocumentosDemandaService.atualizar', () => {
  it('404 quando não existe', async () => {
    prisma.documentoDemanda.findUnique.mockResolvedValue(null)
    await expect(service.atualizar('x', dadosOk())).rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
  })

  it('bloqueia edição fora de RASCUNHO', async () => {
    prisma.documentoDemanda.findUnique.mockResolvedValue({ id: 'dod1', entidadeId: 'ent1', status: 'APROVADA' })
    await expect(service.atualizar('dod1', dadosOk())).rejects.toMatchObject({ code: 'CONFLITO' })
  })

  it('atualiza no caminho feliz', async () => {
    prisma.documentoDemanda.findUnique.mockResolvedValue({ id: 'dod1', entidadeId: 'ent1', status: 'RASCUNHO' })
    mockRefsOk()
    prisma.documentoDemanda.update.mockResolvedValue({ id: 'dod1' })
    await service.atualizar('dod1', dadosOk())
    expect(prisma.itemDemanda.deleteMany).toHaveBeenCalledWith({ where: { documentoDemandaId: 'dod1' } })
  })
})

describe('DocumentosDemandaService.alterarStatus', () => {
  it('RASCUNHO → AGUARDANDO_PARECER ok (sem parecer)', async () => {
    prisma.documentoDemanda.findUnique.mockResolvedValue({ id: 'dod1', status: 'RASCUNHO' })
    prisma.documentoDemanda.update.mockResolvedValue({ id: 'dod1' })
    await service.alterarStatus('dod1', 'AGUARDANDO_PARECER')
    expect(prisma.documentoDemanda.update).toHaveBeenCalledWith({ where: { id: 'dod1' }, data: { status: 'AGUARDANDO_PARECER' } })
  })

  it('transição inválida vira CONFLITO', async () => {
    prisma.documentoDemanda.findUnique.mockResolvedValue({ id: 'dod1', status: 'RASCUNHO' })
    await expect(service.alterarStatus('dod1', 'APROVADA')).rejects.toMatchObject({ code: 'CONFLITO' })
  })

  it('APROVADA exige responsável pelo parecer', async () => {
    prisma.documentoDemanda.findUnique.mockResolvedValue({ id: 'dod1', status: 'AGUARDANDO_PARECER' })
    await expect(service.alterarStatus('dod1', 'APROVADA', {})).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
  })

  it('APROVADA grava parecer + data', async () => {
    prisma.documentoDemanda.findUnique.mockResolvedValue({ id: 'dod1', status: 'AGUARDANDO_PARECER' })
    prisma.documentoDemanda.update.mockResolvedValue({ id: 'dod1' })
    await service.alterarStatus('dod1', 'APROVADA', { responsavel: 'Dra. Ana', observacao: 'ok' })
    const data = prisma.documentoDemanda.update.mock.calls[0][0].data
    expect(data).toMatchObject({ status: 'APROVADA', parecerResponsavel: 'Dra. Ana', parecerObservacao: 'ok' })
    expect(data.parecerData).toBeInstanceOf(Date)
  })
})

describe('DocumentosDemandaService.excluir', () => {
  it('bloqueia fora de RASCUNHO', async () => {
    prisma.documentoDemanda.findUnique.mockResolvedValue({ id: 'dod1', status: 'APROVADA', termoReferencia: null })
    await expect(service.excluir('dod1')).rejects.toMatchObject({ code: 'CONFLITO' })
  })

  it('bloqueia quando possui TR', async () => {
    prisma.documentoDemanda.findUnique.mockResolvedValue({ id: 'dod1', status: 'RASCUNHO', termoReferencia: { id: 'tr1' } })
    await expect(service.excluir('dod1')).rejects.toMatchObject({ code: 'CONFLITO' })
  })

  it('exclui no caminho feliz', async () => {
    prisma.documentoDemanda.findUnique.mockResolvedValue({ id: 'dod1', status: 'RASCUNHO', termoReferencia: null })
    prisma.documentoDemanda.delete.mockResolvedValue({})
    await service.excluir('dod1')
    expect(prisma.documentoDemanda.delete).toHaveBeenCalledWith({ where: { id: 'dod1' } })
  })
})
