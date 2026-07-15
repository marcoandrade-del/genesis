import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Prisma } from '@prisma/client'

const m = vi.hoisted(() => ({ criar: vi.fn() }))
vi.mock('../lancamentos.js', () => ({ LancamentosService: class { criar = m.criar } }))

import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'
import { CreditoContabilService, CONTAS_CREDITO } from '../credito-contabil.js'

const dec = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v)
const CONTAS = [
  { id: 'cSup', codigo: CONTAS_CREDITO.suplementar },
  { id: 'cCancel', codigo: CONTAS_CREDITO.cancelamento },
  { id: 'cDisp', codigo: CONTAS_CREDITO.disponivel },
]

// helper p/ montar um item de crédito (item → dotação → fonte)
const item = (dotacaoDespesaId: string, operacao: 'REFORCO' | 'ANULACAO', valor: string, fonte = '1500') => ({
  dotacaoDespesaId,
  operacao,
  valor,
  dotacaoDespesa: { fonteRecurso: { codigo: fonte } },
})

describe('CreditoContabilService', () => {
  let prisma: PrismaMock
  let service: CreditoContabilService

  beforeEach(() => {
    prisma = criarPrismaMock()
    service = new CreditoContabilService(prisma as never)
    m.criar.mockReset().mockResolvedValue({ id: 'lanc' })
    prisma.$transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(prisma))
    prisma.lancamento.findMany.mockResolvedValue([]) // nada contabilizado ainda
    prisma.contaContabilEntidade.findMany.mockResolvedValue(CONTAS)
  })

  describe('contabilizar', () => {
    it('erro quando a abertura ainda não foi contabilizada (não EM_EXECUCAO)', async () => {
      prisma.orcamento.findUnique.mockResolvedValue({ id: 'o', status: 'PUBLICADO', creditos: [] })
      await expect(service.contabilizar('ent1', 2026, 'u1')).rejects.toThrow(/abertura do exercício/i)
    })

    it('reforço debita o crédito por tipo e credita o disponível; anulação faz o inverso', async () => {
      prisma.orcamento.findUnique.mockResolvedValue({
        id: 'orc1', status: 'EM_EXECUCAO',
        creditos: [{
          id: 'c1', tipo: 'SUPLEMENTAR', numero: '12/2026', atoLegal: 'Decreto 12', data: new Date(Date.UTC(2026, 2, 15)),
          itens: [item('d1', 'REFORCO', '250'), item('d2', 'ANULACAO', '250', '1000')],
        }],
      })
      const r = await service.contabilizar('ent1', 2026, 'u1')

      expect(m.criar).toHaveBeenCalledTimes(1)
      const lanc = m.criar.mock.calls[0]![0]
      expect(lanc).toMatchObject({ origemTipo: 'CREDITO_ADICIONAL', origemId: 'c1', eventoCodigo: '003', data: '2026-03-15' })
      expect(lanc.itens).toEqual([
        { contaId: 'cSup', tipo: 'DEBITO', valor: '250.00', fonteCodigo: '1500', dotacaoDespesaId: 'd1' },
        { contaId: 'cDisp', tipo: 'CREDITO', valor: '250.00', fonteCodigo: '1500', dotacaoDespesaId: 'd1' },
        { contaId: 'cDisp', tipo: 'DEBITO', valor: '250.00', fonteCodigo: '1000', dotacaoDespesaId: 'd2' },
        { contaId: 'cCancel', tipo: 'CREDITO', valor: '250.00', fonteCodigo: '1000', dotacaoDespesaId: 'd2' },
      ])
      expect(r).toMatchObject({ creditos: 1, reforcos: 1, anulacoes: 1, totalReforco: '250.00', totalAnulacao: '250.00' })
    })

    it('idempotente: pula crédito já espelhado no razão', async () => {
      prisma.lancamento.findMany.mockResolvedValue([{ origemId: 'c1' }])
      prisma.orcamento.findUnique.mockResolvedValue({
        id: 'orc1', status: 'EM_EXECUCAO',
        creditos: [{ id: 'c1', tipo: 'SUPLEMENTAR', numero: '1', atoLegal: 'D1', data: new Date(Date.UTC(2026, 0, 5)), itens: [item('d1', 'REFORCO', '100')] }],
      })
      const r = await service.contabilizar('ent1', 2026, 'u1')
      expect(m.criar).not.toHaveBeenCalled()
      expect(r).toMatchObject({ creditos: 0 })
    })

    it('falha claro se a conta de controle não é folha no plano', async () => {
      prisma.contaContabilEntidade.findMany.mockResolvedValue(CONTAS.filter((c) => c.id !== 'cSup'))
      prisma.orcamento.findUnique.mockResolvedValue({
        id: 'orc1', status: 'EM_EXECUCAO',
        creditos: [{ id: 'c1', tipo: 'SUPLEMENTAR', numero: '1', atoLegal: 'D1', data: new Date(Date.UTC(2026, 0, 5)), itens: [item('d1', 'REFORCO', '100')] }],
      })
      await expect(service.contabilizar('ent1', 2026, 'u1')).rejects.toThrow(/conta de controle/i)
    })
  })

  describe('estornar', () => {
    it('apaga os lançamentos de crédito e reverte o materializado', async () => {
      prisma.lancamento.findMany.mockResolvedValue([
        { id: 'l1', data: new Date(Date.UTC(2026, 2, 15)), itens: [
          { contaId: 'cSup', tipo: 'DEBITO', valor: dec(250) },
          { contaId: 'cDisp', tipo: 'CREDITO', valor: dec(250) },
        ] },
      ])
      const n = await service.estornar('ent1', 2026)
      expect(n).toBe(1)
      expect(prisma.resumoMensalConta.update).toHaveBeenCalledTimes(2)
      expect(prisma.lancamento.delete).toHaveBeenCalledWith({ where: { id: 'l1' } })
    })
  })
})
