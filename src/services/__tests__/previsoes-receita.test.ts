import { describe, it, expect, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'
import { PrevisoesReceitaService } from '../previsoes-receita.js'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'

const ORC_RASCUNHO = { id: 'o1', entidadeId: 'ent1', ano: 2026, status: 'RASCUNHO' }

let prisma: PrismaMock
let service: PrevisoesReceitaService

beforeEach(() => {
  prisma = criarPrismaMock()
  service = new PrevisoesReceitaService(prisma as never)
})

function dadosOk(over: Partial<Record<string, unknown>> = {}) {
  return {
    contaReceitaEntidadeId: 'cr1',
    fonteRecursoEntidadeId: 'fr1',
    valorPrevisto: '5000',
    ...over,
  } as never
}

function mockRefsOk() {
  prisma.contaReceitaEntidade.findUnique.mockResolvedValue({
    id: 'cr1',
    entidadeId: 'ent1',
    ano: 2026,
    admiteMovimento: true,
  })
  prisma.fonteRecursoEntidade.findUnique.mockResolvedValue({ id: 'fr1', entidadeId: 'ent1', ano: 2026 })
}

describe('PrevisoesReceitaService.listar', () => {
  it('lista por orçamento com includes', async () => {
    prisma.previsaoReceita.findMany.mockResolvedValue([])
    await service.listar('o1')
    expect(prisma.previsaoReceita.findMany).toHaveBeenCalledWith({
      where: { orcamentoId: 'o1' },
      include: { contaReceita: true, fonteRecurso: true },
      orderBy: { criadoEm: 'asc' },
    })
  })
})

describe('PrevisoesReceitaService.buscarPorId', () => {
  it('chama findUnique', async () => {
    prisma.previsaoReceita.findUnique.mockResolvedValue(null)
    await service.buscarPorId('p1')
    expect(prisma.previsaoReceita.findUnique).toHaveBeenCalledWith({ where: { id: 'p1' } })
  })
})

describe('PrevisoesReceitaService.criar — validação', () => {
  it('rejeita contaReceitaEntidadeId vazio/ausente', async () => {
    await expect(service.criar('o1', dadosOk({ contaReceitaEntidadeId: '' }))).rejects.toMatchObject({
      code: 'REQUISICAO_INVALIDA',
    })
    await expect(service.criar('o1', dadosOk({ contaReceitaEntidadeId: undefined }))).rejects.toMatchObject({
      code: 'REQUISICAO_INVALIDA',
    })
    await expect(service.criar('o1', dadosOk({ contaReceitaEntidadeId: 123 }))).rejects.toMatchObject({
      code: 'REQUISICAO_INVALIDA',
    })
  })

  it('rejeita fonteRecursoEntidadeId vazio', async () => {
    await expect(service.criar('o1', dadosOk({ fonteRecursoEntidadeId: '   ' }))).rejects.toMatchObject({
      code: 'REQUISICAO_INVALIDA',
    })
  })

  it('rejeita valor ausente', async () => {
    await expect(service.criar('o1', dadosOk({ valorPrevisto: '' }))).rejects.toMatchObject({
      code: 'REQUISICAO_INVALIDA',
    })
    await expect(service.criar('o1', dadosOk({ valorPrevisto: null }))).rejects.toMatchObject({
      code: 'REQUISICAO_INVALIDA',
    })
  })

  it('rejeita valor não-numérico', async () => {
    await expect(service.criar('o1', dadosOk({ valorPrevisto: 'abc' }))).rejects.toMatchObject({
      code: 'REQUISICAO_INVALIDA',
    })
  })

  it('rejeita valor negativo', async () => {
    await expect(service.criar('o1', dadosOk({ valorPrevisto: '-100' }))).rejects.toMatchObject({
      code: 'REQUISICAO_INVALIDA',
    })
  })
})

describe('PrevisoesReceitaService.criar — orcamento e referências', () => {
  it('404 quando orçamento não existe', async () => {
    prisma.orcamento.findUnique.mockResolvedValue(null)
    await expect(service.criar('o1', dadosOk())).rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
  })

  it('bloqueia se orçamento não é RASCUNHO', async () => {
    prisma.orcamento.findUnique.mockResolvedValue({ ...ORC_RASCUNHO, status: 'APROVADO' })
    await expect(service.criar('o1', dadosOk())).rejects.toMatchObject({ code: 'CONFLITO' })
  })

  it('rejeita conta inexistente', async () => {
    prisma.orcamento.findUnique.mockResolvedValue(ORC_RASCUNHO)
    mockRefsOk()
    prisma.contaReceitaEntidade.findUnique.mockResolvedValue(null)
    await expect(service.criar('o1', dadosOk())).rejects.toMatchObject({
      code: 'REQUISICAO_INVALIDA',
      message: expect.stringContaining('Conta'),
    })
  })

  it('rejeita conta de outra entidade', async () => {
    prisma.orcamento.findUnique.mockResolvedValue(ORC_RASCUNHO)
    mockRefsOk()
    prisma.contaReceitaEntidade.findUnique.mockResolvedValue({
      id: 'cr1',
      entidadeId: 'outra',
      ano: 2026,
      admiteMovimento: true,
    })
    await expect(service.criar('o1', dadosOk())).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
  })

  it('rejeita conta de outro ano', async () => {
    prisma.orcamento.findUnique.mockResolvedValue(ORC_RASCUNHO)
    mockRefsOk()
    prisma.contaReceitaEntidade.findUnique.mockResolvedValue({
      id: 'cr1',
      entidadeId: 'ent1',
      ano: 2025,
      admiteMovimento: true,
    })
    await expect(service.criar('o1', dadosOk())).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
  })

  it('rejeita conta sintética', async () => {
    prisma.orcamento.findUnique.mockResolvedValue(ORC_RASCUNHO)
    mockRefsOk()
    prisma.contaReceitaEntidade.findUnique.mockResolvedValue({
      id: 'cr1',
      entidadeId: 'ent1',
      ano: 2026,
      admiteMovimento: false,
    })
    await expect(service.criar('o1', dadosOk())).rejects.toMatchObject({
      code: 'REQUISICAO_INVALIDA',
      message: expect.stringContaining('analítica'),
    })
  })

  it('rejeita fonte inexistente', async () => {
    prisma.orcamento.findUnique.mockResolvedValue(ORC_RASCUNHO)
    mockRefsOk()
    prisma.fonteRecursoEntidade.findUnique.mockResolvedValue(null)
    await expect(service.criar('o1', dadosOk())).rejects.toMatchObject({
      code: 'REQUISICAO_INVALIDA',
      message: expect.stringContaining('Fonte'),
    })
  })

  it('rejeita fonte de outra entidade/ano', async () => {
    prisma.orcamento.findUnique.mockResolvedValue(ORC_RASCUNHO)
    mockRefsOk()
    prisma.fonteRecursoEntidade.findUnique.mockResolvedValue({ id: 'fr1', entidadeId: 'outra', ano: 2026 })
    await expect(service.criar('o1', dadosOk())).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
  })
})

describe('PrevisoesReceitaService.criar — caminho feliz', () => {
  it('cria com sucesso', async () => {
    prisma.orcamento.findUnique.mockResolvedValue(ORC_RASCUNHO)
    mockRefsOk()
    prisma.previsaoReceita.create.mockResolvedValue({ id: 'p1' })
    await service.criar('o1', dadosOk())
    expect(prisma.previsaoReceita.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orcamentoId: 'o1',
        contaReceitaEntidadeId: 'cr1',
        fonteRecursoEntidadeId: 'fr1',
      }),
    })
  })

  it('duplicidade vira CONFLITO', async () => {
    prisma.orcamento.findUnique.mockResolvedValue(ORC_RASCUNHO)
    mockRefsOk()
    prisma.previsaoReceita.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '7.7.0' }),
    )
    await expect(service.criar('o1', dadosOk())).rejects.toMatchObject({ code: 'CONFLITO' })
  })

  it('repassa outros erros', async () => {
    prisma.orcamento.findUnique.mockResolvedValue(ORC_RASCUNHO)
    mockRefsOk()
    prisma.previsaoReceita.create.mockRejectedValue(new Error('boom'))
    await expect(service.criar('o1', dadosOk())).rejects.toThrow('boom')
  })
})

describe('PrevisoesReceitaService.atualizar', () => {
  it('404 quando não existe', async () => {
    prisma.previsaoReceita.findUnique.mockResolvedValue(null)
    await expect(service.atualizar('xx', dadosOk())).rejects.toMatchObject({
      code: 'RECURSO_NAO_ENCONTRADO',
    })
  })

  it('atualiza no caminho feliz', async () => {
    prisma.previsaoReceita.findUnique.mockResolvedValue({ id: 'p1', orcamentoId: 'o1' })
    prisma.orcamento.findUnique.mockResolvedValue(ORC_RASCUNHO)
    mockRefsOk()
    prisma.previsaoReceita.update.mockResolvedValue({ id: 'p1' })
    await service.atualizar('p1', dadosOk({ valorPrevisto: '7000' }))
    expect(prisma.previsaoReceita.update.mock.calls[0][0].data.valorPrevisto.toString()).toBe('7000')
  })

  it('bloqueia se orçamento não é RASCUNHO', async () => {
    prisma.previsaoReceita.findUnique.mockResolvedValue({ id: 'p1', orcamentoId: 'o1' })
    prisma.orcamento.findUnique.mockResolvedValue({ ...ORC_RASCUNHO, status: 'EM_EXECUCAO' })
    await expect(service.atualizar('p1', dadosOk())).rejects.toMatchObject({ code: 'CONFLITO' })
  })

  it('P2002 vira CONFLITO', async () => {
    prisma.previsaoReceita.findUnique.mockResolvedValue({ id: 'p1', orcamentoId: 'o1' })
    prisma.orcamento.findUnique.mockResolvedValue(ORC_RASCUNHO)
    mockRefsOk()
    prisma.previsaoReceita.update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '7.7.0' }),
    )
    await expect(service.atualizar('p1', dadosOk())).rejects.toMatchObject({ code: 'CONFLITO' })
  })

  it('repassa outros erros', async () => {
    prisma.previsaoReceita.findUnique.mockResolvedValue({ id: 'p1', orcamentoId: 'o1' })
    prisma.orcamento.findUnique.mockResolvedValue(ORC_RASCUNHO)
    mockRefsOk()
    prisma.previsaoReceita.update.mockRejectedValue(new Error('boom'))
    await expect(service.atualizar('p1', dadosOk())).rejects.toThrow('boom')
  })
})

describe('PrevisoesReceitaService.excluir', () => {
  it('404 quando não existe', async () => {
    prisma.previsaoReceita.findUnique.mockResolvedValue(null)
    await expect(service.excluir('xx')).rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
  })

  it('bloqueia se orçamento não é RASCUNHO', async () => {
    prisma.previsaoReceita.findUnique.mockResolvedValue({ id: 'p1', orcamentoId: 'o1' })
    prisma.orcamento.findUnique.mockResolvedValue({ ...ORC_RASCUNHO, status: 'APROVADO' })
    await expect(service.excluir('p1')).rejects.toMatchObject({ code: 'CONFLITO' })
  })

  it('exclui no caminho feliz', async () => {
    prisma.previsaoReceita.findUnique.mockResolvedValue({ id: 'p1', orcamentoId: 'o1' })
    prisma.orcamento.findUnique.mockResolvedValue(ORC_RASCUNHO)
    prisma.previsaoReceita.delete.mockResolvedValue({})
    await service.excluir('p1')
    expect(prisma.previsaoReceita.delete).toHaveBeenCalledWith({ where: { id: 'p1' } })
  })
})
