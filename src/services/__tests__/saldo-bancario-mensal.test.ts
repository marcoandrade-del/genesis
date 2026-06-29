import { describe, it, expect, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'
import { SaldoBancarioMensalService } from '../saldo-bancario-mensal.js'

const dec = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v)
const ENTIDADE = { id: 'ent1', nome: 'Prefeitura', municipio: { estado: { sigla: 'PR' } } }

describe('SaldoBancarioMensalService.consolidar', () => {
  let prisma: PrismaMock
  let svc: SaldoBancarioMensalService
  beforeEach(() => {
    prisma = criarPrismaMock()
    svc = new SaldoBancarioMensalService(prisma as never)
  })

  it('entidade inexistente → null', async () => {
    prisma.entidade.findUnique.mockResolvedValue(null)
    expect(await svc.consolidar('ent1', 2026)).toBeNull()
  })

  it('sem contas bancárias → contas vazias', async () => {
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    prisma.contaBancaria.findMany.mockResolvedValue([])
    prisma.fonteRecursoEntidade.findMany.mockResolvedValue([])
    const r = await svc.consolidar('ent1', 2026)
    expect(r?.entidade).toEqual({ id: 'ent1', nome: 'Prefeitura', estado: 'PR' })
    expect(r?.contas).toEqual([])
  })

  it('saldo final acumulado por mês (com abertura) + movimentação Σ|valor|', async () => {
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    prisma.contaBancaria.findMany.mockResolvedValue([
      { id: 'cb1', entidadeId: 'ent1', fonteCodigo: '1500', bancoCodigo: '001', bancoNome: 'Banco do Brasil', agencia: '1234', agenciaDv: null, numero: '5678', numeroDv: '9', descricao: null },
    ])
    prisma.fonteRecursoEntidade.findMany.mockResolvedValue([{ codigo: '1500', nomenclatura: 'Recursos Vinculados (Saúde)' }])
    prisma.movimentoBancario.findMany.mockResolvedValue([
      { data: new Date(Date.UTC(2025, 11, 15)), valor: dec(1000), sentido: 'CREDITO' }, // abertura (antes do ano)
      { data: new Date(Date.UTC(2026, 0, 10)), valor: dec(500), sentido: 'CREDITO' }, // jan +500
      { data: new Date(Date.UTC(2026, 0, 20)), valor: dec(200), sentido: 'DEBITO' }, // jan −200
      { data: new Date(Date.UTC(2026, 1, 10)), valor: dec(100), sentido: 'DEBITO' }, // fev −100
    ])
    const r = await svc.consolidar('ent1', 2026)
    expect(r?.contas).toHaveLength(1)
    const c = r!.contas[0]!
    expect(c.rotulo).toContain('001 ag. 1234 c/c 5678-9')
    expect(c.banco).toBe('Banco do Brasil')
    expect(c.fonte).toBe('1500 - Recursos Vinculados (Saúde)')
    // jan = 1000+300 = 1300; fev = 1300−100 = 1200; daí em diante mantém 1200
    expect(c.saldoMensal).toEqual([1300, 1200, 1200, 1200, 1200, 1200, 1200, 1200, 1200, 1200, 1200, 1200])
    expect(c.movimentacaoMensal).toEqual([700, 100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]) // |500|+|200| ; |100|
  })
})
