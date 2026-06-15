import { describe, it, expect, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'
import { OrdensPagamentoService } from '../ordens-pagamento.js'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'

let prisma: PrismaMock
let service: OrdensPagamentoService

beforeEach(() => {
  prisma = criarPrismaMock()
  service = new OrdensPagamentoService(prisma as never)
})

function dadosOk(over: Partial<Record<string, unknown>> = {}) {
  return { liquidacaoId: 'l1', numero: 'OP-001', valor: '200', contaBancariaId: 'cb1', ...over } as never
}
// liquidação: valor 300, já pago 100 → disponível 200; empenho na fonte 500
function mockLiq(over: Partial<Record<string, unknown>> = {}) {
  prisma.liquidacao.findUnique.mockResolvedValue({
    id: 'l1',
    entidadeId: 'ent1',
    status: 'ATIVA',
    valor: '300',
    valorPago: '100',
    empenho: { dotacaoDespesa: { fonteRecurso: { codigo: '500', nomenclatura: 'Recursos Livres' } } },
    ...over,
  })
}
// conta bancária ativa da fonte 500 (a mesma do empenho)
function mockConta(over: Partial<Record<string, unknown>> = {}) {
  prisma.contaBancaria.findUnique.mockResolvedValue({
    id: 'cb1', entidadeId: 'ent1', fonteCodigo: '500', ativa: true,
    bancoCodigo: '104', agencia: '0394', agenciaDv: null, numero: '123456', numeroDv: '7', descricao: 'Movimento',
    ...over,
  })
}

describe('OrdensPagamentoService.listar / buscarPorId', () => {
  it('delegam ao prisma com os filtros da entidade/id', async () => {
    prisma.ordemPagamento.findMany.mockResolvedValue([])
    await service.listar('ent1')
    expect(prisma.ordemPagamento.findMany.mock.calls[0][0].where).toEqual({ entidadeId: 'ent1' })
    prisma.ordemPagamento.findUnique.mockResolvedValue(null)
    await service.buscarPorId('op1')
    expect(prisma.ordemPagamento.findUnique.mock.calls[0][0].where).toEqual({ id: 'op1' })
  })
})

describe('OrdensPagamentoService.criar', () => {
  it('exige número da OP e conta bancária (vazios ou ausentes)', async () => {
    await expect(service.criar('ent1', dadosOk({ numero: undefined }))).rejects.toThrow(/Número da OP/)
    mockLiq()
    await expect(service.criar('ent1', dadosOk({ contaBancariaId: '  ' }))).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
    await expect(service.criar('ent1', dadosOk({ contaBancariaId: undefined }))).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
  })
  it('rejeita liquidação inexistente ou de outra entidade', async () => {
    prisma.liquidacao.findUnique.mockResolvedValue(null)
    await expect(service.criar('ent1', dadosOk())).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
    mockLiq({ entidadeId: 'OUTRA' })
    await expect(service.criar('ent1', dadosOk())).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
  })
  it('REGRA 5: rejeita liquidação não-ATIVA', async () => {
    mockLiq({ status: 'CANCELADA' })
    await expect(service.criar('ent1', dadosOk())).rejects.toMatchObject({ code: 'CONFLITO' })
  })
  it('rejeita conta inexistente ou de outra entidade', async () => {
    mockLiq()
    prisma.contaBancaria.findUnique.mockResolvedValue(null)
    await expect(service.criar('ent1', dadosOk())).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
    mockConta({ entidadeId: 'OUTRA' })
    await expect(service.criar('ent1', dadosOk())).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
  })
  it('rejeita conta inativa', async () => {
    mockLiq()
    mockConta({ ativa: false })
    await expect(service.criar('ent1', dadosOk())).rejects.toMatchObject({ code: 'ENTIDADE_NAO_PROCESSAVEL' })
  })
  it('TRAVA conta×fonte: conta de outra fonte não paga o empenho', async () => {
    mockLiq() // fonte do empenho: 500
    mockConta({ fonteCodigo: '540' })
    await expect(service.criar('ent1', dadosOk())).rejects.toThrow(/fonte 500 .* só podem sair de contas bancárias vinculadas a ela/)
    expect(prisma.ordemPagamento.create).not.toHaveBeenCalled()
  })
  it('rejeita pagamento acima do saldo da liquidação', async () => {
    mockLiq() // disponível 200
    mockConta()
    await expect(service.criar('ent1', dadosOk({ valor: '300' }))).rejects.toMatchObject({ code: 'ENTIDADE_NAO_PROCESSAVEL' })
    expect(prisma.ordemPagamento.create).not.toHaveBeenCalled()
  })
  it('emite OP (conta da fonte certa), grava FK + rótulo e incrementa o valorPago', async () => {
    mockLiq()
    mockConta()
    prisma.ordemPagamento.create.mockResolvedValue({ id: 'op1' })
    await service.criar('ent1', dadosOk({ valor: '200' }))
    const data = prisma.ordemPagamento.create.mock.calls[0][0].data
    expect(data.contaBancariaId).toBe('cb1')
    expect(data.contaBancaria).toBe('104 ag. 0394 c/c 123456-7 — Movimento')
    expect(prisma.liquidacao.update.mock.calls[0][0].data.valorPago.increment.toString()).toBe('200')
  })
  it('número duplicado vira CONFLITO; erro inesperado é repropagado', async () => {
    mockLiq()
    mockConta()
    prisma.ordemPagamento.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '7.7.0' }))
    await expect(service.criar('ent1', dadosOk())).rejects.toMatchObject({ code: 'CONFLITO' })
    prisma.ordemPagamento.create.mockRejectedValue(new Error('boom'))
    await expect(service.criar('ent1', dadosOk())).rejects.toThrow('boom')
  })

  it('aceita data e comprovante opcionais', async () => {
    mockLiq()
    mockConta()
    prisma.ordemPagamento.create.mockResolvedValue({ id: 'op1' })
    await service.criar('ent1', dadosOk({ data: '2026-06-12', comprovante: ' TED-1 ' }))
    const data = prisma.ordemPagamento.create.mock.calls[0][0].data
    expect(data.comprovante).toBe('TED-1')
    expect(data.data).toEqual(new Date('2026-06-12'))
  })
})

describe('OrdensPagamentoService.confirmar / cancelar', () => {
  it('confirma OP EMITIDA → PAGA', async () => {
    prisma.ordemPagamento.findUnique.mockResolvedValue({ id: 'op1', status: 'EMITIDA', comprovante: null })
    prisma.ordemPagamento.update.mockResolvedValue({ id: 'op1', status: 'PAGA' })
    await service.confirmarPagamento('op1', 'TED-998')
    expect(prisma.ordemPagamento.update.mock.calls[0][0].data).toMatchObject({ status: 'PAGA', comprovante: 'TED-998' })
  })
  it('confirma sem comprovante preserva o já gravado', async () => {
    prisma.ordemPagamento.findUnique.mockResolvedValue({ id: 'op1', status: 'EMITIDA', comprovante: 'antigo' })
    prisma.ordemPagamento.update.mockResolvedValue({ id: 'op1', status: 'PAGA' })
    await service.confirmarPagamento('op1')
    expect(prisma.ordemPagamento.update.mock.calls[0][0].data.comprovante).toBe('antigo')
  })
  it('não confirma OP já paga', async () => {
    prisma.ordemPagamento.findUnique.mockResolvedValue({ id: 'op1', status: 'PAGA', comprovante: null })
    await expect(service.confirmarPagamento('op1')).rejects.toMatchObject({ code: 'CONFLITO' })
  })
  it('OP inexistente → RECURSO_NAO_ENCONTRADO; cancelar OP já cancelada → CONFLITO', async () => {
    prisma.ordemPagamento.findUnique.mockResolvedValue(null)
    await expect(service.confirmarPagamento('x')).rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
    await expect(service.cancelar('x')).rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
    prisma.ordemPagamento.findUnique.mockResolvedValue({ id: 'op1', status: 'CANCELADA' })
    await expect(service.cancelar('op1')).rejects.toMatchObject({ code: 'CONFLITO' })
  })

  it('cancela e estorna o valor pago', async () => {
    prisma.ordemPagamento.findUnique.mockResolvedValue({ id: 'op1', status: 'EMITIDA', liquidacaoId: 'l1', valor: new Prisma.Decimal('200') })
    prisma.ordemPagamento.update.mockResolvedValue({ id: 'op1', status: 'CANCELADA' })
    await service.cancelar('op1')
    expect(prisma.liquidacao.update.mock.calls[0][0].data.valorPago.decrement.toString()).toBe('200')
  })
})
