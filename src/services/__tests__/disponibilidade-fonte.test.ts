import { describe, it, expect, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'
import { DisponibilidadeFonteService } from '../disponibilidade-fonte.js'

const dec = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v)

const mov = (tipo: string, valor: number, fonte = '1000', nomenclatura = 'Livres') => ({
  tipo,
  valor: dec(valor),
  empenho: { dotacaoDespesa: { fonteRecurso: { codigo: fonte, nomenclatura } } },
})

describe('DisponibilidadeFonteService.calcular', () => {
  let prisma: PrismaMock
  let svc: DisponibilidadeFonteService

  beforeEach(() => {
    prisma = criarPrismaMock()
    svc = new DisponibilidadeFonteService(prisma as never)
    // ContasBancariasService.listar: contas + fontes do exercício
    prisma.contaBancaria.findMany.mockResolvedValue([
      { id: 'cb1', fonteCodigo: '1000', bancoCodigo: '001', agencia: '1', numero: '10' },
      { id: 'cb2', fonteCodigo: '1104', bancoCodigo: '104', agencia: '2', numero: '20' },
    ])
    prisma.fonteRecursoEntidade.findMany.mockResolvedValue([
      { codigo: '1000', nomenclatura: 'Recursos Ordinários (Livres)' },
      { codigo: '1104', nomenclatura: 'MDE 25%' },
    ])
    // saldo por conta: cb1 = 500 crédito − 100 débito; cb2 = 300 crédito
    prisma.movimentoBancario.groupBy.mockImplementation((({ where }: { where: { contaBancariaId: string } }) =>
      Promise.resolve(
        where.contaBancariaId === 'cb1'
          ? [
              { sentido: 'CREDITO', _sum: { valor: dec(500) } },
              { sentido: 'DEBITO', _sum: { valor: dec(100) } },
            ]
          : [{ sentido: 'CREDITO', _sum: { valor: dec(300) } }],
      )) as never)
    prisma.movimentoEmpenho.findMany.mockResolvedValue([])
  })

  it('caixa por fonte = saldo acumulado das contas bancárias da fonte', async () => {
    const r = await svc.calcular('e1', 2026)
    expect(r.temDados).toBe(true)
    expect(r.linhas).toEqual([
      { fonte: '1000', nomenclatura: 'Recursos Ordinários (Livres)', caixa: 400, rpProcessados: 0, rpNaoProcessados: 0, disponibilidade: 400 },
      { fonte: '1104', nomenclatura: 'MDE 25%', caixa: 300, rpProcessados: 0, rpNaoProcessados: 0, disponibilidade: 300 },
    ])
    expect(r.totais).toEqual({ caixa: 700, rpProcessados: 0, rpNaoProcessados: 0, disponibilidade: 700 })
  })

  it('restos a pagar: empenho vira não-processado, liquidação migra p/ processado, pagamento baixa', async () => {
    prisma.movimentoEmpenho.findMany.mockResolvedValue([
      mov('EMPENHO', 200), // não-processados 1000: +200
      mov('LIQUIDACAO', 120), // não-proc −120, processados +120
      mov('PAGAMENTO', 70), // processados −70
      mov('EMPENHO', 50, '1104', 'MDE 25%'), // fonte 1104
    ])
    const r = await svc.calcular('e1', 2026)
    const f1000 = r.linhas.find((l) => l.fonte === '1000')!
    // não-processados: 200−120 = 80; processados: 120−70 = 50
    expect(f1000.rpNaoProcessados).toBe(80)
    expect(f1000.rpProcessados).toBe(50)
    expect(f1000.disponibilidade).toBe(400 - 80 - 50)
    const f1104 = r.linhas.find((l) => l.fonte === '1104')!
    expect(f1104.rpNaoProcessados).toBe(50)
    expect(f1104.disponibilidade).toBe(300 - 50)
    expect(r.totais.disponibilidade).toBe(270 + 250)
  })

  it('estornos revertem cada estágio', async () => {
    prisma.movimentoEmpenho.findMany.mockResolvedValue([
      mov('EMPENHO', 100),
      mov('ESTORNO_EMPENHO', 40), // não-proc: 60
      mov('LIQUIDACAO', 60),
      mov('ESTORNO_LIQUIDACAO', 10), // não-proc: 60−60+10=10; proc: 60−10=50
      mov('PAGAMENTO', 30),
      mov('ESTORNO_PAGAMENTO', 5), // proc: 50−30+5=25
    ])
    const r = await svc.calcular('e1', 2026)
    const l = r.linhas.find((x) => x.fonte === '1000')!
    expect(l.rpNaoProcessados).toBe(10)
    expect(l.rpProcessados).toBe(25)
  })

  it('RP em fonte SEM conta bancária aparece com caixa 0 (disponibilidade negativa)', async () => {
    prisma.movimentoEmpenho.findMany.mockResolvedValue([mov('EMPENHO', 90, '1303', 'ASPS próprios')])
    const r = await svc.calcular('e1', 2026)
    const l = r.linhas.find((x) => x.fonte === '1303')!
    expect(l.caixa).toBe(0)
    expect(l.disponibilidade).toBe(-90)
  })

  it('sem contas nem movimentos → temDados=false', async () => {
    prisma.contaBancaria.findMany.mockResolvedValue([])
    const r = await svc.calcular('e1', 2026)
    expect(r.temDados).toBe(false)
    expect(r.linhas).toEqual([])
  })
})
