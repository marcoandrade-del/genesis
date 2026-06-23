import { describe, it, expect, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'
import { LiquidacoesService } from '../liquidacoes.js'
import { CONTAS_DESPESA } from '../motor-eventos-despesa.js'
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
// contexto da despesa carregado junto ao empenho (p/ o disparo contábil).
const empenhoCtx = { dotacaoDespesaId: 'dot1', dotacaoDespesa: { orcamento: { ano: 2026 } }, subElementoConta: { codigo: '3.3.90.30.07.00' } }
// Plano contábil completo: folhas da despesa + modelo + lançamento criável.
function mockContabil() {
  prisma.entidade.findUnique.mockResolvedValue({ id: 'ent1', municipio: { modeloContabilId: 'm1', estado: { modeloContabilId: 'm1' } } } as never)
  prisma.contaContabilEntidade.findMany.mockResolvedValue(
    Object.values(CONTAS_DESPESA).map((codigo) => ({ id: 'c-' + codigo, codigo, entidadeId: 'ent1', ano: 2026, admiteMovimento: true })) as never,
  )
  prisma.lancamento.create.mockResolvedValue({ id: 'lanc1' } as never)
}
// empenho 500, já liquidado 100 → saldo do empenho (razão) = 400
function mockEmpenho(over: Partial<Record<string, unknown>> = {}) {
  prisma.empenho.findUnique.mockResolvedValue({ id: 'e1', entidadeId: 'ent1', data: new Date('2026-01-05'), status: 'ATIVO', valor: '500', valorLiquidado: '100', ...empenhoCtx, ...over })
  prisma.movimentoEmpenho.findMany.mockResolvedValue([
    { tipo: 'EMPENHO', valor: D(500) },
    { tipo: 'LIQUIDACAO', valor: D(100), liquidacaoId: 'lx' },
  ])
  mockContabil()
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
  it('dispara E700 + E701 (sem de/para → sem patrimonial), origem LIQUIDACAO', async () => {
    mockEmpenho()
    prisma.liquidacao.create.mockResolvedValue({ id: 'l1' })
    await service.criar('ent1', dadosOk({ valor: '300' }), 'u1')
    const lancs = prisma.lancamento.create.mock.calls.map((c) => c[0].data)
    expect(lancs.map((l: { eventoCodigo: string }) => l.eventoCodigo)).toEqual(['700', '701'])
    expect(lancs.every((l: { origemTipo: string; origemId: string }) => l.origemTipo === 'LIQUIDACAO' && l.origemId === 'l1')).toBe(true)
    // E700: D empenhado a liquidar / C liquidado a pagar
    const itens700 = prisma.lancamentoItem.createMany.mock.calls[0][0].data
    expect(itens700.find((i: { tipo: string }) => i.tipo === 'DEBITO').contaId).toBe('c-' + CONTAS_DESPESA.empenhadoALiquidar)
  })

  it('dispara E700 + E701 + E702 patrimonial (D VPD / C passivo) quando há de/para', async () => {
    mockEmpenho()
    const VPD = '3.3.2.1.1.01.00.00.00.00.00.00'
    const PASSIVO = '2.1.3.1.1.01.00.00.00.00.00.00'
    prisma.parametroDespesa.findMany.mockResolvedValue([{ naturezaCodigo: '3.3.90', contaVpdCodigo: VPD, contaPassivoCodigo: PASSIVO }] as never)
    prisma.contaContabilEntidade.findMany.mockResolvedValue(
      [...Object.values(CONTAS_DESPESA), VPD, PASSIVO].map((codigo) => ({ id: 'c-' + codigo, codigo, entidadeId: 'ent1', ano: 2026, admiteMovimento: true })) as never,
    )
    prisma.liquidacao.create.mockResolvedValue({ id: 'l1' })
    await service.criar('ent1', dadosOk({ valor: '300' }), 'u1')
    const lancs = prisma.lancamento.create.mock.calls.map((c) => c[0].data)
    expect(lancs.map((l: { eventoCodigo: string }) => l.eventoCodigo)).toEqual(['700', '701', '702'])
    const itens702 = prisma.lancamentoItem.createMany.mock.calls[2][0].data
    expect(itens702.find((i: { tipo: string }) => i.tipo === 'DEBITO').contaId).toBe('c-' + VPD)
    expect(itens702.find((i: { tipo: string }) => i.tipo === 'CREDITO').contaId).toBe('c-' + PASSIVO)
  })

  it('empenho legado (sem sub-elemento) usa a natureza da dotação no de/para', async () => {
    // subElementoConta null + contaDespesa da dotação no elemento 3.3.90.30
    mockEmpenho({ subElementoConta: null, dotacaoDespesa: { orcamento: { ano: 2026 }, contaDespesa: { codigo: '3.3.90.30.00.00' } } })
    const VPD = '3.3.2.1.1.01.00.00.00.00.00.00'
    const PASSIVO = '2.1.3.1.1.01.00.00.00.00.00.00'
    prisma.parametroDespesa.findMany.mockResolvedValue([{ naturezaCodigo: '3.3.90', contaVpdCodigo: VPD, contaPassivoCodigo: PASSIVO }] as never)
    prisma.contaContabilEntidade.findMany.mockResolvedValue(
      [...Object.values(CONTAS_DESPESA), VPD, PASSIVO].map((codigo) => ({ id: 'c-' + codigo, codigo, entidadeId: 'ent1', ano: 2026, admiteMovimento: true })) as never,
    )
    prisma.liquidacao.create.mockResolvedValue({ id: 'l1' })
    await service.criar('ent1', dadosOk({ valor: '300' }), 'u1')
    // resolve o de/para pela natureza da dotação → patrimonial E702 presente
    const lancs = prisma.lancamento.create.mock.calls.map((c) => c[0].data)
    expect(lancs.map((l: { eventoCodigo: string }) => l.eventoCodigo)).toEqual(['700', '701', '702'])
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
    prisma.liquidacao.findUnique.mockResolvedValue({ id: 'l1', entidadeId: 'ent1', numero: 'LIQ-001', empenhoId: 'e1', valor: D(300), data: new Date('2026-02-01'), empenho: { data: new Date('2026-01-05'), ...empenhoCtx } })
    prisma.movimentoEmpenho.findMany.mockResolvedValue(movimentos)
    mockContabil()
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
