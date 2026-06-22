import { describe, it, expect } from 'vitest'
import { Prisma } from '@prisma/client'
import {
  resumirEmpenho,
  saldoDaLiquidacao,
  netPagoDaOrdem,
  validarLancamento,
  type MovimentoLido,
  type NovoLancamento,
  type DatasReferencia,
} from '../saldos-empenho.js'

const D = (v: number | string) => new Prisma.Decimal(v)
const mov = (tipo: MovimentoLido['tipo'], valor: number, extra: Partial<MovimentoLido> = {}): MovimentoLido => ({ tipo, valor: D(valor), ...extra })

const DIA = (d: string) => new Date(`${d}T00:00:00Z`)
const REF: DatasReferencia = { empenho: DIA('2026-03-01'), liquidacao: DIA('2026-04-01'), ordemPagamento: DIA('2026-05-01') }

describe('resumirEmpenho', () => {
  it('soma as 6 colunas e deriva nets e saldos', () => {
    const movs = [
      mov('EMPENHO', 1000),
      mov('LIQUIDACAO', 700, { liquidacaoId: 'L1' }),
      mov('ESTORNO_LIQUIDACAO', 100, { liquidacaoId: 'L1' }),
      mov('PAGAMENTO', 400, { liquidacaoId: 'L1', ordemPagamentoId: 'P1' }),
      mov('ESTORNO_PAGAMENTO', 50, { liquidacaoId: 'L1', ordemPagamentoId: 'P1' }),
      mov('ESTORNO_EMPENHO', 200),
    ]
    const r = resumirEmpenho(movs)
    expect(r.empenhado.toNumber()).toBe(1000)
    expect(r.estornoEmpenho.toNumber()).toBe(200)
    expect(r.liquidado.toNumber()).toBe(700)
    expect(r.estornoLiquidacao.toNumber()).toBe(100)
    expect(r.pago.toNumber()).toBe(400)
    expect(r.estornoPagamento.toNumber()).toBe(50)
    expect(r.netEmpenhado.toNumber()).toBe(800) // 1000 − 200
    expect(r.netLiquidado.toNumber()).toBe(600) // 700 − 100
    expect(r.netPago.toNumber()).toBe(350) // 400 − 50
    expect(r.saldoEmpenho.toNumber()).toBe(200) // 800 − 600
    expect(r.saldoAPagar.toNumber()).toBe(250) // 600 − 350
  })

  it('empenho vazio → tudo zero', () => {
    const r = resumirEmpenho([])
    expect(r.netEmpenhado.toNumber()).toBe(0)
    expect(r.saldoEmpenho.toNumber()).toBe(0)
  })
})

describe('saldoDaLiquidacao / netPagoDaOrdem', () => {
  const movs = [
    mov('EMPENHO', 1000),
    mov('LIQUIDACAO', 400, { liquidacaoId: 'L1' }),
    mov('LIQUIDACAO', 300, { liquidacaoId: 'L2' }),
    mov('PAGAMENTO', 250, { liquidacaoId: 'L1', ordemPagamentoId: 'P1' }),
    mov('PAGAMENTO', 100, { liquidacaoId: 'L1', ordemPagamentoId: 'P2' }),
    mov('ESTORNO_PAGAMENTO', 50, { liquidacaoId: 'L1', ordemPagamentoId: 'P1' }),
  ]
  it('saldo por liquidação isola o documento', () => {
    expect(saldoDaLiquidacao(movs, 'L1').toNumber()).toBe(100) // 400 − (250+100−50)=300 → 100
    expect(saldoDaLiquidacao(movs, 'L2').toNumber()).toBe(300) // 300 − 0
  })
  it('net pago por OP isola a ordem', () => {
    expect(netPagoDaOrdem(movs, 'P1').toNumber()).toBe(200) // 250 − 50
    expect(netPagoDaOrdem(movs, 'P2').toNumber()).toBe(100)
  })
})

describe('validarLancamento — tetos', () => {
  const base = [mov('EMPENHO', 1000), mov('LIQUIDACAO', 600, { liquidacaoId: 'L1' })]

  it('liquidação dentro do saldo do empenho passa; acima falha', () => {
    expect(() => validarLancamento(base, { tipo: 'LIQUIDACAO', valor: D(400), data: DIA('2026-04-02') }, REF)).not.toThrow()
    expect(() => validarLancamento(base, { tipo: 'LIQUIDACAO', valor: D(401), data: DIA('2026-04-02') }, REF))
      .toThrow(/excede o saldo do empenho/)
  })

  it('estorno de empenho só morde a parte não liquidada', () => {
    // saldo do empenho = 1000 − 600 = 400
    expect(() => validarLancamento(base, { tipo: 'ESTORNO_EMPENHO', valor: D(400), data: DIA('2026-04-02') }, REF)).not.toThrow()
    expect(() => validarLancamento(base, { tipo: 'ESTORNO_EMPENHO', valor: D(400.01), data: DIA('2026-04-02') }, REF))
      .toThrow(/excede o saldo do empenho/)
  })

  it('pagamento ≤ saldo da liquidação (por documento)', () => {
    const movs = [...base, mov('PAGAMENTO', 500, { liquidacaoId: 'L1', ordemPagamentoId: 'P1' })]
    // saldo de L1 = 600 − 500 = 100
    expect(() => validarLancamento(movs, { tipo: 'PAGAMENTO', valor: D(100), data: DIA('2026-04-10'), liquidacaoId: 'L1' }, REF)).not.toThrow()
    expect(() => validarLancamento(movs, { tipo: 'PAGAMENTO', valor: D(101), data: DIA('2026-04-10'), liquidacaoId: 'L1' }, REF))
      .toThrow(/excede o saldo da liquidação/)
  })

  it('estorno de pagamento ≤ net pago da OP', () => {
    const movs = [...base, mov('PAGAMENTO', 200, { liquidacaoId: 'L1', ordemPagamentoId: 'P1' })]
    expect(() => validarLancamento(movs, { tipo: 'ESTORNO_PAGAMENTO', valor: D(200), data: DIA('2026-05-02'), ordemPagamentoId: 'P1' }, REF)).not.toThrow()
    expect(() => validarLancamento(movs, { tipo: 'ESTORNO_PAGAMENTO', valor: D(201), data: DIA('2026-05-02'), ordemPagamentoId: 'P1' }, REF))
      .toThrow(/excede o pago da OP/)
  })

  it('vários estornos parciais somam até o teto', () => {
    let movs = [mov('EMPENHO', 1000)]
    // dois estornos parciais de empenho: 600 + 400 = 1000 (ok), o terceiro estoura
    expect(() => validarLancamento(movs, { tipo: 'ESTORNO_EMPENHO', valor: D(600), data: DIA('2026-03-05') }, REF)).not.toThrow()
    movs = [...movs, mov('ESTORNO_EMPENHO', 600)]
    expect(() => validarLancamento(movs, { tipo: 'ESTORNO_EMPENHO', valor: D(400), data: DIA('2026-03-06') }, REF)).not.toThrow()
    movs = [...movs, mov('ESTORNO_EMPENHO', 400)]
    expect(() => validarLancamento(movs, { tipo: 'ESTORNO_EMPENHO', valor: D(0.01), data: DIA('2026-03-07') }, REF))
      .toThrow(/excede o saldo do empenho/)
  })

  it('valor não-positivo é inválido', () => {
    expect(() => validarLancamento(base, { tipo: 'LIQUIDACAO', valor: D(0), data: DIA('2026-04-02') }, REF)).toThrow(/positivo/)
  })

  it('estorno por documento exige o id do documento', () => {
    expect(() => validarLancamento(base, { tipo: 'PAGAMENTO', valor: D(10), data: DIA('2026-04-02') }, REF)).toThrow(/liquidacaoId/)
  })
})

describe('validarLancamento — anterioridade de data', () => {
  const base = [mov('EMPENHO', 1000), mov('LIQUIDACAO', 600, { liquidacaoId: 'L1' })]

  it('liquidação não pode anteceder o empenho', () => {
    expect(() => validarLancamento(base, { tipo: 'LIQUIDACAO', valor: D(100), data: DIA('2026-02-28') }, REF))
      .toThrow(/não pode anteceder a empenho/)
    expect(() => validarLancamento(base, { tipo: 'LIQUIDACAO', valor: D(100), data: DIA('2026-03-01') }, REF)).not.toThrow()
  })

  it('pagamento não pode anteceder a liquidação', () => {
    const movs = [...base]
    expect(() => validarLancamento(movs, { tipo: 'PAGAMENTO', valor: D(100), data: DIA('2026-03-31'), liquidacaoId: 'L1' }, REF))
      .toThrow(/não pode anteceder a liquidação/)
    expect(() => validarLancamento(movs, { tipo: 'PAGAMENTO', valor: D(100), data: DIA('2026-04-01'), liquidacaoId: 'L1' }, REF)).not.toThrow()
  })
})

describe('fluxo completo (empenho 1.000) — saldos a cada passo', () => {
  it('reproduz o exemplo combinado', () => {
    const movs: MovimentoLido[] = []
    const add = (m: MovimentoLido, intento: NovoLancamento) => {
      expect(() => validarLancamento(movs, intento, REF)).not.toThrow()
      movs.push(m)
    }
    add(mov('EMPENHO', 1000), { tipo: 'EMPENHO', valor: D(1000), data: DIA('2026-03-01') })
    add(mov('LIQUIDACAO', 400, { liquidacaoId: 'L1' }), { tipo: 'LIQUIDACAO', valor: D(400), data: DIA('2026-04-01') })
    add(mov('LIQUIDACAO', 300, { liquidacaoId: 'L2' }), { tipo: 'LIQUIDACAO', valor: D(300), data: DIA('2026-04-01') })
    expect(resumirEmpenho(movs).saldoEmpenho.toNumber()).toBe(300) // 1000 − 700

    add(mov('PAGAMENTO', 250, { liquidacaoId: 'L1', ordemPagamentoId: 'P1' }), { tipo: 'PAGAMENTO', valor: D(250), data: DIA('2026-05-01'), liquidacaoId: 'L1' })
    add(mov('PAGAMENTO', 100, { liquidacaoId: 'L1', ordemPagamentoId: 'P2' }), { tipo: 'PAGAMENTO', valor: D(100), data: DIA('2026-05-01'), liquidacaoId: 'L1' })
    expect(saldoDaLiquidacao(movs, 'L1').toNumber()).toBe(50) // 400 − 350

    add(mov('ESTORNO_PAGAMENTO', 50, { liquidacaoId: 'L1', ordemPagamentoId: 'P1' }), { tipo: 'ESTORNO_PAGAMENTO', valor: D(50), data: DIA('2026-05-02'), ordemPagamentoId: 'P1' })
    add(mov('ESTORNO_LIQUIDACAO', 300, { liquidacaoId: 'L2' }), { tipo: 'ESTORNO_LIQUIDACAO', valor: D(300), data: DIA('2026-04-10'), liquidacaoId: 'L2' })
    expect(resumirEmpenho(movs).netLiquidado.toNumber()).toBe(400) // 700 − 300
    expect(resumirEmpenho(movs).saldoEmpenho.toNumber()).toBe(600) // 1000 − 400

    add(mov('ESTORNO_EMPENHO', 200), { tipo: 'ESTORNO_EMPENHO', valor: D(200), data: DIA('2026-05-03') })
    add(mov('ESTORNO_EMPENHO', 100), { tipo: 'ESTORNO_EMPENHO', valor: D(100), data: DIA('2026-05-03') })
    const fim = resumirEmpenho(movs)
    expect(fim.netEmpenhado.toNumber()).toBe(700) // 1000 − 300
    expect(fim.saldoEmpenho.toNumber()).toBe(300) // 700 − 400
  })
})
