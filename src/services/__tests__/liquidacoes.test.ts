import { describe, it, expect, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'
import { LiquidacoesService } from '../liquidacoes.js'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'

let prisma: PrismaMock
let service: LiquidacoesService

beforeEach(() => {
  prisma = criarPrismaMock()
  service = new LiquidacoesService(prisma as never)
})

function dadosOk(over: Partial<Record<string, unknown>> = {}) {
  return { empenhoId: 'e1', numero: 'LIQ-001', valor: '300', notaFiscal: 'NF-1', ...over } as never
}
const D = (v: string | number) => new Prisma.Decimal(v)
// empenho 500, já liquidado 100 → saldo do empenho (razão) = 400
function mockEmpenho(over: Partial<Record<string, unknown>> = {}) {
  prisma.empenho.findUnique.mockResolvedValue({ id: 'e1', entidadeId: 'ent1', data: new Date('2026-01-05'), status: 'ATIVO', valor: '500', valorLiquidado: '100', ...over })
  prisma.movimentoEmpenho.findMany.mockResolvedValue([
    { tipo: 'EMPENHO', valor: D(500) },
    { tipo: 'LIQUIDACAO', valor: D(100), liquidacaoId: 'lx' },
  ])
}

describe('LiquidacoesService.criar', () => {
  it('REGRA 5: rejeita empenho não-ATIVO', async () => {
    mockEmpenho({ status: 'ANULADO' })
    await expect(service.criar('ent1', dadosOk())).rejects.toMatchObject({ code: 'CONFLITO' })
  })
  it('rejeita empenho de outra entidade', async () => {
    mockEmpenho({ entidadeId: 'outra' })
    await expect(service.criar('ent1', dadosOk())).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
  })
  it('REGRA 4: rejeita liquidação que excede o saldo do empenho', async () => {
    mockEmpenho() // disponível 400
    await expect(service.criar('ent1', dadosOk({ valor: '500' }))).rejects.toMatchObject({ code: 'ENTIDADE_NAO_PROCESSAVEL' })
    expect(prisma.liquidacao.create).not.toHaveBeenCalled()
  })
  it('liquida e incrementa o valorLiquidado do empenho', async () => {
    mockEmpenho()
    prisma.liquidacao.create.mockResolvedValue({ id: 'l1' })
    await service.criar('ent1', dadosOk({ valor: '400' }), 'u1') // = disponível
    expect(prisma.liquidacao.create).toHaveBeenCalled()
    expect(prisma.empenho.update.mock.calls[0][0].data.valorLiquidado.increment.toString()).toBe('400')
    // razão: lançamento LIQUIDACAO na ficha do empenho
    const m = prisma.movimentoEmpenho.create.mock.calls[0][0].data
    expect(m).toMatchObject({ tipo: 'LIQUIDACAO', empenhoId: 'e1', liquidacaoId: 'l1', criadoPorId: 'u1' })
    expect(m.valor.toString()).toBe('400')
  })
  it('rejeita liquidação com data anterior ao empenho', async () => {
    mockEmpenho() // empenho em 2026-01-05
    await expect(service.criar('ent1', dadosOk({ valor: '100', data: '2026-01-04' }), 'u1')).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
    expect(prisma.liquidacao.create).not.toHaveBeenCalled()
  })
  it('número duplicado vira CONFLITO', async () => {
    mockEmpenho()
    prisma.liquidacao.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '7.7.0' }))
    await expect(service.criar('ent1', dadosOk())).rejects.toMatchObject({ code: 'CONFLITO' })
  })
})

describe('LiquidacoesService.estornar', () => {
  // liquidação L1 de 300 (na razão), sem pagamento → saldo da liquidação = 300
  function mockL1(movimentos: unknown[]) {
    prisma.liquidacao.findUnique.mockResolvedValue({ id: 'l1', entidadeId: 'ent1', numero: 'LIQ-001', empenhoId: 'e1', valor: D(300), data: new Date('2026-02-01'), empenho: { data: new Date('2026-01-05') } })
    prisma.movimentoEmpenho.findMany.mockResolvedValue(movimentos)
  }
  it('estorno total zera o liquidado e marca CANCELADA', async () => {
    mockL1([{ tipo: 'EMPENHO', valor: D(500) }, { tipo: 'LIQUIDACAO', valor: D(300), liquidacaoId: 'l1' }])
    prisma.liquidacao.update.mockResolvedValue({ id: 'l1', status: 'CANCELADA' })
    await service.estornar('l1', '300', 'u1', new Date('2026-03-01'))
    expect(prisma.empenho.update.mock.calls[0][0].data.valorLiquidado.decrement.toString()).toBe('300')
    const m = prisma.movimentoEmpenho.create.mock.calls[0][0].data
    expect(m).toMatchObject({ tipo: 'ESTORNO_LIQUIDACAO', empenhoId: 'e1', liquidacaoId: 'l1', criadoPorId: 'u1' })
    expect(m.valor.toString()).toBe('300')
    expect(prisma.liquidacao.update).toHaveBeenCalledWith({ where: { id: 'l1' }, data: { status: 'CANCELADA' } })
  })
  it('estorno parcial não cancela a liquidação', async () => {
    mockL1([{ tipo: 'EMPENHO', valor: D(500) }, { tipo: 'LIQUIDACAO', valor: D(300), liquidacaoId: 'l1' }])
    await service.estornar('l1', '100', 'u1', new Date('2026-03-01'))
    expect(prisma.liquidacao.update).not.toHaveBeenCalled()
    expect(prisma.movimentoEmpenho.create.mock.calls[0][0].data.valor.toString()).toBe('100')
  })
  it('estorno acima do saldo da liquidação (parte não paga) é rejeitado', async () => {
    // L1 liquidada 300, paga 200 → saldo da liquidação = 100
    mockL1([{ tipo: 'EMPENHO', valor: D(500) }, { tipo: 'LIQUIDACAO', valor: D(300), liquidacaoId: 'l1' }, { tipo: 'PAGAMENTO', valor: D(200), liquidacaoId: 'l1', ordemPagamentoId: 'p1' }])
    await expect(service.estornar('l1', '101', 'u1', new Date('2026-03-01'))).rejects.toMatchObject({ code: 'ENTIDADE_NAO_PROCESSAVEL' })
    expect(prisma.movimentoEmpenho.create).not.toHaveBeenCalled()
  })
  it('liquidação inexistente → RECURSO_NAO_ENCONTRADO', async () => {
    prisma.liquidacao.findUnique.mockResolvedValue(null)
    await expect(service.estornar('x', '10', 'u1')).rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
  })
})
