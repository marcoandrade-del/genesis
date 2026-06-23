import { describe, it, expect, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'
import { EmpenhosService } from '../empenhos.js'
import { CONTAS_DESPESA } from '../motor-eventos-despesa.js'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'

let prisma: PrismaMock
let service: EmpenhosService

beforeEach(() => {
  prisma = criarPrismaMock()
  service = new EmpenhosService(prisma as never)
})

function dadosOk(over: Partial<Record<string, unknown>> = {}) {
  return { dotacaoDespesaId: 'dot1', fornecedorId: 'f1', numero: '2026NE001', tipo: 'ORDINARIO', valor: '500', subElementoContaId: 'sub1', ...over } as never
}
// Plano contábil completo: folhas da despesa + lançamento criável (disparo da Tabela de Eventos).
function mockContabil() {
  prisma.entidade.findUnique.mockResolvedValue({ id: 'ent1' } as never)
  prisma.contaContabilEntidade.findMany.mockResolvedValue(
    Object.values(CONTAS_DESPESA).map((codigo) => ({ id: 'c-' + codigo, codigo, entidadeId: 'ent1', ano: 2026, admiteMovimento: true })) as never,
  )
  prisma.lancamento.create.mockResolvedValue({ id: 'lanc1' } as never)
}
// dotação: disponível = 1000 − 200 − 100 = 700; natureza no elemento 3.3.90.30
function mockBase(dotacaoOver: Partial<Record<string, unknown>> = {}) {
  prisma.entidade.findUnique.mockResolvedValue({ id: 'ent1' })
  prisma.fornecedor.findUnique.mockResolvedValue({ id: 'f1', ativo: true })
  prisma.dotacaoDespesa.findUnique.mockResolvedValue({
    id: 'dot1', valorAutorizado: '1000', valorReservado: '200', valorEmpenhado: '100',
    orcamento: { entidadeId: 'ent1', status: 'EM_EXECUCAO', ano: 2026 }, contaDespesa: { codigo: '3.3.90.30.00.00' }, ...dotacaoOver,
  })
  // sub-elemento válido: folha analítica sob o elemento 3.3.90.30
  prisma.contaDespesaEntidade.findUnique.mockResolvedValue({ id: 'sub1', entidadeId: 'ent1', ano: 2026, admiteMovimento: true, codigo: '3.3.90.30.07.00' } as never)
  mockContabil()
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
  it('exige sub-elemento (obrigatório)', async () => {
    mockBase()
    await expect(service.criar('ent1', dadosOk({ subElementoContaId: '' }), 'u1')).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
    expect(prisma.empenho.create).not.toHaveBeenCalled()
  })
  it('rejeita sub-elemento fora do elemento da dotação', async () => {
    mockBase()
    // sub-elemento de outro elemento (3.3.90.39 ≠ 3.3.90.30)
    prisma.contaDespesaEntidade.findUnique.mockResolvedValue({ id: 'sub1', entidadeId: 'ent1', ano: 2026, admiteMovimento: true, codigo: '3.3.90.39.57.00' } as never)
    await expect(service.criar('ent1', dadosOk(), 'u1')).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
    expect(prisma.empenho.create).not.toHaveBeenCalled()
  })
  it('rejeita sub-elemento sintético (não-folha)', async () => {
    mockBase()
    prisma.contaDespesaEntidade.findUnique.mockResolvedValue({ id: 'sub1', entidadeId: 'ent1', ano: 2026, admiteMovimento: false, codigo: '3.3.90.30.07.00' } as never)
    await expect(service.criar('ent1', dadosOk(), 'u1')).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
  })
  it('empenha e incrementa o empenhado', async () => {
    mockBase()
    prisma.empenho.create.mockResolvedValue({ id: 'e1', data: new Date('2026-02-01') })
    await service.criar('ent1', dadosOk({ valor: '500' }), 'u1')
    const upd = prisma.dotacaoDespesa.update.mock.calls[0][0]
    expect(upd.data.valorEmpenhado.increment.toString()).toBe('500')
    expect(upd.data.valorReservado).toBeUndefined()
    // razão: lançamento EMPENHO na ficha
    const m = prisma.movimentoEmpenho.create.mock.calls[0][0].data
    expect(m).toMatchObject({ tipo: 'EMPENHO', empenhoId: 'e1', criadoPorId: 'u1' })
    expect(m.valor.toString()).toBe('500')
  })

  it('dispara os lançamentos contábeis E600 + E601 (origem EMPENHO, cc=dotação)', async () => {
    mockBase()
    prisma.empenho.create.mockResolvedValue({ id: 'e1', data: new Date('2026-02-01') })
    await service.criar('ent1', dadosOk({ valor: '500' }), 'u1')
    const lancs = prisma.lancamento.create.mock.calls.map((c) => c[0].data)
    expect(lancs.map((l: { eventoCodigo: string }) => l.eventoCodigo)).toEqual(['600', '601'])
    expect(lancs.every((l: { origemTipo: string; origemId: string }) => l.origemTipo === 'EMPENHO' && l.origemId === 'e1')).toBe(true)
    // E600: D crédito disponível / C empenhado a liquidar; conta-corrente = dotação
    const itens600 = prisma.lancamentoItem.createMany.mock.calls[0][0].data
    const deb = itens600.find((i: { tipo: string }) => i.tipo === 'DEBITO')
    const cred = itens600.find((i: { tipo: string }) => i.tipo === 'CREDITO')
    expect(deb.contaId).toBe('c-' + CONTAS_DESPESA.creditoDisponivel)
    expect(cred.contaId).toBe('c-' + CONTAS_DESPESA.empenhadoALiquidar)
    expect(itens600.every((i: { dotacaoDespesaId: string }) => i.dotacaoDespesaId === 'dot1')).toBe(true)
  })

  it('falha (rollback) se o plano não tiver as folhas da despesa', async () => {
    mockBase()
    prisma.contaContabilEntidade.findMany.mockResolvedValue([] as never) // plano incompleto
    prisma.empenho.create.mockResolvedValue({ id: 'e1', data: new Date('2026-02-01') })
    await expect(service.criar('ent1', dadosOk({ valor: '500' }), 'u1')).rejects.toMatchObject({ code: 'ENTIDADE_NAO_PROCESSAVEL' })
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
    prisma.empenho.create.mockResolvedValue({ id: 'e1', data: new Date('2026-02-01') })
    await service.criar('ent1', dadosOk({ reservaDotacaoId: 'r1', valor: '500' }))
    expect(prisma.reservaDotacao.update).toHaveBeenCalledWith({ where: { id: 'r1' }, data: { status: 'BAIXADA' } })
    const upd = prisma.dotacaoDespesa.update.mock.calls[0][0].data
    expect(upd.valorReservado.decrement.toString()).toBe('500')
    expect(upd.valorEmpenhado.increment.toString()).toBe('500')
  })
})

describe('EmpenhosService.estornar', () => {
  // empenho 500 (na razão) → saldo do empenho = 500
  function mockEmp(movimentos: unknown[]) {
    prisma.empenho.findUnique.mockResolvedValue({
      id: 'e1', entidadeId: 'ent1', numero: '2026NE001', dotacaoDespesaId: 'dot1', data: new Date('2026-01-05'),
      dotacaoDespesa: { orcamento: { ano: 2026 }, contaDespesa: { codigo: '3.3.90.30.00.00' } },
    })
    prisma.movimentoEmpenho.findMany.mockResolvedValue(movimentos)
    mockContabil()
  }
  it('estorno total zera o empenhado e marca ANULADO', async () => {
    mockEmp([{ tipo: 'EMPENHO', valor: new Prisma.Decimal('500') }])
    prisma.empenho.update.mockResolvedValue({ id: 'e1', status: 'ANULADO' })
    await service.estornar('e1', '500', 'u1', new Date('2026-02-01'))
    expect(prisma.dotacaoDespesa.update.mock.calls[0][0].data.valorEmpenhado.decrement.toString()).toBe('500')
    const m = prisma.movimentoEmpenho.create.mock.calls[0][0].data
    expect(m).toMatchObject({ tipo: 'ESTORNO_EMPENHO', empenhoId: 'e1', criadoPorId: 'u1' })
    expect(m.valor.toString()).toBe('500')
    expect(prisma.empenho.update).toHaveBeenCalledWith({ where: { id: 'e1' }, data: { status: 'ANULADO' } })
  })
  it('estorno parcial não anula', async () => {
    mockEmp([{ tipo: 'EMPENHO', valor: new Prisma.Decimal('500') }])
    await service.estornar('e1', '200', 'u1', new Date('2026-02-01'))
    expect(prisma.empenho.update).not.toHaveBeenCalled()
    expect(prisma.movimentoEmpenho.create.mock.calls[0][0].data.valor.toString()).toBe('200')
  })
  it('dispara o estorno contábil invertendo cada par D↔C', async () => {
    mockEmp([{ tipo: 'EMPENHO', valor: new Prisma.Decimal('500') }])
    await service.estornar('e1', '200', 'u1', new Date('2026-02-01'))
    const lancs = prisma.lancamento.create.mock.calls.map((c) => c[0].data)
    expect(lancs.map((l: { eventoCodigo: string }) => l.eventoCodigo)).toEqual(['600', '601'])
    expect(lancs.every((l: { origemTipo: string }) => l.origemTipo === 'EMPENHO')).toBe(true)
    // E600 invertido: D empenhado a liquidar / C crédito disponível; valor = estorno
    const itens600 = prisma.lancamentoItem.createMany.mock.calls[0][0].data
    const deb = itens600.find((i: { tipo: string }) => i.tipo === 'DEBITO')
    expect(deb.contaId).toBe('c-' + CONTAS_DESPESA.empenhadoALiquidar)
    expect(deb.valor.toString()).toBe('200')
  })
  it('estorno acima do saldo a liquidar é rejeitado', async () => {
    // empenho 500, liquidado 400 → saldo do empenho = 100
    mockEmp([{ tipo: 'EMPENHO', valor: new Prisma.Decimal('500') }, { tipo: 'LIQUIDACAO', valor: new Prisma.Decimal('400'), liquidacaoId: 'l1' }])
    await expect(service.estornar('e1', '101', 'u1', new Date('2026-02-01'))).rejects.toMatchObject({ code: 'ENTIDADE_NAO_PROCESSAVEL' })
    expect(prisma.movimentoEmpenho.create).not.toHaveBeenCalled()
  })
  it('empenho inexistente → RECURSO_NAO_ENCONTRADO', async () => {
    prisma.empenho.findUnique.mockResolvedValue(null)
    await expect(service.estornar('x', '10', 'u1')).rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
  })
})

describe('EmpenhosService.ficha', () => {
  it('monta empenho + movimentos + resumo das 6 colunas', async () => {
    prisma.empenho.findUnique.mockResolvedValue({ id: 'e1', numero: '2026NE1', entidadeId: 'ent1', fornecedor: { razaoSocial: 'ACME' }, dotacaoDespesa: {} })
    prisma.movimentoEmpenho.findMany.mockResolvedValue([
      { tipo: 'EMPENHO', valor: new Prisma.Decimal('1000') },
      { tipo: 'LIQUIDACAO', valor: new Prisma.Decimal('400'), liquidacaoId: 'l1' },
      { tipo: 'ESTORNO_EMPENHO', valor: new Prisma.Decimal('200') },
    ])
    const f = await service.ficha('e1')
    expect(f.empenho.numero).toBe('2026NE1')
    expect(f.movimentos).toHaveLength(3)
    expect(f.resumo.netEmpenhado.toNumber()).toBe(800) // 1000 − 200
    expect(f.resumo.saldoEmpenho.toNumber()).toBe(400) // net empenhado 800 − liquidado 400
  })
  it('empenho inexistente → RECURSO_NAO_ENCONTRADO', async () => {
    prisma.empenho.findUnique.mockResolvedValue(null)
    await expect(service.ficha('x')).rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
  })
})
