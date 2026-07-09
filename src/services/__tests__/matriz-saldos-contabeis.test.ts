import { describe, it, expect, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'
import { MatrizSaldosContabeisService } from '../matriz-saldos-contabeis.js'

const dec = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v)

// Duas contas em partida dobrada: 1.x (Ativo, DEVEDORA) e 2.x (Passivo, CREDORA).
// Abertura 100/100; mês 2 movimenta 50 em cada lado; mês 3 movimenta 30.
function cenarioEquilibrado(prisma: PrismaMock) {
  prisma.entidade.findUnique.mockResolvedValue({
    id: 'e1',
    nome: 'Prefeitura',
    municipio: { nome: 'Maringá', estado: { sigla: 'PR' } },
  })
  prisma.contaContabilEntidade.findMany.mockResolvedValue([
    { id: 'A', codigo: '1.1.1.1.01.00', modeloContaId: 'mA' },
    { id: 'B', codigo: '2.1.1.1.01.00', modeloContaId: 'mB' },
  ])
  prisma.conta.findMany.mockResolvedValue([
    { id: 'mA', naturezaSaldo: 'DEVEDORA' },
    { id: 'mB', naturezaSaldo: 'CREDORA' },
  ])
  prisma.saldoInicialAno.findMany.mockResolvedValue([
    { contaId: 'A', valor: dec(100) },
    { contaId: 'B', valor: dec(100) },
  ])
  prisma.resumoMensalConta.findMany.mockResolvedValue([
    { contaId: 'A', mes: 2, totalDebito: dec(50), totalCredito: dec(0) },
    { contaId: 'B', mes: 2, totalDebito: dec(0), totalCredito: dec(50) },
    { contaId: 'A', mes: 3, totalDebito: dec(0), totalCredito: dec(30) },
    { contaId: 'B', mes: 3, totalDebito: dec(30), totalCredito: dec(0) },
  ])
}

describe('MatrizSaldosContabeisService', () => {
  let prisma: PrismaMock
  let svc: MatrizSaldosContabeisService

  beforeEach(() => {
    prisma = criarPrismaMock()
    svc = new MatrizSaldosContabeisService(prisma as never)
  })

  it('emite SI/MD/MC/SF por conta analítica no mês, ordenado por código; SI acumula os meses anteriores', async () => {
    cenarioEquilibrado(prisma)
    const msc = await svc.emitir('e1', 2026, 3)

    expect(msc).not.toBeNull()
    expect(msc!.mes).toBe(3)
    expect(msc!.tipo).toBe('AGREGADA')
    expect(msc!.entidade).toMatchObject({ municipio: 'Maringá', estado: 'PR' })
    expect(msc!.linhas.map((l) => l.conta)).toEqual(['1.1.1.1.01.00', '2.1.1.1.01.00'])

    const a = msc!.linhas[0]! // Ativo (devedora): abre 100, +50 no mês 2, −30 no mês 3
    expect(a).toMatchObject({ naturezaSaldo: 'DEVEDORA', saldoInicial: 150, movimentoDevedor: 0, movimentoCredor: 30, saldoFinal: 120 })

    const b = msc!.linhas[1]! // Passivo (credora): abre −100, −50 no mês 2, +30 no mês 3
    expect(b).toMatchObject({ naturezaSaldo: 'CREDORA', saldoInicial: -150, movimentoDevedor: 30, movimentoCredor: 0, saldoFinal: -120 })
  })

  it('selo aprova quando a partida dobrada fecha (Σ MD = Σ MC) e o balanço zera (Σ SF = 0)', async () => {
    cenarioEquilibrado(prisma)
    const msc = await svc.emitir('e1', 2026, 3)
    expect(msc!.selo).toEqual({ aprovadas: 2, avaliadas: 2, total: 2 })
    expect(msc!.verificacoes.every((v) => v.status === 'OK')).toBe(true)
  })

  it('selo pega o desequilíbrio com Δ exposto quando falta o contra-lançamento', async () => {
    cenarioEquilibrado(prisma)
    // Remove o débito de B no mês 3: sobra um crédito de 30 sem contrapartida.
    prisma.resumoMensalConta.findMany.mockResolvedValue([
      { contaId: 'A', mes: 3, totalDebito: dec(0), totalCredito: dec(30) },
    ])
    prisma.saldoInicialAno.findMany.mockResolvedValue([])
    const msc = await svc.emitir('e1', 2026, 3)

    const pd = msc!.verificacoes.find((v) => v.codigo === 'MSC_PARTIDA_DOBRADA')!
    expect(pd.status).toBe('DIVERGENTE')
    expect(pd.delta).toBe(-30) // Σ MD (0) − Σ MC (30)
    expect(msc!.selo.aprovadas).toBe(0)
  })

  it('pula contas sem saldo e sem movimento no período', async () => {
    cenarioEquilibrado(prisma)
    prisma.contaContabilEntidade.findMany.mockResolvedValue([
      { id: 'A', codigo: '1.1.1.1.01.00', modeloContaId: 'mA' },
      { id: 'B', codigo: '2.1.1.1.01.00', modeloContaId: 'mB' },
      { id: 'Z', codigo: '3.3.3.3.99.00', modeloContaId: 'mA' }, // sem saldo nem movimento
    ])
    const msc = await svc.emitir('e1', 2026, 3)
    expect(msc!.linhas.map((l) => l.conta)).not.toContain('3.3.3.3.99.00')
  })

  it('retorna null quando a entidade não existe', async () => {
    prisma.entidade.findUnique.mockResolvedValue(null)
    expect(await svc.emitir('inexistente', 2026, 3)).toBeNull()
  })
})
