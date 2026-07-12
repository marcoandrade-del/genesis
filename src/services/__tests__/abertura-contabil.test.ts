import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Prisma } from '@prisma/client'

const m = vi.hoisted(() => ({ criar: vi.fn(), calcular: vi.fn() }))
vi.mock('../lancamentos.js', () => ({ LancamentosService: class { criar = m.criar } }))
vi.mock('../saldo-contabil.js', () => ({ SaldoContabilService: class { calcular = m.calcular } }))

import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'
import { AberturaContabilService, CONTAS_ABERTURA } from '../abertura-contabil.js'

const dec = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v)
const CONTROLE = [
  { id: 'cRealizar', codigo: CONTAS_ABERTURA.receitaARealizar },
  { id: 'cPrevisao', codigo: CONTAS_ABERTURA.previsaoInicialReceita },
  { id: 'cInicial', codigo: CONTAS_ABERTURA.creditoInicial },
  { id: 'cDisponivel', codigo: CONTAS_ABERTURA.creditoDisponivel },
]

describe('AberturaContabilService', () => {
  let prisma: PrismaMock
  let service: AberturaContabilService

  beforeEach(() => {
    prisma = criarPrismaMock()
    service = new AberturaContabilService(prisma as never)
    m.criar.mockReset().mockResolvedValue({ id: 'lanc' })
    m.calcular.mockReset().mockResolvedValue(new Map())
    prisma.lancamento.count.mockResolvedValue(0)
    prisma.$transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(prisma))
  })

  // findMany das contas: controle (where.codigo) | ano anterior (where.ano=2025) | ano novo
  function mockContas(opts: { anoAnterior?: { id: string; codigo: string }[]; anoNovo?: { id: string; codigo: string }[] } = {}) {
    prisma.contaContabilEntidade.findMany.mockImplementation((args: { where: { codigo?: unknown; ano?: number } }) => {
      if (args.where.codigo) return Promise.resolve(CONTROLE)
      if (args.where.ano === 2025) return Promise.resolve(opts.anoAnterior ?? [])
      return Promise.resolve(opts.anoNovo ?? [])
    })
  }

  describe('contabilizar — gating', () => {
    it('erro quando não há orçamento', async () => {
      prisma.orcamento.findUnique.mockResolvedValue(null)
      await expect(service.contabilizar('ent1', 2026, 'u1')).rejects.toThrow(/não há orçamento/i)
    })
    it('erro quando o orçamento não está publicado (ex.: APROVADO)', async () => {
      prisma.orcamento.findUnique.mockResolvedValue({ id: 'o', status: 'APROVADO', previsoes: [], dotacoes: [] })
      await expect(service.contabilizar('ent1', 2026, 'u1')).rejects.toThrow(/publicada/i)
    })
    it('erro quando já está EM_EXECUCAO (idempotente)', async () => {
      prisma.orcamento.findUnique.mockResolvedValue({ id: 'o', status: 'EM_EXECUCAO', previsoes: [], dotacoes: [] })
      await expect(service.contabilizar('ent1', 2026, 'u1')).rejects.toThrow(/já foi contabilizada/i)
    })
  })

  describe('contabilizar — geração', () => {
    beforeEach(() => {
      prisma.orcamento.findUnique.mockResolvedValue({
        id: 'orc1', status: 'PUBLICADO',
        previsoes: [{ valorPrevisto: '1000', contaReceita: { codigo: '1.1.1.3.01' }, fonteRecurso: { codigo: '1500' } }],
        dotacoes: [{ valorAutorizado: '800', fonteRecurso: { codigo: '1500' } }],
      })
    })

    it('gera previsão (D 5.2.1.1.1 / C 6.2.1.1.0, cc natureza+fonte) e fixação (D 5.2.2.1.1.01 / C 6.2.2.1.1, cc fonte)', async () => {
      mockContas() // greenfield
      const r = await service.contabilizar('ent1', 2026, 'u1')

      expect(m.criar).toHaveBeenCalledTimes(2)
      const prev = m.criar.mock.calls[0]![0]
      expect(prev).toMatchObject({ origemTipo: 'ABERTURA', origemId: 'orc1', eventoCodigo: '001', data: '2026-01-01' })
      expect(prev.itens).toEqual([
        { contaId: 'cPrevisao', tipo: 'DEBITO', valor: '1000.00', naturezaReceitaCodigo: '1.1.1.3.01', fonteCodigo: '1500' },
        { contaId: 'cRealizar', tipo: 'CREDITO', valor: '1000.00', naturezaReceitaCodigo: '1.1.1.3.01', fonteCodigo: '1500' },
      ])
      const fix = m.criar.mock.calls[1]![0]
      expect(fix).toMatchObject({ eventoCodigo: '002' })
      expect(fix.itens).toEqual([
        { contaId: 'cInicial', tipo: 'DEBITO', valor: '800.00', fonteCodigo: '1500' },
        { contaId: 'cDisponivel', tipo: 'CREDITO', valor: '800.00', fonteCodigo: '1500' },
      ])
      expect(prisma.orcamento.update).toHaveBeenCalledWith({ where: { id: 'orc1' }, data: { status: 'EM_EXECUCAO' } })
      expect(r).toMatchObject({ previsoes: 1, dotacoes: 1, totalPrevisto: '1000.00', totalFixado: '800.00', contasTransportadas: 0 })
    })

    it('falha se uma conta de controle não é folha no plano da entidade', async () => {
      prisma.contaContabilEntidade.findMany.mockImplementation((args: { where: { codigo?: unknown } }) =>
        Promise.resolve(args.where.codigo ? CONTROLE.slice(0, 3) : []),
      )
      await expect(service.contabilizar('ent1', 2026, 'u1')).rejects.toThrow(/conta de controle/i)
    })

    it('transporta só o balanço (classes 1 e 2), em magnitude, mapeando código→ano novo', async () => {
      prisma.orcamento.findUnique.mockResolvedValue({ id: 'orc1', status: 'PUBLICADO', previsoes: [], dotacoes: [] })
      mockContas({
        anoAnterior: [
          { id: 'a1', codigo: '1.1.1.1.1.01.00.00.00.00.00.00' }, // ativo +500
          { id: 'a2', codigo: '2.1.3.1.1.00.00.00.00.00.00.00' }, // passivo −300
          { id: 'a3', codigo: '3.1.9.1.1.00.00.00.00.00.00.00' }, // VPD (resultado) — não transporta
        ],
        anoNovo: [
          { id: 'n1', codigo: '1.1.1.1.1.01.00.00.00.00.00.00' },
          { id: 'n2', codigo: '2.1.3.1.1.00.00.00.00.00.00.00' },
        ],
      })
      m.calcular.mockResolvedValue(new Map<string, { saldoAtual: Prisma.Decimal }>([
        ['a1', { saldoAtual: dec(500) }],
        ['a2', { saldoAtual: dec(-300) }],
        ['a3', { saldoAtual: dec(999) }],
      ]))
      const r = await service.contabilizar('ent1', 2026, 'u1')
      expect(r.contasTransportadas).toBe(2)
      const upserts = prisma.saldoInicialAno.upsert.mock.calls.map((c: { 0: { create: { contaId: string; valor: Prisma.Decimal } } }) => c[0].create)
      expect(upserts).toEqual([
        { entidadeId: 'ent1', contaId: 'n1', ano: 2026, valor: dec(500) },
        { entidadeId: 'ent1', contaId: 'n2', ano: 2026, valor: dec(300) }, // |−300|
      ])
    })
  })

  describe('estornar', () => {
    it('bloqueia quando a execução já começou (lançamentos não-abertura no ano)', async () => {
      prisma.orcamento.findUnique.mockResolvedValue({ id: 'o', status: 'EM_EXECUCAO' })
      prisma.lancamento.count.mockResolvedValue(3)
      await expect(service.estornar('ent1', 2026, 'u1')).rejects.toThrow(/execução já começou/i)
    })

    it('reverte: apaga os lançamentos de abertura, limpa o transporte e volta a PUBLICADO', async () => {
      prisma.orcamento.findUnique.mockResolvedValue({ id: 'orc1', status: 'EM_EXECUCAO' })
      prisma.lancamento.count.mockResolvedValue(0)
      prisma.lancamento.findMany.mockResolvedValue([
        { id: 'l1', data: new Date(Date.UTC(2026, 0, 1)), itens: [
          { contaId: 'cPrevisao', tipo: 'DEBITO', valor: dec(1000) },
          { contaId: 'cRealizar', tipo: 'CREDITO', valor: dec(1000) },
        ] },
      ])
      await service.estornar('ent1', 2026, 'u1')
      expect(prisma.lancamento.delete).toHaveBeenCalledWith({ where: { id: 'l1' } })
      expect(prisma.resumoMensalConta.update).toHaveBeenCalled()
      expect(prisma.saldoInicialAno.deleteMany).toHaveBeenCalledWith({ where: { entidadeId: 'ent1', ano: 2026 } })
      expect(prisma.orcamento.update).toHaveBeenCalledWith({ where: { id: 'orc1' }, data: { status: 'PUBLICADO' } })
    })
  })

  describe('status', () => {
    it('SEM_ORCAMENTO quando não há LOA', async () => {
      prisma.orcamento.findUnique.mockResolvedValue(null)
      expect(await service.status('ent1', 2026)).toMatchObject({ status: 'SEM_ORCAMENTO', podeContabilizar: false })
    })
    it('podeContabilizar quando PUBLICADO', async () => {
      prisma.orcamento.findUnique.mockResolvedValue({ id: 'o', status: 'PUBLICADO' })
      expect(await service.status('ent1', 2026)).toMatchObject({ status: 'PUBLICADO', podeContabilizar: true, contabilizada: false })
    })
    it('contabilizada + podeEstornar quando EM_EXECUCAO e sem execução', async () => {
      prisma.orcamento.findUnique.mockResolvedValue({ id: 'o', status: 'EM_EXECUCAO' })
      prisma.lancamento.count.mockResolvedValue(0)
      expect(await service.status('ent1', 2026)).toMatchObject({ contabilizada: true, podeEstornar: true, podeContabilizar: false })
    })
  })
})
