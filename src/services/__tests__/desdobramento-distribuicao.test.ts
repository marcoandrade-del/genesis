import { describe, it, expect } from 'vitest'
import { Prisma } from '@prisma/client'
import { planejarDistribuicao, DesdobramentoDistribuicaoService, type FilhoNovo, type MovimentoMae, type Distribuicao } from '../desdobramento-distribuicao.js'
import { criarPrismaMock } from './helpers/prisma-mock.js'

const D = (v: number) => new Prisma.Decimal(v)
const filho = (codigo: string, saldoInicial = 0, descricao = 'Filho ' + codigo): FilhoNovo => ({ codigo, descricao, saldoInicial: D(saldoInicial) })
const mov = (itemId: string, tipo: 'DEBITO' | 'CREDITO', valor: number, mes = 3): MovimentoMae => ({ itemId, lancamentoId: 'L' + itemId, ano: 2026, mes, tipo, valor: D(valor) })

describe('planejarDistribuicao', () => {
  it('rateia um movimento entre filhos e distribui o saldo inicial', () => {
    const filhos = [filho('A', 300), filho('B', 200)]
    const movs = [mov('i1', 'DEBITO', 1000)]
    const dist: Distribuicao = { i1: { A: D(600), B: D(400) } }
    const p = planejarDistribuicao(D(500), filhos, movs, dist)

    expect(p.saldosIniciais).toEqual([{ codigo: 'A', valor: D(300) }, { codigo: 'B', valor: D(200) }])
    expect(p.itensNovos).toEqual([
      { lancamentoId: 'Li1', codigo: 'A', tipo: 'DEBITO', valor: D(600) },
      { lancamentoId: 'Li1', codigo: 'B', tipo: 'DEBITO', valor: D(400) },
    ])
    // resumo mensal por filho
    expect(p.resumos).toContainEqual({ codigo: 'A', ano: 2026, mes: 3, debito: D(600), credito: D(0) })
    expect(p.resumos).toContainEqual({ codigo: 'B', ano: 2026, mes: 3, debito: D(400), credito: D(0) })
  })

  it('acumula débito e crédito por filho/mês de vários movimentos', () => {
    const filhos = [filho('A'), filho('B')]
    const movs = [mov('i1', 'DEBITO', 100, 1), mov('i2', 'CREDITO', 100, 1), mov('i3', 'DEBITO', 50, 2)]
    const dist: Distribuicao = { i1: { A: D(100) }, i2: { A: D(60), B: D(40) }, i3: { B: D(50) } }
    const p = planejarDistribuicao(D(0), filhos, movs, dist)
    expect(p.resumos).toContainEqual({ codigo: 'A', ano: 2026, mes: 1, debito: D(100), credito: D(60) })
    expect(p.resumos).toContainEqual({ codigo: 'B', ano: 2026, mes: 1, debito: D(0), credito: D(40) })
    expect(p.resumos).toContainEqual({ codigo: 'B', ano: 2026, mes: 2, debito: D(50), credito: D(0) })
  })

  it('falha se a soma do rateio de um movimento não bate', () => {
    const dist: Distribuicao = { i1: { A: D(600), B: D(300) } } // 900 ≠ 1000
    expect(() => planejarDistribuicao(D(0), [filho('A'), filho('B')], [mov('i1', 'DEBITO', 1000)], dist))
      .toThrow(/não foi totalmente distribuído/)
  })

  it('falha se o saldo inicial distribuído difere do da mãe', () => {
    expect(() => planejarDistribuicao(D(500), [filho('A', 300), filho('B', 100)], [], {}))
      .toThrow(/Saldo inicial distribuído/)
  })

  it('rejeita rateio negativo e filho inexistente', () => {
    expect(() => planejarDistribuicao(D(0), [filho('A'), filho('B')], [mov('i1', 'DEBITO', 100)], { i1: { A: D(-10), B: D(110) } }))
      .toThrow(/negativo/)
    expect(() => planejarDistribuicao(D(0), [filho('A'), filho('B')], [mov('i1', 'DEBITO', 100)], { i1: { Z: D(100) } }))
      .toThrow(/filho inexistente/)
  })

  it('exige ≥ 2 filhos e códigos únicos', () => {
    expect(() => planejarDistribuicao(D(0), [filho('A')], [], {})).toThrow(/ao menos 2/)
    expect(() => planejarDistribuicao(D(0), [filho('A'), filho('A')], [], {})).toThrow(/repetido/)
  })

  it('parte zerada não vira item, mas o rateio ainda precisa fechar', () => {
    const dist: Distribuicao = { i1: { A: D(100), B: D(0) } }
    const p = planejarDistribuicao(D(0), [filho('A'), filho('B')], [mov('i1', 'DEBITO', 100)], dist)
    expect(p.itensNovos).toEqual([{ lancamentoId: 'Li1', codigo: 'A', tipo: 'DEBITO', valor: D(100) }])
  })
})

describe('DesdobramentoDistribuicaoService.executar', () => {
  it('cria filhos, reaponta os movimentos para eles e zera a mãe (sintética)', async () => {
    const prisma = criarPrismaMock()
    const svc = new DesdobramentoDistribuicaoService(prisma as never)
    prisma.contaContabilEntidade.findUnique.mockResolvedValue({ id: 'mae', entidadeId: 'e1', ano: 2026, nivel: 6, admiteMovimento: true, codigo: '1.1.1', descricao: 'CAIXA' })
    prisma.saldoInicialAno.findUnique.mockResolvedValue({ valor: D(500) })
    prisma.lancamentoItem.findMany.mockResolvedValue([
      { id: 'it1', lancamentoId: 'L1', tipo: 'DEBITO', valor: D(1000), lancamento: { data: new Date(Date.UTC(2026, 2, 10)) } },
    ])
    prisma.contaContabilEntidade.create.mockResolvedValueOnce({ id: 'fa' }).mockResolvedValueOnce({ id: 'fb' })

    await svc.executar(
      'mae',
      [filho('1.1.1.01', 300, 'Caixa A'), filho('1.1.1.02', 200, 'Caixa B')],
      { it1: { '1.1.1.01': D(600), '1.1.1.02': D(400) } },
    )

    expect(prisma.contaContabilEntidade.create).toHaveBeenCalledTimes(2)
    expect(prisma.lancamentoItem.createMany).toHaveBeenCalledWith({
      data: [
        { lancamentoId: 'L1', contaId: 'fa', tipo: 'DEBITO', valor: D(600) },
        { lancamentoId: 'L1', contaId: 'fb', tipo: 'DEBITO', valor: D(400) },
      ],
    })
    expect(prisma.lancamentoItem.deleteMany).toHaveBeenCalledWith({ where: { contaId: 'mae' } })
    expect(prisma.saldoInicialAno.create).toHaveBeenCalledTimes(2) // 300 e 200
    expect(prisma.contaContabilEntidade.update).toHaveBeenCalledWith({ where: { id: 'mae' }, data: { admiteMovimento: false } })
  })

  it('bloqueia distribuir uma conta sintética', async () => {
    const prisma = criarPrismaMock()
    const svc = new DesdobramentoDistribuicaoService(prisma as never)
    prisma.contaContabilEntidade.findUnique.mockResolvedValue({ id: 'm', admiteMovimento: false })
    await expect(svc.executar('m', [filho('a', 0), filho('b', 0)], {})).rejects.toMatchObject({ code: 'CONFLITO' })
  })
})
