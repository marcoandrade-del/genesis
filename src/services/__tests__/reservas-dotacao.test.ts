import { describe, it, expect, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'
import { ReservasDotacaoService, saldoDisponivel } from '../reservas-dotacao.js'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'

let prisma: PrismaMock
let service: ReservasDotacaoService

beforeEach(() => {
  prisma = criarPrismaMock()
  service = new ReservasDotacaoService(prisma as never)
})

function dadosOk(over: Partial<Record<string, unknown>> = {}) {
  return { dotacaoDespesaId: 'dot1', numero: 'R-001', valor: '500', ...over } as never
}

// dotação com saldo disponível = 1000 − 200 − 100 = 700
function mockDotacaoOk(over: Partial<Record<string, unknown>> = {}) {
  prisma.entidade.findUnique.mockResolvedValue({ id: 'ent1' })
  prisma.dotacaoDespesa.findUnique.mockResolvedValue({
    id: 'dot1',
    valorAutorizado: '1000',
    valorReservado: '200',
    valorEmpenhado: '100',
    orcamento: { entidadeId: 'ent1', status: 'EM_EXECUCAO' },
    ...over,
  })
}

function p2002() {
  return new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '7.7.0' })
}

describe('saldoDisponivel', () => {
  it('autorizado − reservado − empenhado', () => {
    const s = saldoDisponivel({
      valorAutorizado: new Prisma.Decimal('1000'),
      valorReservado: new Prisma.Decimal('200'),
      valorEmpenhado: new Prisma.Decimal('100'),
    })
    expect(s.toString()).toBe('700')
  })
})

describe('ReservasDotacaoService.criar — validação', () => {
  it('404 quando entidade não existe', async () => {
    prisma.entidade.findUnique.mockResolvedValue(null)
    await expect(service.criar('ent1', dadosOk())).rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
  })

  it('rejeita número vazio', async () => {
    prisma.entidade.findUnique.mockResolvedValue({ id: 'ent1' })
    await expect(service.criar('ent1', dadosOk({ numero: ' ' }))).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
  })

  it('rejeita valor não positivo', async () => {
    prisma.entidade.findUnique.mockResolvedValue({ id: 'ent1' })
    await expect(service.criar('ent1', dadosOk({ valor: '0' }))).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
  })

  it('rejeita dotação de outra entidade', async () => {
    mockDotacaoOk({ orcamento: { entidadeId: 'outra', status: 'EM_EXECUCAO' } })
    await expect(service.criar('ent1', dadosOk())).rejects.toMatchObject({
      code: 'REQUISICAO_INVALIDA',
      message: expect.stringContaining('Dotação'),
    })
  })

  it('bloqueia reserva contra orçamento RASCUNHO', async () => {
    mockDotacaoOk({ orcamento: { entidadeId: 'ent1', status: 'RASCUNHO' } })
    await expect(service.criar('ent1', dadosOk())).rejects.toMatchObject({ code: 'CONFLITO' })
  })

  it('rejeita TR de outra entidade', async () => {
    mockDotacaoOk()
    prisma.termoReferencia.findUnique.mockResolvedValue({ id: 'tr1', documentoDemanda: { entidadeId: 'outra' } })
    await expect(service.criar('ent1', dadosOk({ termoReferenciaId: 'tr1' }))).rejects.toMatchObject({
      code: 'REQUISICAO_INVALIDA',
      message: expect.stringContaining('Termo'),
    })
  })
})

describe('ReservasDotacaoService.criar — REGRA 1 (saldo)', () => {
  it('rejeita quando valor excede o saldo disponível', async () => {
    mockDotacaoOk() // saldo 700
    await expect(service.criar('ent1', dadosOk({ valor: '800' }))).rejects.toMatchObject({
      code: 'ENTIDADE_NAO_PROCESSAVEL',
    })
    expect(prisma.reservaDotacao.create).not.toHaveBeenCalled()
  })

  it('permite valor igual ao saldo disponível e incrementa o reservado', async () => {
    mockDotacaoOk() // saldo 700
    prisma.reservaDotacao.create.mockResolvedValue({ id: 'res1' })
    await service.criar('ent1', dadosOk({ valor: '700' }))
    expect(prisma.dotacaoDespesa.update).toHaveBeenCalledWith({
      where: { id: 'dot1' },
      data: { valorReservado: { increment: expect.anything() } },
    })
    const inc = prisma.dotacaoDespesa.update.mock.calls[0][0].data.valorReservado.increment
    expect(inc.toString()).toBe('700')
  })

  it('cria com valor abaixo do saldo', async () => {
    mockDotacaoOk()
    prisma.reservaDotacao.create.mockResolvedValue({ id: 'res1' })
    await service.criar('ent1', dadosOk({ valor: '500' }))
    expect(prisma.reservaDotacao.create).toHaveBeenCalled()
    const data = prisma.reservaDotacao.create.mock.calls[0][0].data
    expect(data).toMatchObject({ entidadeId: 'ent1', dotacaoDespesaId: 'dot1', numero: 'R-001', termoReferenciaId: null })
    expect(data.valor.toString()).toBe('500')
  })

  it('número duplicado vira CONFLITO', async () => {
    mockDotacaoOk()
    prisma.reservaDotacao.create.mockRejectedValue(p2002())
    await expect(service.criar('ent1', dadosOk())).rejects.toMatchObject({ code: 'CONFLITO' })
  })
})

describe('ReservasDotacaoService.cancelar', () => {
  it('404 quando não existe', async () => {
    prisma.reservaDotacao.findUnique.mockResolvedValue(null)
    await expect(service.cancelar('x')).rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
  })

  it('só cancela reserva ATIVA', async () => {
    prisma.reservaDotacao.findUnique.mockResolvedValue({ id: 'res1', status: 'CANCELADA', dotacaoDespesaId: 'dot1', valor: new Prisma.Decimal('500') })
    await expect(service.cancelar('res1')).rejects.toMatchObject({ code: 'CONFLITO' })
  })

  it('cancela e estorna o reservado', async () => {
    prisma.reservaDotacao.findUnique.mockResolvedValue({ id: 'res1', status: 'ATIVA', dotacaoDespesaId: 'dot1', valor: new Prisma.Decimal('500') })
    prisma.reservaDotacao.update.mockResolvedValue({ id: 'res1', status: 'CANCELADA' })
    await service.cancelar('res1')
    expect(prisma.reservaDotacao.update).toHaveBeenCalledWith({ where: { id: 'res1' }, data: { status: 'CANCELADA' } })
    const dec = prisma.dotacaoDespesa.update.mock.calls[0][0].data.valorReservado.decrement
    expect(dec.toString()).toBe('500')
  })
})
