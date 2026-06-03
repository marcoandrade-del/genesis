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
  return { liquidacaoId: 'l1', numero: 'OP-001', valor: '200', contaBancaria: 'BB 1234-5 / 6789-0', ...over } as never
}
// liquidação: valor 300, já pago 100 → disponível 200
function mockLiq(over: Partial<Record<string, unknown>> = {}) {
  prisma.liquidacao.findUnique.mockResolvedValue({ id: 'l1', entidadeId: 'ent1', status: 'ATIVA', valor: '300', valorPago: '100', ...over })
}

describe('OrdensPagamentoService.criar', () => {
  it('exige conta bancária', async () => {
    mockLiq()
    await expect(service.criar('ent1', dadosOk({ contaBancaria: '  ' }))).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
  })
  it('REGRA 5: rejeita liquidação não-ATIVA', async () => {
    mockLiq({ status: 'CANCELADA' })
    await expect(service.criar('ent1', dadosOk())).rejects.toMatchObject({ code: 'CONFLITO' })
  })
  it('rejeita pagamento acima do saldo da liquidação', async () => {
    mockLiq() // disponível 200
    await expect(service.criar('ent1', dadosOk({ valor: '300' }))).rejects.toMatchObject({ code: 'ENTIDADE_NAO_PROCESSAVEL' })
    expect(prisma.ordemPagamento.create).not.toHaveBeenCalled()
  })
  it('emite OP e incrementa o valorPago da liquidação', async () => {
    mockLiq()
    prisma.ordemPagamento.create.mockResolvedValue({ id: 'op1' })
    await service.criar('ent1', dadosOk({ valor: '200' }))
    expect(prisma.liquidacao.update.mock.calls[0][0].data.valorPago.increment.toString()).toBe('200')
  })
  it('número duplicado vira CONFLITO', async () => {
    mockLiq()
    prisma.ordemPagamento.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '7.7.0' }))
    await expect(service.criar('ent1', dadosOk())).rejects.toMatchObject({ code: 'CONFLITO' })
  })
})

describe('OrdensPagamentoService.confirmar / cancelar', () => {
  it('confirma OP EMITIDA → PAGA', async () => {
    prisma.ordemPagamento.findUnique.mockResolvedValue({ id: 'op1', status: 'EMITIDA', comprovante: null })
    prisma.ordemPagamento.update.mockResolvedValue({ id: 'op1', status: 'PAGA' })
    await service.confirmarPagamento('op1', 'TED-998')
    expect(prisma.ordemPagamento.update.mock.calls[0][0].data).toMatchObject({ status: 'PAGA', comprovante: 'TED-998' })
  })
  it('não confirma OP já paga', async () => {
    prisma.ordemPagamento.findUnique.mockResolvedValue({ id: 'op1', status: 'PAGA', comprovante: null })
    await expect(service.confirmarPagamento('op1')).rejects.toMatchObject({ code: 'CONFLITO' })
  })
  it('cancela e estorna o valor pago', async () => {
    prisma.ordemPagamento.findUnique.mockResolvedValue({ id: 'op1', status: 'EMITIDA', liquidacaoId: 'l1', valor: new Prisma.Decimal('200') })
    prisma.ordemPagamento.update.mockResolvedValue({ id: 'op1', status: 'CANCELADA' })
    await service.cancelar('op1')
    expect(prisma.liquidacao.update.mock.calls[0][0].data.valorPago.decrement.toString()).toBe('200')
  })
})
