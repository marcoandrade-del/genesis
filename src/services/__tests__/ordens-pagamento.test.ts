import { describe, it, expect, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'
import { OrdensPagamentoService } from '../ordens-pagamento.js'
import { CONTAS_DESPESA } from '../motor-eventos-despesa.js'
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
// liquidação 300, já pago 100 (na razão) → saldo da liquidação = 200; empenho na fonte 500
function mockLiq(over: Partial<Record<string, unknown>> = {}) {
  prisma.liquidacao.findUnique.mockResolvedValue({
    id: 'l1',
    entidadeId: 'ent1',
    empenhoId: 'e1',
    data: new Date('2026-01-10'),
    status: 'ATIVA',
    valor: '300',
    valorPago: '100',
    empenho: { data: new Date('2026-01-05'), ...empenhoCtx, dotacaoDespesa: { orcamento: { ano: 2026 }, fonteRecurso: { codigo: '500', nomenclatura: 'Recursos Livres' } } },
    ...over,
  })
  prisma.movimentoEmpenho.findMany.mockResolvedValue([
    { tipo: 'EMPENHO', valor: D(500) },
    { tipo: 'LIQUIDACAO', valor: D(300), liquidacaoId: 'l1' },
    { tipo: 'PAGAMENTO', valor: D(100), liquidacaoId: 'l1', ordemPagamentoId: 'p0' },
  ])
  mockContabil()
}
// conta bancária ativa da fonte 500 (a mesma do empenho); caixa default (folha no plano)
function mockConta(over: Partial<Record<string, unknown>> = {}) {
  prisma.contaBancaria.findUnique.mockResolvedValue({
    id: 'cb1', entidadeId: 'ent1', fonteCodigo: '500', ativa: true, contaContabilCodigo: null,
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
    await service.criar('ent1', dadosOk({ valor: '200' }), 'u1')
    const data = prisma.ordemPagamento.create.mock.calls[0][0].data
    expect(data.contaBancariaId).toBe('cb1')
    expect(data.contaBancaria).toBe('104 ag. 0394 c/c 123456-7 — Movimento')
    expect(prisma.liquidacao.update.mock.calls[0][0].data.valorPago.increment.toString()).toBe('200')
    // razão: lançamento PAGAMENTO na ficha do empenho
    const m = prisma.movimentoEmpenho.create.mock.calls[0][0].data
    expect(m).toMatchObject({ tipo: 'PAGAMENTO', empenhoId: 'e1', liquidacaoId: 'l1', ordemPagamentoId: 'op1', criadoPorId: 'u1' })
    expect(m.valor.toString()).toBe('200')
  })
  it('dispara E800 + E801 (sem de/para), origem PAGAMENTO, com cc=dotação', async () => {
    mockLiq()
    mockConta()
    prisma.ordemPagamento.create.mockResolvedValue({ id: 'op1' })
    await service.criar('ent1', dadosOk({ valor: '200' }), 'u1')
    const lancs = prisma.lancamento.create.mock.calls.map((c) => c[0].data)
    expect(lancs.map((l: { eventoCodigo: string }) => l.eventoCodigo)).toEqual(['800', '801'])
    expect(lancs.every((l: { origemTipo: string; origemId: string }) => l.origemTipo === 'PAGAMENTO' && l.origemId === 'op1')).toBe(true)
    // E800: D liquidado a pagar / C pago; conta-corrente = dotação
    const itens800 = prisma.lancamentoItem.createMany.mock.calls[0][0].data
    expect(itens800.find((i: { tipo: string }) => i.tipo === 'DEBITO').contaId).toBe('c-' + CONTAS_DESPESA.liquidadoAPagar)
    expect(itens800.every((i: { dotacaoDespesaId: string }) => i.dotacaoDespesaId === 'dot1')).toBe(true)
  })

  it('rejeita pagamento com data anterior à liquidação', async () => {
    mockLiq() // liquidação em 2026-01-10
    mockConta()
    await expect(service.criar('ent1', dadosOk({ valor: '200', data: '2026-01-09' }), 'u1')).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
    expect(prisma.ordemPagamento.create).not.toHaveBeenCalled()
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
  it('OP inexistente → RECURSO_NAO_ENCONTRADO', async () => {
    prisma.ordemPagamento.findUnique.mockResolvedValue(null)
    await expect(service.confirmarPagamento('x')).rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
    await expect(service.estornar('x', '10', 'u1')).rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
  })

  // OP op1: paga 200 (na razão) → pode estornar até 200
  function mockOp() {
    prisma.ordemPagamento.findUnique.mockResolvedValue({
      id: 'op1', entidadeId: 'ent1', numero: 'OP-1', status: 'PAGA', liquidacaoId: 'l1', valor: D(200), data: new Date('2026-02-01'),
      contaBancariaRef: { contaContabilCodigo: null },
      liquidacao: { empenhoId: 'e1', empenho: { dotacaoDespesaId: 'dot1', dotacaoDespesa: { orcamento: { ano: 2026 } }, subElementoConta: { codigo: '3.3.90.30.07.00' } } },
    })
    prisma.movimentoEmpenho.findMany.mockResolvedValue([
      { tipo: 'EMPENHO', valor: D(500) },
      { tipo: 'LIQUIDACAO', valor: D(300), liquidacaoId: 'l1' },
      { tipo: 'PAGAMENTO', valor: D(200), liquidacaoId: 'l1', ordemPagamentoId: 'op1' },
    ])
    mockContabil()
  }
  it('estorno total do pagamento zera o pago e marca CANCELADA', async () => {
    mockOp()
    prisma.ordemPagamento.update.mockResolvedValue({ id: 'op1', status: 'CANCELADA' })
    await service.estornar('op1', '200', 'u1', new Date('2026-03-01'))
    expect(prisma.liquidacao.update.mock.calls[0][0].data.valorPago.decrement.toString()).toBe('200')
    const m = prisma.movimentoEmpenho.create.mock.calls[0][0].data
    expect(m).toMatchObject({ tipo: 'ESTORNO_PAGAMENTO', empenhoId: 'e1', liquidacaoId: 'l1', ordemPagamentoId: 'op1', criadoPorId: 'u1' })
    expect(m.valor.toString()).toBe('200')
    expect(prisma.ordemPagamento.update).toHaveBeenCalledWith({ where: { id: 'op1' }, data: { status: 'CANCELADA' } })
  })
  it('estorno parcial não cancela a OP', async () => {
    mockOp()
    await service.estornar('op1', '50', 'u1', new Date('2026-03-01'))
    expect(prisma.ordemPagamento.update).not.toHaveBeenCalled()
    expect(prisma.movimentoEmpenho.create.mock.calls[0][0].data.valor.toString()).toBe('50')
  })
  it('estorno acima do pago da OP é rejeitado', async () => {
    mockOp()
    await expect(service.estornar('op1', '201', 'u1', new Date('2026-03-01'))).rejects.toMatchObject({ code: 'ENTIDADE_NAO_PROCESSAVEL' })
    expect(prisma.movimentoEmpenho.create).not.toHaveBeenCalled()
  })
})
