import { describe, it, expect, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'
import { MatrizSaldosContabeisService } from '../matriz-saldos-contabeis.js'

const dec = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v)

// Linha de groupBy do razão (LancamentoItem) por conta × conta-corrente.
const gi = (
  contaId: string,
  tipo: 'DEBITO' | 'CREDITO',
  valor: Prisma.Decimal.Value,
  cc: { fonteCodigo?: string | null; naturezaReceitaCodigo?: string | null; dotacaoDespesaId?: string | null } = {},
) => ({
  contaId,
  tipo,
  fonteCodigo: cc.fonteCodigo ?? null,
  naturezaReceitaCodigo: cc.naturezaReceitaCodigo ?? null,
  dotacaoDespesaId: cc.dotacaoDespesaId ?? null,
  _sum: { valor: dec(valor) },
})

// Duas contas em partida dobrada: A (Ativo, DEVEDORA) e B (Passivo, CREDORA).
// Abertura 100/100 (SaldoInicialAno, sem cc). Mês 2 movimenta 50 na fonte 1500.
// Mês 3: A credita 30 quebrado em duas fontes (20 em 1500 + 10 em 1540); B
// debita 30 na fonte 1500. Os totais por conta batem com o balancete de fase 1.
function cenarioCc(prisma: PrismaMock) {
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
  // groupBy é chamado 2×: 1º "antes" (meses < 3), 2º "domês" (mês 3).
  prisma.lancamentoItem.groupBy
    .mockResolvedValueOnce([
      gi('A', 'DEBITO', 50, { fonteCodigo: '1500' }),
      gi('B', 'CREDITO', 50, { fonteCodigo: '1500' }),
    ])
    .mockResolvedValueOnce([
      gi('A', 'CREDITO', 20, { fonteCodigo: '1500' }),
      gi('A', 'CREDITO', 10, { fonteCodigo: '1540' }),
      gi('B', 'DEBITO', 30, { fonteCodigo: '1500' }),
    ])
  // Balancete materializado do mês 3 (referência de reconciliação): bate com o razão.
  prisma.resumoMensalConta.findMany.mockResolvedValue([
    { totalDebito: dec(30), totalCredito: dec(0) }, // B
    { totalDebito: dec(0), totalCredito: dec(30) }, // A
  ])
}

describe('MatrizSaldosContabeisService', () => {
  let prisma: PrismaMock
  let svc: MatrizSaldosContabeisService

  beforeEach(() => {
    prisma = criarPrismaMock()
    svc = new MatrizSaldosContabeisService(prisma as never)
  })

  it('quebra cada conta por conta-corrente (fonte); o SI acumula os meses anteriores por cc', async () => {
    cenarioCc(prisma)
    const msc = await svc.emitir('e1', 2026, 3)

    expect(msc).not.toBeNull()
    expect(msc!.mes).toBe(3)
    expect(msc!.entidade).toMatchObject({ municipio: 'Maringá', estado: 'PR' })

    // Conta A (Ativo, devedora): abertura sem cc (100) + fonte 1500 (abre 50 do
    // mês 2, credita 20 no mês 3) + fonte 1540 (credita 10 no mês 3).
    const linhasA = msc!.linhas.filter((l) => l.conta === '1.1.1.1.01.00')
    expect(linhasA).toHaveLength(3)
    expect(linhasA.find((l) => l.contaCorrente.fonte === null)).toMatchObject({
      naturezaSaldo: 'DEVEDORA', saldoInicial: 100, movimentoDevedor: 0, movimentoCredor: 0, saldoFinal: 100,
    })
    expect(linhasA.find((l) => l.contaCorrente.fonte === '1500')).toMatchObject({
      saldoInicial: 50, movimentoDevedor: 0, movimentoCredor: 20, saldoFinal: 30,
    })
    expect(linhasA.find((l) => l.contaCorrente.fonte === '1540')).toMatchObject({
      saldoInicial: 0, movimentoDevedor: 0, movimentoCredor: 10, saldoFinal: -10,
    })

    // Rollup por conta reproduz o balancete de fase 1 (SI 150 / MC 30 / SF 120).
    const soma = (campo: 'saldoInicial' | 'movimentoCredor' | 'saldoFinal') =>
      linhasA.reduce((s, l) => s + l[campo], 0)
    expect(soma('saldoInicial')).toBe(150)
    expect(soma('movimentoCredor')).toBe(30)
    expect(soma('saldoFinal')).toBe(120)

    // Conta B (Passivo, credora): abertura −100 + fonte 1500 (−50 do mês 2, +30 no mês 3).
    const linhasB = msc!.linhas.filter((l) => l.conta === '2.1.1.1.01.00')
    expect(linhasB).toHaveLength(2)
    expect(linhasB.find((l) => l.contaCorrente.fonte === '1500')).toMatchObject({
      saldoInicial: -50, movimentoDevedor: 30, movimentoCredor: 0, saldoFinal: -20,
    })
  })

  it('selo aprova: partida dobrada, balanço fecha e reconcilia com o balancete (4 checks)', async () => {
    cenarioCc(prisma)
    const msc = await svc.emitir('e1', 2026, 3)
    expect(msc!.selo).toEqual({ aprovadas: 4, avaliadas: 4, total: 4 })
    expect(msc!.verificacoes.every((v) => v.status === 'OK')).toBe(true)
    expect(msc!.verificacoes.map((v) => v.codigo)).toEqual([
      'MSC_PARTIDA_DOBRADA', 'MSC_BALANCO_FECHA', 'MSC_RECONCILIA_MD', 'MSC_RECONCILIA_MC',
    ])
  })

  it('reconciliação pega drift entre o razão e o balancete materializado', async () => {
    cenarioCc(prisma)
    // O balancete diz que houve 40 de débito no mês, mas o razão só tem 30.
    prisma.resumoMensalConta.findMany.mockResolvedValue([{ totalDebito: dec(40), totalCredito: dec(30) }])
    const msc = await svc.emitir('e1', 2026, 3)

    const recon = msc!.verificacoes.find((v) => v.codigo === 'MSC_RECONCILIA_MD')!
    expect(recon.status).toBe('DIVERGENTE')
    expect(recon.delta).toBe(-10) // Σ MD do razão (30) − balancete (40)
  })

  it('selo pega o desequilíbrio da partida dobrada com Δ exposto', async () => {
    prisma.entidade.findUnique.mockResolvedValue({ id: 'e1', nome: 'P', municipio: { nome: 'M', estado: { sigla: 'PR' } } })
    prisma.contaContabilEntidade.findMany.mockResolvedValue([{ id: 'A', codigo: '1.1.1.1.01.00', modeloContaId: 'mA' }])
    prisma.conta.findMany.mockResolvedValue([{ id: 'mA', naturezaSaldo: 'DEVEDORA' }])
    prisma.saldoInicialAno.findMany.mockResolvedValue([])
    prisma.lancamentoItem.groupBy
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([gi('A', 'CREDITO', 20, { fonteCodigo: '1500' }), gi('A', 'CREDITO', 10, { fonteCodigo: '1540' })])
    prisma.resumoMensalConta.findMany.mockResolvedValue([{ totalDebito: dec(0), totalCredito: dec(30) }])

    const msc = await svc.emitir('e1', 2026, 3)
    const pd = msc!.verificacoes.find((v) => v.codigo === 'MSC_PARTIDA_DOBRADA')!
    expect(pd.status).toBe('DIVERGENTE')
    expect(pd.delta).toBe(-30) // Σ MD (0) − Σ MC (30)
  })

  it('resolve fonte e função da dotação na conta-corrente da despesa', async () => {
    prisma.entidade.findUnique.mockResolvedValue({ id: 'e1', nome: 'P', municipio: { nome: 'M', estado: { sigla: 'PR' } } })
    prisma.contaContabilEntidade.findMany.mockResolvedValue([{ id: 'X', codigo: '6.2.2.1.01.00', modeloContaId: 'mX' }])
    prisma.conta.findMany.mockResolvedValue([{ id: 'mX', naturezaSaldo: 'DEVEDORA' }])
    prisma.saldoInicialAno.findMany.mockResolvedValue([])
    prisma.lancamentoItem.groupBy
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([gi('X', 'DEBITO', 70, { dotacaoDespesaId: 'd1' })])
    prisma.dotacaoDespesa.findMany.mockResolvedValue([{ id: 'd1', fonteRecurso: { codigo: '1500' }, funcao: { codigo: '12' } }])
    prisma.resumoMensalConta.findMany.mockResolvedValue([{ totalDebito: dec(70), totalCredito: dec(0) }])

    const msc = await svc.emitir('e1', 2026, 3)
    const l = msc!.linhas.find((l) => l.conta === '6.2.2.1.01.00')!
    expect(l.contaCorrente).toMatchObject({ fonte: '1500', funcao: '12', dotacaoId: 'd1', naturezaReceita: null })
    expect(l).toMatchObject({ movimentoDevedor: 70, saldoFinal: 70 })
  })

  it('não gera linha para conta-corrente sem saldo e sem movimento', async () => {
    cenarioCc(prisma)
    prisma.contaContabilEntidade.findMany.mockResolvedValue([
      { id: 'A', codigo: '1.1.1.1.01.00', modeloContaId: 'mA' },
      { id: 'B', codigo: '2.1.1.1.01.00', modeloContaId: 'mB' },
      { id: 'Z', codigo: '3.3.3.3.99.00', modeloContaId: 'mA' }, // sem abertura nem movimento
    ])
    const msc = await svc.emitir('e1', 2026, 3)
    expect(msc!.linhas.some((l) => l.conta === '3.3.3.3.99.00')).toBe(false)
  })

  it('retorna null quando a entidade não existe', async () => {
    prisma.entidade.findUnique.mockResolvedValue(null)
    expect(await svc.emitir('inexistente', 2026, 3)).toBeNull()
  })
})
