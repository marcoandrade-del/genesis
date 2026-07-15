import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Prisma } from '@prisma/client'

const m = vi.hoisted(() => ({ criar: vi.fn() }))
vi.mock('../lancamentos.js', () => ({ LancamentosService: class { criar = m.criar } }))

import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'
import { RestosAPagarContabilService, type MovimentoRp } from '../restos-a-pagar-contabil.js'

const dec = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v)
const CONTAS = [
  { id: 'cInscritoNP', codigo: '5.3.1.1.0.00.00.00.00.00.00.00' },
  { id: 'cProc', codigo: '5.3.1.2.0.00.00.00.00.00.00.00' },
  { id: 'cALiquidar', codigo: '6.3.1.1.0.00.00.00.00.00.00.00' },
]

const abertura: MovimentoRp = {
  data: '2026-01-01',
  historico: 'Inscrição de Restos a Pagar',
  origemId: 'rp-abertura-2026',
  eventoCodigo: '004',
  linhas: [
    { contaCodigo: '5.3.1.1.0.00.00.00.00.00.00.00', tipo: 'DEBITO', valor: '300', fonte: '1751', funcao: '15', subfuncao: '452', naturezaDespesa: '3.3.90.39' },
    { contaCodigo: '5.3.1.2.0.00.00.00.00.00.00.00', tipo: 'DEBITO', valor: '34', fonte: '1500', funcao: '12', subfuncao: '361', naturezaDespesa: '3.3.90.39' },
    { contaCodigo: '6.3.1.1.0.00.00.00.00.00.00.00', tipo: 'CREDITO', valor: '334', fonte: '1751', funcao: '15', subfuncao: '452', naturezaDespesa: '3.3.90.39' },
  ],
}

describe('RestosAPagarContabilService', () => {
  let prisma: PrismaMock
  let service: RestosAPagarContabilService

  beforeEach(() => {
    prisma = criarPrismaMock()
    service = new RestosAPagarContabilService(prisma as never)
    m.criar.mockReset().mockResolvedValue({ id: 'lanc' })
    prisma.$transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(prisma))
    prisma.lancamento.findMany.mockResolvedValue([])
    prisma.contaContabilEntidade.findMany.mockResolvedValue(CONTAS)
  })

  it('contabiliza a inscrição com cc CRUA (D 5.3.1.x / C 6.3.1.x)', async () => {
    const r = await service.contabilizar('ent1', 2026, [abertura], 'u1')
    expect(m.criar).toHaveBeenCalledTimes(1)
    const lanc = m.criar.mock.calls[0]![0]
    expect(lanc).toMatchObject({ origemTipo: 'RESTOS_A_PAGAR', origemId: 'rp-abertura-2026', eventoCodigo: '004', data: '2026-01-01' })
    expect(lanc.itens[0]).toEqual({ contaId: 'cInscritoNP', tipo: 'DEBITO', valor: '300.00', fonteCodigo: '1751', funcaoCodigo: '15', subfuncaoCodigo: '452', naturezaDespesaCodigo: '3.3.90.39' })
    expect(lanc.itens[2]).toMatchObject({ contaId: 'cALiquidar', tipo: 'CREDITO', valor: '334.00' })
    expect(r).toMatchObject({ lancamentos: 1, itens: 3, totalDebito: '334.00', totalCredito: '334.00' })
  })

  it('recusa movimento que não fecha (Σ D ≠ Σ C)', async () => {
    const torto: MovimentoRp = { ...abertura, origemId: 'rp-torto', linhas: [
      { contaCodigo: '5.3.1.1.0.00.00.00.00.00.00.00', tipo: 'DEBITO', valor: '300' },
      { contaCodigo: '6.3.1.1.0.00.00.00.00.00.00.00', tipo: 'CREDITO', valor: '200' },
    ] }
    await expect(service.contabilizar('ent1', 2026, [torto], 'u1')).rejects.toThrow(/não fecha/i)
    expect(m.criar).not.toHaveBeenCalled()
  })

  it('idempotente: pula movimento já contabilizado', async () => {
    prisma.lancamento.findMany.mockResolvedValue([{ origemId: 'rp-abertura-2026' }])
    const r = await service.contabilizar('ent1', 2026, [abertura], 'u1')
    expect(m.criar).not.toHaveBeenCalled()
    expect(r).toMatchObject({ lancamentos: 0 })
  })

  it('falha claro se a conta de controle não é folha', async () => {
    prisma.contaContabilEntidade.findMany.mockResolvedValue(CONTAS.filter((c) => c.id !== 'cALiquidar'))
    await expect(service.contabilizar('ent1', 2026, [abertura], 'u1')).rejects.toThrow(/conta de controle de RP/i)
  })

  it('estorna os lançamentos de RP e reverte o materializado', async () => {
    prisma.lancamento.findMany.mockResolvedValue([
      { id: 'l1', data: new Date(Date.UTC(2026, 0, 1)), itens: [
        { contaId: 'cInscritoNP', tipo: 'DEBITO', valor: dec(300) },
        { contaId: 'cALiquidar', tipo: 'CREDITO', valor: dec(300) },
      ] },
    ])
    const n = await service.estornar('ent1', 2026)
    expect(n).toBe(1)
    expect(prisma.resumoMensalConta.update).toHaveBeenCalledTimes(2)
    expect(prisma.lancamento.delete).toHaveBeenCalledWith({ where: { id: 'l1' } })
  })
})
