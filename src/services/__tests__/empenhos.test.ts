import { describe, it, expect, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'
import { EmpenhosService } from '../empenhos.js'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'

let prisma: PrismaMock
let service: EmpenhosService

beforeEach(() => {
  prisma = criarPrismaMock()
  service = new EmpenhosService(prisma as never)
})

function dadosOk(over: Partial<Record<string, unknown>> = {}) {
  return { dotacaoDespesaId: 'dot1', fornecedorId: 'f1', numero: '2026NE001', tipo: 'ORDINARIO', valor: '500', ...over } as never
}
// dotação: disponível = 1000 − 200 − 100 = 700
function mockBase(dotacaoOver: Partial<Record<string, unknown>> = {}) {
  prisma.entidade.findUnique.mockResolvedValue({ id: 'ent1' })
  prisma.fornecedor.findUnique.mockResolvedValue({ id: 'f1', ativo: true })
  prisma.dotacaoDespesa.findUnique.mockResolvedValue({
    id: 'dot1', valorAutorizado: '1000', valorReservado: '200', valorEmpenhado: '100',
    orcamento: { entidadeId: 'ent1', status: 'EM_EXECUCAO' }, ...dotacaoOver,
  })
}
function mockReserva(over: Partial<Record<string, unknown>> = {}) {
  prisma.reservaDotacao.findUnique.mockResolvedValue({ id: 'r1', entidadeId: 'ent1', dotacaoDespesaId: 'dot1', valor: new Prisma.Decimal('500'), status: 'ATIVA', ...over })
}

describe('EmpenhosService.criar — validação', () => {
  it('rejeita tipo inválido', async () => {
    prisma.entidade.findUnique.mockResolvedValue({ id: 'ent1' })
    await expect(service.criar('ent1', dadosOk({ tipo: 'XX' }))).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
  })
  it('rejeita fornecedor inativo', async () => {
    prisma.entidade.findUnique.mockResolvedValue({ id: 'ent1' })
    prisma.fornecedor.findUnique.mockResolvedValue({ id: 'f1', ativo: false })
    await expect(service.criar('ent1', dadosOk())).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
  })
  it('bloqueia dotação de orçamento RASCUNHO', async () => {
    mockBase({ orcamento: { entidadeId: 'ent1', status: 'RASCUNHO' } })
    await expect(service.criar('ent1', dadosOk())).rejects.toMatchObject({ code: 'CONFLITO' })
  })
})

describe('EmpenhosService.criar — empenho direto (sem reserva)', () => {
  it('rejeita valor acima do saldo disponível', async () => {
    mockBase()
    await expect(service.criar('ent1', dadosOk({ valor: '800' }))).rejects.toMatchObject({ code: 'ENTIDADE_NAO_PROCESSAVEL' })
    expect(prisma.empenho.create).not.toHaveBeenCalled()
  })
  it('empenha e incrementa o empenhado', async () => {
    mockBase()
    prisma.empenho.create.mockResolvedValue({ id: 'e1' })
    await service.criar('ent1', dadosOk({ valor: '500' }))
    const upd = prisma.dotacaoDespesa.update.mock.calls[0][0]
    expect(upd.data.valorEmpenhado.increment.toString()).toBe('500')
    expect(upd.data.valorReservado).toBeUndefined()
  })
})

describe('EmpenhosService.criar — REGRA 2 (conversão de reserva)', () => {
  it('rejeita empenho maior que a reserva', async () => {
    mockBase()
    mockReserva()
    await expect(service.criar('ent1', dadosOk({ reservaDotacaoId: 'r1', valor: '600' }))).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
  })
  it('rejeita reserva não-ATIVA', async () => {
    mockBase()
    mockReserva({ status: 'BAIXADA' })
    await expect(service.criar('ent1', dadosOk({ reservaDotacaoId: 'r1' }))).rejects.toMatchObject({ code: 'CONFLITO' })
  })
  it('rejeita reserva de outra dotação', async () => {
    mockBase()
    mockReserva({ dotacaoDespesaId: 'outra' })
    await expect(service.criar('ent1', dadosOk({ reservaDotacaoId: 'r1' }))).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
  })
  it('baixa a reserva e move reservado→empenhado', async () => {
    mockBase()
    mockReserva()
    prisma.empenho.create.mockResolvedValue({ id: 'e1' })
    await service.criar('ent1', dadosOk({ reservaDotacaoId: 'r1', valor: '500' }))
    expect(prisma.reservaDotacao.update).toHaveBeenCalledWith({ where: { id: 'r1' }, data: { status: 'BAIXADA' } })
    const upd = prisma.dotacaoDespesa.update.mock.calls[0][0].data
    expect(upd.valorReservado.decrement.toString()).toBe('500')
    expect(upd.valorEmpenhado.increment.toString()).toBe('500')
  })
})

describe('EmpenhosService.anular', () => {
  it('bloqueia empenho com liquidações', async () => {
    prisma.empenho.findUnique.mockResolvedValue({ id: 'e1', status: 'ATIVO', valorLiquidado: '100', dotacaoDespesaId: 'dot1', valor: new Prisma.Decimal('500') })
    await expect(service.anular('e1')).rejects.toMatchObject({ code: 'CONFLITO' })
  })
  it('anula e estorna o empenhado', async () => {
    prisma.empenho.findUnique.mockResolvedValue({ id: 'e1', status: 'ATIVO', valorLiquidado: '0', dotacaoDespesaId: 'dot1', valor: new Prisma.Decimal('500') })
    prisma.empenho.update.mockResolvedValue({ id: 'e1', status: 'ANULADO' })
    await service.anular('e1')
    expect(prisma.dotacaoDespesa.update.mock.calls[0][0].data.valorEmpenhado.decrement.toString()).toBe('500')
  })
})
