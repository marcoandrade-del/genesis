import { describe, it, expect, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'
import { DotacoesDespesaService } from '../dotacoes-despesa.js'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'

const ORC_RASCUNHO = { id: 'o1', entidadeId: 'ent1', ano: 2026, status: 'RASCUNHO' }

let prisma: PrismaMock
let service: DotacoesDespesaService

beforeEach(() => {
  prisma = criarPrismaMock()
  service = new DotacoesDespesaService(prisma as never)
})

function dadosOk(over: Partial<Record<string, unknown>> = {}) {
  return {
    unidadeOrcamentariaId: 'uo1',
    funcaoId: 'f1',
    subfuncaoId: 's1',
    programaId: 'p1',
    acaoId: 'a1',
    contaDespesaEntidadeId: 'cd1',
    fonteRecursoEntidadeId: 'fr1',
    valorAutorizado: '1000.50',
    ...over,
  } as never
}

function mockReferenciasOk() {
  prisma.unidadeOrcamentaria.findUnique.mockResolvedValue({ id: 'uo1', entidadeId: 'ent1' })
  prisma.subfuncao.findUnique.mockResolvedValue({ id: 's1', funcaoId: 'f1' })
  prisma.programa.findUnique.mockResolvedValue({ id: 'p1', entidadeId: 'ent1', ano: 2026 })
  prisma.acao.findUnique.mockResolvedValue({ id: 'a1', programaId: 'p1' })
  prisma.contaDespesaEntidade.findUnique.mockResolvedValue({
    id: 'cd1',
    entidadeId: 'ent1',
    ano: 2026,
    admiteMovimento: true,
  })
  prisma.fonteRecursoEntidade.findUnique.mockResolvedValue({ id: 'fr1', entidadeId: 'ent1', ano: 2026 })
}

describe('DotacoesDespesaService.listar', () => {
  it('lista por orcamentoId com includes', async () => {
    prisma.dotacaoDespesa.findMany.mockResolvedValue([])
    await service.listar('o1')
    expect(prisma.dotacaoDespesa.findMany).toHaveBeenCalledWith({
      where: { orcamentoId: 'o1' },
      include: {
        unidadeOrcamentaria: true,
        funcao: true,
        subfuncao: true,
        programa: true,
        acao: true,
        contaDespesa: true,
        fonteRecurso: true,
      },
      orderBy: { criadoEm: 'asc' },
    })
  })
})

describe('DotacoesDespesaService.buscarPorId', () => {
  it('chama findUnique', async () => {
    prisma.dotacaoDespesa.findUnique.mockResolvedValue(null)
    await service.buscarPorId('d1')
    expect(prisma.dotacaoDespesa.findUnique).toHaveBeenCalledWith({ where: { id: 'd1' } })
  })
})

describe('DotacoesDespesaService.criar — validação de campos', () => {
  it.each([
    'unidadeOrcamentariaId',
    'funcaoId',
    'subfuncaoId',
    'programaId',
    'acaoId',
    'contaDespesaEntidadeId',
    'fonteRecursoEntidadeId',
  ])('rejeita campo vazio: %s', async (campo) => {
    await expect(service.criar('o1', dadosOk({ [campo]: '   ' }))).rejects.toMatchObject({
      code: 'REQUISICAO_INVALIDA',
    })
  })

  it('rejeita campo undefined', async () => {
    await expect(service.criar('o1', dadosOk({ funcaoId: undefined }))).rejects.toMatchObject({
      code: 'REQUISICAO_INVALIDA',
    })
  })

  it('rejeita campo não-string', async () => {
    await expect(service.criar('o1', dadosOk({ funcaoId: 123 }))).rejects.toMatchObject({
      code: 'REQUISICAO_INVALIDA',
    })
  })

  it('rejeita valor ausente', async () => {
    await expect(service.criar('o1', dadosOk({ valorAutorizado: '' }))).rejects.toMatchObject({
      code: 'REQUISICAO_INVALIDA',
    })
    await expect(service.criar('o1', dadosOk({ valorAutorizado: null }))).rejects.toMatchObject({
      code: 'REQUISICAO_INVALIDA',
    })
  })

  it('rejeita valor não-numérico', async () => {
    await expect(service.criar('o1', dadosOk({ valorAutorizado: 'abc' }))).rejects.toMatchObject({
      code: 'REQUISICAO_INVALIDA',
    })
  })

  it('rejeita valor negativo', async () => {
    await expect(service.criar('o1', dadosOk({ valorAutorizado: '-1' }))).rejects.toMatchObject({
      code: 'REQUISICAO_INVALIDA',
    })
  })
})

describe('DotacoesDespesaService.criar — orcamento e referências', () => {
  it('404 quando orçamento não existe', async () => {
    prisma.orcamento.findUnique.mockResolvedValue(null)
    await expect(service.criar('o1', dadosOk())).rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
  })

  it('bloqueia quando orçamento não é RASCUNHO', async () => {
    prisma.orcamento.findUnique.mockResolvedValue({ ...ORC_RASCUNHO, status: 'APROVADO' })
    await expect(service.criar('o1', dadosOk())).rejects.toMatchObject({ code: 'CONFLITO' })
  })

  it('rejeita UO de outra entidade', async () => {
    prisma.orcamento.findUnique.mockResolvedValue(ORC_RASCUNHO)
    mockReferenciasOk()
    prisma.unidadeOrcamentaria.findUnique.mockResolvedValue({ id: 'uo1', entidadeId: 'outra' })
    await expect(service.criar('o1', dadosOk())).rejects.toMatchObject({
      code: 'REQUISICAO_INVALIDA',
      message: expect.stringContaining('Unidade'),
    })
  })

  it('rejeita UO inexistente', async () => {
    prisma.orcamento.findUnique.mockResolvedValue(ORC_RASCUNHO)
    mockReferenciasOk()
    prisma.unidadeOrcamentaria.findUnique.mockResolvedValue(null)
    await expect(service.criar('o1', dadosOk())).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
  })

  it('rejeita subfunção de outra função', async () => {
    prisma.orcamento.findUnique.mockResolvedValue(ORC_RASCUNHO)
    mockReferenciasOk()
    prisma.subfuncao.findUnique.mockResolvedValue({ id: 's1', funcaoId: 'outra' })
    await expect(service.criar('o1', dadosOk())).rejects.toMatchObject({
      code: 'REQUISICAO_INVALIDA',
      message: expect.stringContaining('Subfunção'),
    })
  })

  it('rejeita subfunção inexistente', async () => {
    prisma.orcamento.findUnique.mockResolvedValue(ORC_RASCUNHO)
    mockReferenciasOk()
    prisma.subfuncao.findUnique.mockResolvedValue(null)
    await expect(service.criar('o1', dadosOk())).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
  })

  it('rejeita programa de outro ano', async () => {
    prisma.orcamento.findUnique.mockResolvedValue(ORC_RASCUNHO)
    mockReferenciasOk()
    prisma.programa.findUnique.mockResolvedValue({ id: 'p1', entidadeId: 'ent1', ano: 2025 })
    await expect(service.criar('o1', dadosOk())).rejects.toMatchObject({
      code: 'REQUISICAO_INVALIDA',
      message: expect.stringContaining('Programa'),
    })
  })

  it('rejeita programa de outra entidade', async () => {
    prisma.orcamento.findUnique.mockResolvedValue(ORC_RASCUNHO)
    mockReferenciasOk()
    prisma.programa.findUnique.mockResolvedValue({ id: 'p1', entidadeId: 'outra', ano: 2026 })
    await expect(service.criar('o1', dadosOk())).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
  })

  it('rejeita programa inexistente', async () => {
    prisma.orcamento.findUnique.mockResolvedValue(ORC_RASCUNHO)
    mockReferenciasOk()
    prisma.programa.findUnique.mockResolvedValue(null)
    await expect(service.criar('o1', dadosOk())).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
  })

  it('rejeita ação de outro programa', async () => {
    prisma.orcamento.findUnique.mockResolvedValue(ORC_RASCUNHO)
    mockReferenciasOk()
    prisma.acao.findUnique.mockResolvedValue({ id: 'a1', programaId: 'outro' })
    await expect(service.criar('o1', dadosOk())).rejects.toMatchObject({
      code: 'REQUISICAO_INVALIDA',
      message: expect.stringContaining('Ação'),
    })
  })

  it('rejeita ação inexistente', async () => {
    prisma.orcamento.findUnique.mockResolvedValue(ORC_RASCUNHO)
    mockReferenciasOk()
    prisma.acao.findUnique.mockResolvedValue(null)
    await expect(service.criar('o1', dadosOk())).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
  })

  it('rejeita conta de outra entidade', async () => {
    prisma.orcamento.findUnique.mockResolvedValue(ORC_RASCUNHO)
    mockReferenciasOk()
    prisma.contaDespesaEntidade.findUnique.mockResolvedValue({
      id: 'cd1',
      entidadeId: 'outra',
      ano: 2026,
      admiteMovimento: true,
    })
    await expect(service.criar('o1', dadosOk())).rejects.toMatchObject({
      code: 'REQUISICAO_INVALIDA',
      message: expect.stringContaining('Conta'),
    })
  })

  it('rejeita conta de outro ano', async () => {
    prisma.orcamento.findUnique.mockResolvedValue(ORC_RASCUNHO)
    mockReferenciasOk()
    prisma.contaDespesaEntidade.findUnique.mockResolvedValue({
      id: 'cd1',
      entidadeId: 'ent1',
      ano: 2025,
      admiteMovimento: true,
    })
    await expect(service.criar('o1', dadosOk())).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
  })

  it('rejeita conta inexistente', async () => {
    prisma.orcamento.findUnique.mockResolvedValue(ORC_RASCUNHO)
    mockReferenciasOk()
    prisma.contaDespesaEntidade.findUnique.mockResolvedValue(null)
    await expect(service.criar('o1', dadosOk())).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
  })

  it('rejeita conta sintética (não admite movimento)', async () => {
    prisma.orcamento.findUnique.mockResolvedValue(ORC_RASCUNHO)
    mockReferenciasOk()
    prisma.contaDespesaEntidade.findUnique.mockResolvedValue({
      id: 'cd1',
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
    mockReferenciasOk()
    prisma.fonteRecursoEntidade.findUnique.mockResolvedValue(null)
    await expect(service.criar('o1', dadosOk())).rejects.toMatchObject({
      code: 'REQUISICAO_INVALIDA',
      message: expect.stringContaining('Fonte'),
    })
  })

  it('rejeita fonte de outra entidade', async () => {
    prisma.orcamento.findUnique.mockResolvedValue(ORC_RASCUNHO)
    mockReferenciasOk()
    prisma.fonteRecursoEntidade.findUnique.mockResolvedValue({ id: 'fr1', entidadeId: 'outra', ano: 2026 })
    await expect(service.criar('o1', dadosOk())).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
  })
})

describe('DotacoesDespesaService.criar — caminho feliz e erros', () => {
  it('cria com todos os campos válidos', async () => {
    prisma.orcamento.findUnique.mockResolvedValue(ORC_RASCUNHO)
    mockReferenciasOk()
    prisma.dotacaoDespesa.create.mockResolvedValue({ id: 'd1' })
    await service.criar('o1', dadosOk())
    expect(prisma.dotacaoDespesa.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orcamentoId: 'o1',
        unidadeOrcamentariaId: 'uo1',
        funcaoId: 'f1',
        subfuncaoId: 's1',
        programaId: 'p1',
        acaoId: 'a1',
        contaDespesaEntidadeId: 'cd1',
        fonteRecursoEntidadeId: 'fr1',
      }),
    })
    expect(prisma.dotacaoDespesa.create.mock.calls[0][0].data.valorAutorizado.toString()).toBe('1000.5')
  })

  it('combinação duplicada vira CONFLITO', async () => {
    prisma.orcamento.findUnique.mockResolvedValue(ORC_RASCUNHO)
    mockReferenciasOk()
    prisma.dotacaoDespesa.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '7.7.0' }),
    )
    await expect(service.criar('o1', dadosOk())).rejects.toMatchObject({ code: 'CONFLITO' })
  })

  it('repassa outros erros', async () => {
    prisma.orcamento.findUnique.mockResolvedValue(ORC_RASCUNHO)
    mockReferenciasOk()
    prisma.dotacaoDespesa.create.mockRejectedValue(new Error('boom'))
    await expect(service.criar('o1', dadosOk())).rejects.toThrow('boom')
  })
})

describe('DotacoesDespesaService.atualizar', () => {
  it('404 quando não existe', async () => {
    prisma.dotacaoDespesa.findUnique.mockResolvedValue(null)
    await expect(service.atualizar('xx', dadosOk())).rejects.toMatchObject({
      code: 'RECURSO_NAO_ENCONTRADO',
    })
  })

  it('atualiza no caminho feliz', async () => {
    prisma.dotacaoDespesa.findUnique.mockResolvedValue({ id: 'd1', orcamentoId: 'o1' })
    prisma.orcamento.findUnique.mockResolvedValue(ORC_RASCUNHO)
    mockReferenciasOk()
    prisma.dotacaoDespesa.update.mockResolvedValue({ id: 'd1' })
    await service.atualizar('d1', dadosOk({ valorAutorizado: '2000' }))
    expect(prisma.dotacaoDespesa.update.mock.calls[0][0].data.valorAutorizado.toString()).toBe('2000')
  })

  it('bloqueia se orçamento não é RASCUNHO', async () => {
    prisma.dotacaoDespesa.findUnique.mockResolvedValue({ id: 'd1', orcamentoId: 'o1' })
    prisma.orcamento.findUnique.mockResolvedValue({ ...ORC_RASCUNHO, status: 'EM_EXECUCAO' })
    await expect(service.atualizar('d1', dadosOk())).rejects.toMatchObject({ code: 'CONFLITO' })
  })

  it('P2002 vira CONFLITO na atualização', async () => {
    prisma.dotacaoDespesa.findUnique.mockResolvedValue({ id: 'd1', orcamentoId: 'o1' })
    prisma.orcamento.findUnique.mockResolvedValue(ORC_RASCUNHO)
    mockReferenciasOk()
    prisma.dotacaoDespesa.update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '7.7.0' }),
    )
    await expect(service.atualizar('d1', dadosOk())).rejects.toMatchObject({ code: 'CONFLITO' })
  })

  it('repassa outros erros na atualização', async () => {
    prisma.dotacaoDespesa.findUnique.mockResolvedValue({ id: 'd1', orcamentoId: 'o1' })
    prisma.orcamento.findUnique.mockResolvedValue(ORC_RASCUNHO)
    mockReferenciasOk()
    prisma.dotacaoDespesa.update.mockRejectedValue(new Error('boom'))
    await expect(service.atualizar('d1', dadosOk())).rejects.toThrow('boom')
  })
})

describe('DotacoesDespesaService.excluir', () => {
  it('404 quando não existe', async () => {
    prisma.dotacaoDespesa.findUnique.mockResolvedValue(null)
    await expect(service.excluir('xx')).rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
  })

  it('bloqueia se orçamento não é RASCUNHO', async () => {
    prisma.dotacaoDespesa.findUnique.mockResolvedValue({ id: 'd1', orcamentoId: 'o1' })
    prisma.orcamento.findUnique.mockResolvedValue({ ...ORC_RASCUNHO, status: 'APROVADO' })
    await expect(service.excluir('d1')).rejects.toMatchObject({ code: 'CONFLITO' })
  })

  it('exclui no caminho feliz', async () => {
    prisma.dotacaoDespesa.findUnique.mockResolvedValue({ id: 'd1', orcamentoId: 'o1' })
    prisma.orcamento.findUnique.mockResolvedValue(ORC_RASCUNHO)
    prisma.dotacaoDespesa.delete.mockResolvedValue({})
    await service.excluir('d1')
    expect(prisma.dotacaoDespesa.delete).toHaveBeenCalledWith({ where: { id: 'd1' } })
  })
})
