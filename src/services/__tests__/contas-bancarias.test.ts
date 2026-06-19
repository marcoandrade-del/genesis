import { describe, it, expect, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'
import { ContasBancariasService, rotuloConta } from '../contas-bancarias.js'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'

let prisma: PrismaMock
let service: ContasBancariasService

beforeEach(() => {
  prisma = criarPrismaMock()
  service = new ContasBancariasService(prisma as never)
})

const CONTA = {
  id: 'cb1', entidadeId: 'ent1', fonteCodigo: '500', bancoCodigo: '104', bancoNome: 'Caixa',
  agencia: '0394', agenciaDv: null, numero: '123456', numeroDv: '7', descricao: 'Movimento', ativa: true,
}

function dadosOk(over: Partial<Record<string, unknown>> = {}) {
  return {
    fonteCodigo: '500', bancoCodigo: '104', bancoNome: 'Caixa', agencia: '0394',
    agenciaDv: '', numero: '123456', numeroDv: '7', descricao: 'Movimento', ...over,
  }
}

function mockFonteExiste() {
  prisma.fonteRecursoEntidade.findUnique.mockResolvedValue({ codigo: '500' })
}

describe('rotuloConta', () => {
  it('monta o rótulo Febraban com e sem DVs/descrição', () => {
    expect(rotuloConta(CONTA)).toBe('104 ag. 0394 c/c 123456-7 — Movimento')
    expect(rotuloConta({ ...CONTA, agenciaDv: '2', numeroDv: null, descricao: null })).toBe('104 ag. 0394-2 c/c 123456')
  })
})

describe('ContasBancariasService.listar / listarFontes / contasDaFonte', () => {
  it('listar junta a nomenclatura da fonte do exercício e o rótulo', async () => {
    prisma.contaBancaria.findMany.mockResolvedValue([CONTA, { ...CONTA, id: 'cb2', fonteCodigo: '999' }])
    prisma.fonteRecursoEntidade.findMany.mockResolvedValue([{ codigo: '500', nomenclatura: 'Recursos Livres' }])
    const r = await service.listar('ent1', 2026)
    expect(r[0]).toMatchObject({ fonteNomenclatura: 'Recursos Livres', rotulo: '104 ag. 0394 c/c 123456-7 — Movimento' })
    expect(r[1]!.fonteNomenclatura).toBeNull() // fonte fora do exercício
  })

  it('listarFontes consulta as fontes do exercício', async () => {
    prisma.fonteRecursoEntidade.findMany.mockResolvedValue([{ codigo: '500', nomenclatura: 'Livres' }])
    expect(await service.listarFontes('ent1', 2026)).toHaveLength(1)
    expect(prisma.fonteRecursoEntidade.findMany.mock.calls[0][0].where).toEqual({ entidadeId: 'ent1', ano: 2026 })
  })

  it('contasDaFonte devolve só ativas da fonte, com rótulo', async () => {
    prisma.contaBancaria.findMany.mockResolvedValue([CONTA])
    const r = await service.contasDaFonte('ent1', '500')
    expect(prisma.contaBancaria.findMany.mock.calls[0][0].where).toEqual({ entidadeId: 'ent1', fonteCodigo: '500', ativa: true })
    expect(r[0]!.rotulo).toContain('104 ag. 0394')
  })
})

describe('ContasBancariasService.criar', () => {
  it('cria com dados saneados (DV maiúsculo, opcionais nulos)', async () => {
    mockFonteExiste()
    prisma.contaBancaria.create.mockResolvedValue(CONTA)
    await service.criar('ent1', 2026, dadosOk({ numeroDv: 'x', bancoNome: '  ', descricao: '' }))
    expect(prisma.contaBancaria.create.mock.calls[0][0].data).toEqual({
      entidadeId: 'ent1', fonteCodigo: '500', bancoCodigo: '104', bancoNome: null,
      agencia: '0394', agenciaDv: null, numero: '123456', numeroDv: 'X', descricao: null,
      contaContabilCodigo: null,
    })
  })

  it('valida os campos Febraban', async () => {
    await expect(service.criar('ent1', 2026, dadosOk({ fonteCodigo: ' ' }))).rejects.toThrow(/fonte de recurso/i)
    await expect(service.criar('ent1', 2026, dadosOk({ bancoCodigo: '10' }))).rejects.toThrow(/3 dígitos/)
    await expect(service.criar('ent1', 2026, dadosOk({ bancoCodigo: 'ABC' }))).rejects.toThrow(/3 dígitos/)
    await expect(service.criar('ent1', 2026, dadosOk({ agencia: '12345' }))).rejects.toThrow(/Agência/)
    await expect(service.criar('ent1', 2026, dadosOk({ agenciaDv: '12' }))).rejects.toThrow(/DV da agência/)
    await expect(service.criar('ent1', 2026, dadosOk({ numero: '1234567890123' }))).rejects.toThrow(/Número da conta/)
    await expect(service.criar('ent1', 2026, dadosOk({ numeroDv: 'ZZ' }))).rejects.toThrow(/DV da conta/)
    expect(prisma.contaBancaria.create).not.toHaveBeenCalled()
  })

  it('campos ausentes (form vazio) caem na primeira validação', async () => {
    await expect(service.criar('ent1', 2026, {})).rejects.toThrow(/fonte de recurso/i)
  })

  it('DVs vazios viram null; DV preenchido é normalizado para maiúscula', async () => {
    mockFonteExiste()
    prisma.contaBancaria.create.mockResolvedValue(CONTA)
    await service.criar('ent1', 2026, dadosOk({ agenciaDv: 'x', numeroDv: '' }))
    const data = prisma.contaBancaria.create.mock.calls[0][0].data
    expect(data.agenciaDv).toBe('X')
    expect(data.numeroDv).toBeNull()
  })

  it('rejeita fonte que não existe no exercício da entidade', async () => {
    prisma.fonteRecursoEntidade.findUnique.mockResolvedValue(null)
    await expect(service.criar('ent1', 2026, dadosOk({ fonteCodigo: '777' }))).rejects.toThrow(/Fonte 777 não existe .* 2026/)
  })

  it('duplicada (banco+agência+conta) vira CONFLITO', async () => {
    mockFonteExiste()
    prisma.contaBancaria.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '7.7.0' }))
    await expect(service.criar('ent1', 2026, dadosOk())).rejects.toMatchObject({ code: 'CONFLITO' })
  })

  it('erro inesperado do banco é repropagado', async () => {
    mockFonteExiste()
    prisma.contaBancaria.create.mockRejectedValue(new Error('boom'))
    await expect(service.criar('ent1', 2026, dadosOk())).rejects.toThrow('boom')
  })
})

describe('ContasBancariasService.atualizar / alternarAtiva / excluir', () => {
  it('atualizar exige conta da entidade e revalida', async () => {
    prisma.contaBancaria.findUnique.mockResolvedValue(null)
    await expect(service.atualizar('x', 'ent1', 2026, dadosOk())).rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
    prisma.contaBancaria.findUnique.mockResolvedValue({ ...CONTA, entidadeId: 'OUTRA' })
    await expect(service.atualizar('cb1', 'ent1', 2026, dadosOk())).rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
  })

  it('atualizar grava os dados saneados', async () => {
    prisma.contaBancaria.findUnique.mockResolvedValue(CONTA)
    mockFonteExiste()
    prisma.contaBancaria.update.mockResolvedValue(CONTA)
    await service.atualizar('cb1', 'ent1', 2026, dadosOk({ descricao: ' Folha ' }))
    expect(prisma.contaBancaria.update.mock.calls[0][0].data.descricao).toBe('Folha')
  })

  it('atualizar duplicando vira CONFLITO', async () => {
    prisma.contaBancaria.findUnique.mockResolvedValue(CONTA)
    mockFonteExiste()
    prisma.contaBancaria.update.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '7.7.0' }))
    await expect(service.atualizar('cb1', 'ent1', 2026, dadosOk())).rejects.toMatchObject({ code: 'CONFLITO' })
  })

  it('atualizar com erro inesperado repropaga', async () => {
    prisma.contaBancaria.findUnique.mockResolvedValue(CONTA)
    mockFonteExiste()
    prisma.contaBancaria.update.mockRejectedValue(new Error('boom'))
    await expect(service.atualizar('cb1', 'ent1', 2026, dadosOk())).rejects.toThrow('boom')
  })

  it('alternarAtiva inverte o flag e exige conta da entidade', async () => {
    prisma.contaBancaria.findUnique.mockResolvedValue(CONTA)
    prisma.contaBancaria.update.mockResolvedValue({ ...CONTA, ativa: false })
    await service.alternarAtiva('cb1', 'ent1')
    expect(prisma.contaBancaria.update.mock.calls[0][0].data).toEqual({ ativa: false })
    prisma.contaBancaria.findUnique.mockResolvedValue(null)
    await expect(service.alternarAtiva('x', 'ent1')).rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
  })

  it('excluir só conta nunca usada em OP', async () => {
    prisma.contaBancaria.findUnique.mockResolvedValue(CONTA)
    prisma.ordemPagamento.count.mockResolvedValue(2)
    await expect(service.excluir('cb1', 'ent1')).rejects.toThrow(/usada em 2 ordem/)
    expect(prisma.contaBancaria.delete).not.toHaveBeenCalled()

    prisma.ordemPagamento.count.mockResolvedValue(0)
    prisma.contaBancaria.delete.mockResolvedValue(CONTA)
    await service.excluir('cb1', 'ent1')
    expect(prisma.contaBancaria.delete).toHaveBeenCalledWith({ where: { id: 'cb1' } })
  })
})
