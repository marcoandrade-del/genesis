import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Prisma } from '@prisma/client'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'
import { SincronizacaoPortalService, agendarSincronizacaoPortal, distribuirComTeto } from '../sincronizacao-portal.js'

const dec = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v)

// respostas do portal por URL (ordem: fontes → detalhes → dashboard)
function stubFetch(respostas: Record<string, unknown>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const chave = Object.keys(respostas).find((k) => String(url).includes(k))
      if (!chave) throw new Error(`fetch inesperado: ${url}`)
      return { ok: true, json: async () => respostas[chave] } as Response
    }),
  )
}

describe('SincronizacaoPortalService.arrecadacaoMes', () => {
  let prisma: PrismaMock
  let svc: SincronizacaoPortalService

  beforeEach(() => {
    prisma = criarPrismaMock()
    svc = new SincronizacaoPortalService(prisma as never)
    prisma.orcamento.findUnique.mockResolvedValue({ id: 'o1' })
    prisma.previsaoReceita.findMany.mockResolvedValue([
      { id: 'p1', contaReceita: { codigo: '1.1.1.2.50.0.1' }, fonteRecurso: { codigo: '1000' } },
    ])
    prisma.arrecadacao.groupBy.mockResolvedValue([{ tipo: 'ARRECADACAO', _sum: { valor: dec(100) } }])
  })
  afterEach(() => vi.unstubAllGlobals())

  it('captura, valida contra o dashboard e grava (OK)', async () => {
    stubFetch({
      'fonte-recursos?': [{ receita: '1000' }],
      'fonte-recursos/detalhes': [{ receita: '1.1.1.2.50.0.1', valorArrecadado: 100 }],
      'dashboard/arrecadacao-despesa': [{ mes: 6, valorArrecadado: 100 }],
    })
    const r = await svc.arrecadacaoMes('e1', 2026, 6)
    expect(r.status).toBe('OK')
    expect(r.valorGravado).toBe(100)
    expect(prisma.arrecadacao.createMany).toHaveBeenCalled()
    // log persistido
    expect(prisma.sincronizacaoPortal.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ tipo: 'ARRECADACAO', status: 'OK', mes: 6 }) }),
    )
  })

  it('divergência acima da tolerância → DIVERGENTE e NÃO grava', async () => {
    stubFetch({
      'fonte-recursos?': [{ receita: '1000' }],
      'fonte-recursos/detalhes': [{ receita: '1.1.1.2.50.0.1', valorArrecadado: 100 }],
      'dashboard/arrecadacao-despesa': [{ mes: 6, valorArrecadado: 150 }], // 33% off
    })
    const r = await svc.arrecadacaoMes('e1', 2026, 6)
    expect(r.status).toBe('DIVERGENTE')
    expect(prisma.arrecadacao.createMany).not.toHaveBeenCalled()
    expect(prisma.sincronizacaoPortal.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'DIVERGENTE', valorGravado: 0 }) }),
    )
  })

  it('erro de rede → ERRO logado, nada gravado', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500 }) as Response))
    const r = await svc.arrecadacaoMes('e1', 2026, 6)
    expect(r.status).toBe('ERRO')
    expect(prisma.arrecadacao.createMany).not.toHaveBeenCalled()
    expect(prisma.sincronizacaoPortal.create).toHaveBeenCalled()
  })

  it('sem orçamento → ERRO', async () => {
    prisma.orcamento.findUnique.mockResolvedValue(null)
    const r = await svc.arrecadacaoMes('e1', 2026, 6)
    expect(r.status).toBe('ERRO')
    expect(r.mensagem).toContain('orçamento')
  })

  it('só folhas do retorno entram (ancestrais não duplicam)', async () => {
    stubFetch({
      'fonte-recursos?': [{ receita: '1000' }],
      'fonte-recursos/detalhes': [
        { receita: '1.1.1.2.50', valorArrecadado: 100 }, // ancestral — fora
        { receita: '1.1.1.2.50.0.1', valorArrecadado: 100 }, // folha
      ],
      'dashboard/arrecadacao-despesa': [{ mes: 6, valorArrecadado: 100 }],
    })
    const r = await svc.arrecadacaoMes('e1', 2026, 6)
    expect(r.status).toBe('OK')
    expect(r.valorGravado).toBe(100) // não 200
  })
})

describe('SincronizacaoPortalService.despesaMes', () => {
  let prisma: PrismaMock
  let svc: SincronizacaoPortalService

  beforeEach(() => {
    prisma = criarPrismaMock()
    svc = new SincronizacaoPortalService(prisma as never)
    prisma.orcamento.findUnique.mockResolvedValue({ id: 'o1' })
    prisma.dotacaoDespesa.findMany.mockResolvedValue([
      // mesma programática em DUAS fontes (70/30) → rateio proporcional
      { id: 'd1', valorAutorizado: '700', unidadeOrcamentaria: { codigo: '02.010' }, funcao: { codigo: '04' }, subfuncao: { codigo: '122' }, programa: { codigo: '0002' }, acao: { codigo: '2001' }, contaDespesa: { codigo: '3.1.90.11.00.00' } },
      { id: 'd2', valorAutorizado: '300', unidadeOrcamentaria: { codigo: '02.010' }, funcao: { codigo: '04' }, subfuncao: { codigo: '122' }, programa: { codigo: '0002' }, acao: { codigo: '2001' }, contaDespesa: { codigo: '3.1.90.11.00.00' } },
    ])
    prisma.fornecedor.findFirst.mockResolvedValue({ id: 'forn1' })
    prisma.usuario.findFirst.mockResolvedValue({ id: 'u1' })
    prisma.empenho.findMany.mockResolvedValue([])
    prisma.empenho.create.mockResolvedValueOnce({ id: 'e1' }).mockResolvedValueOnce({ id: 'e2' })
    prisma.movimentoEmpenho.groupBy.mockResolvedValue([{ tipo: 'EMPENHO', _sum: { valor: '70' } }])
  })
  afterEach(() => vi.unstubAllGlobals())

  const stubDespesa = (empDash: number) =>
    stubFetch({
      despesapornivel: [
        { programatica: '02.010.04.122.0002.2001.3.1.90.11', nivel: 11, valorEmpenhado: 100, valorLiquidado: 50, valorPago: 20 },
        { programatica: '02.010.04.122.0002', nivel: 5, valorEmpenhado: 100, valorLiquidado: 50, valorPago: 20 }, // nível ≠ 11 — fora
      ],
      'dashboard/arrecadacao-despesa': [{ mes: 6, valorArrecadado: 0, valorEmpenhado: empDash, valorPago: 20 }],
    })

  it('rateia por fonte proporcional ao autorizado, valida e grava (OK)', async () => {
    stubDespesa(100)
    const r = await svc.despesaMes('e1', 2026, 6)
    expect(r.status).toBe('OK')
    expect(r.valorGravado).toBe(100)
    // 2 empenhos de captura criados + movimentos com rateio 70/30
    expect(prisma.empenho.create).toHaveBeenCalledTimes(2)
    const rows = prisma.movimentoEmpenho.createMany.mock.calls[0][0].data
    const empenhos = rows.filter((m: { tipo: string }) => m.tipo === 'EMPENHO').map((m: { valor: number }) => m.valor)
    expect(empenhos.sort((a: number, b: number) => a - b)).toEqual([30, 70])
    // materializa dotacao.valorEmpenhado e empenho.valor
    expect(prisma.dotacaoDespesa.update).toHaveBeenCalled()
    expect(prisma.sincronizacaoPortal.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ tipo: 'DESPESA_EXECUCAO', status: 'OK' }) }),
    )
  })

  it('divergência do dashboard → DIVERGENTE e nada gravado', async () => {
    stubDespesa(200) // capturado 100 × dashboard 200
    const r = await svc.despesaMes('e1', 2026, 6)
    expect(r.status).toBe('DIVERGENTE')
    expect(prisma.movimentoEmpenho.createMany).not.toHaveBeenCalled()
    expect(prisma.empenho.create).not.toHaveBeenCalled()
  })

  it('fonte no teto não recebe além do disponível — excedente vai à outra fonte do grupo', async () => {
    // d1 já executou 650 de 700 autorizados → teto 50; os outros 50 vão pra d2
    prisma.movimentoEmpenho.findMany.mockResolvedValue([
      { tipo: 'EMPENHO', valor: '650', empenho: { dotacaoDespesaId: 'd1' } },
    ])
    stubDespesa(100)
    const r = await svc.despesaMes('e1', 2026, 6)
    expect(r.status).toBe('OK')
    const rows = prisma.movimentoEmpenho.createMany.mock.calls[0][0].data
    const empenhos = rows.filter((m: { tipo: string }) => m.tipo === 'EMPENHO').map((m: { valor: number }) => m.valor)
    expect(empenhos.sort((a: number, b: number) => a - b)).toEqual([50, 50]) // não mais 70/30
    // acumulados consideram só movimentos ANTERIORES ao mês (o próprio mês é reescrito)
    expect(prisma.movimentoEmpenho.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ data: { gte: new Date(Date.UTC(2026, 0, 1)), lt: new Date(Date.UTC(2026, 5, 1)) } }) }),
    )
  })

  it('grupo inteiro sem capacidade → resíduo proporcional (estouro real visível, total preservado)', async () => {
    prisma.movimentoEmpenho.findMany.mockResolvedValue([
      { tipo: 'EMPENHO', valor: '700', empenho: { dotacaoDespesaId: 'd1' } },
      { tipo: 'EMPENHO', valor: '300', empenho: { dotacaoDespesaId: 'd2' } },
    ])
    stubDespesa(100)
    const r = await svc.despesaMes('e1', 2026, 6)
    expect(r.status).toBe('OK')
    const rows = prisma.movimentoEmpenho.createMany.mock.calls[0][0].data
    const empenhos = rows.filter((m: { tipo: string }) => m.tipo === 'EMPENHO').map((m: { valor: number }) => m.valor)
    expect(empenhos.sort((a: number, b: number) => a - b)).toEqual([30, 70]) // volta ao proporcional
  })

  it('fonte já estourada (teto negativo) não recebe nada; tipos desconhecidos no acumulado são ignorados', async () => {
    prisma.movimentoEmpenho.findMany.mockResolvedValue([
      { tipo: 'EMPENHO', valor: '800', empenho: { dotacaoDespesaId: 'd1' } }, // 800 > 700 autorizados
      { tipo: 'AJUSTE_FUTURO', valor: '999', empenho: { dotacaoDespesaId: 'd1' } }, // fora do mapa de sinais
    ])
    stubFetch({
      despesapornivel: [{ programatica: '02.010.04.122.0002.2001.3.1.90.11', nivel: 11, valorEmpenhado: 10, valorLiquidado: 0, valorPago: 0 }],
      'dashboard/arrecadacao-despesa': [{ mes: 6, valorArrecadado: 0, valorEmpenhado: 10, valorPago: 0 }],
    })
    const r = await svc.despesaMes('e1', 2026, 6)
    expect(r.status).toBe('OK')
    const rows = prisma.movimentoEmpenho.createMany.mock.calls[0][0].data
    const empenhos = rows.filter((m: { tipo: string }) => m.tipo === 'EMPENHO').map((m: { valor: number }) => m.valor)
    expect(empenhos).toEqual([10]) // tudo em d2; d1 (estourada) não gera movimento
  })

  it('valor reservado da dotação conta no teto do rateio', async () => {
    prisma.dotacaoDespesa.findMany.mockResolvedValue([
      { id: 'd1', valorAutorizado: '700', valorReservado: '680', unidadeOrcamentaria: { codigo: '02.010' }, funcao: { codigo: '04' }, subfuncao: { codigo: '122' }, programa: { codigo: '0002' }, acao: { codigo: '2001' }, contaDespesa: { codigo: '3.1.90.11.00.00' } },
      { id: 'd2', valorAutorizado: '300', valorReservado: '0', unidadeOrcamentaria: { codigo: '02.010' }, funcao: { codigo: '04' }, subfuncao: { codigo: '122' }, programa: { codigo: '0002' }, acao: { codigo: '2001' }, contaDespesa: { codigo: '3.1.90.11.00.00' } },
    ])
    stubDespesa(100)
    const r = await svc.despesaMes('e1', 2026, 6)
    expect(r.status).toBe('OK')
    const rows = prisma.movimentoEmpenho.createMany.mock.calls[0][0].data
    const empenhos = rows.filter((m: { tipo: string }) => m.tipo === 'EMPENHO').map((m: { valor: number }) => m.valor)
    expect(empenhos.sort((a: number, b: number) => a - b)).toEqual([20, 80]) // d1: 700−680=20
  })

  it('liquidado do mês respeita o empenhado acumulado de cada fonte', async () => {
    // empenhado acumulado: d1=10, d2=90; mês só liquida 100 → d1 no máx 10
    prisma.movimentoEmpenho.findMany.mockResolvedValue([
      { tipo: 'EMPENHO', valor: '10', empenho: { dotacaoDespesaId: 'd1' } },
      { tipo: 'EMPENHO', valor: '90', empenho: { dotacaoDespesaId: 'd2' } },
    ])
    stubFetch({
      despesapornivel: [{ programatica: '02.010.04.122.0002.2001.3.1.90.11', nivel: 11, valorEmpenhado: 0, valorLiquidado: 100, valorPago: 0 }],
      'dashboard/arrecadacao-despesa': [{ mes: 6, valorArrecadado: 0, valorEmpenhado: 0, valorPago: 0 }],
    })
    const r = await svc.despesaMes('e1', 2026, 6)
    expect(r.status).toBe('OK')
    const rows = prisma.movimentoEmpenho.createMany.mock.calls[0][0].data
    const liqs = rows.filter((m: { tipo: string }) => m.tipo === 'LIQUIDACAO').map((m: { valor: number }) => m.valor)
    expect(liqs.sort((a: number, b: number) => a - b)).toEqual([10, 90]) // não 70/30
  })

  it('re-run rematerializa dotação que perdeu todos os movimentos do mês', async () => {
    // captura anterior tinha movimento em d-velha; no re-run o rateio não lhe dá nada
    prisma.movimentoEmpenho.findMany.mockImplementation(async (args: { where: { historico?: string } }) =>
      args.where.historico ? [{ empenhoId: 'e-velho', empenho: { dotacaoDespesaId: 'd-velha' } }] : [],
    )
    stubDespesa(100)
    const r = await svc.despesaMes('e1', 2026, 6)
    expect(r.status).toBe('OK')
    // e-velho rematerializado a partir dos movimentos restantes (groupBy mockado → 70)
    expect(prisma.empenho.update).toHaveBeenCalledWith({ where: { id: 'e-velho' }, data: { valor: 70, valorLiquidado: 0 } })
    expect(prisma.dotacaoDespesa.update).toHaveBeenCalledWith({ where: { id: 'd-velha' }, data: { valorEmpenhado: 70 } })
  })

  it('delta negativo no mês vira ESTORNO', async () => {
    stubFetch({
      despesapornivel: [{ programatica: '02.010.04.122.0002.2001.3.1.90.11', nivel: 11, valorEmpenhado: -40, valorLiquidado: 0, valorPago: 0 }],
      'dashboard/arrecadacao-despesa': [{ mes: 6, valorArrecadado: 0, valorEmpenhado: -40, valorPago: 0 }],
    })
    const r = await svc.despesaMes('e1', 2026, 6)
    expect(r.status).toBe('OK')
    const rows = prisma.movimentoEmpenho.createMany.mock.calls[0][0].data
    expect(rows.some((m: { tipo: string; valor: number }) => m.tipo === 'ESTORNO_EMPENHO' && m.valor === 28)).toBe(true) // 70% de 40
  })
})

describe('distribuirComTeto', () => {
  it('proporcional quando todos têm teto de sobra; Σ = valor', () => {
    expect(distribuirComTeto(10000, [70000, 30000], [70000, 30000])).toEqual([7000, 3000])
  })

  it('clampa no teto e redistribui; Σ = valor', () => {
    expect(distribuirComTeto(10000, [70000, 30000], [5000, 30000])).toEqual([5000, 5000])
  })

  it('valor zero → tudo zero; negativo → proporcional sem teto', () => {
    expect(distribuirComTeto(0, [70000, 30000], [0, 0])).toEqual([0, 0])
    expect(distribuirComTeto(-4000, [70000, 30000], [0, 0])).toEqual([-2800, -1200])
  })

  it('teto negativo (já estourada) não recebe nada enquanto o grupo tem saldo', () => {
    expect(distribuirComTeto(10000, [70000, 30000], [-500, 30000])).toEqual([0, 10000])
  })

  it('pesos zerados dividem por igual', () => {
    expect(distribuirComTeto(10000, [0, 0], [10000, 10000])).toEqual([5000, 5000])
    expect(distribuirComTeto(-10000, [0, 0], [0, 0])).toEqual([-5000, -5000])
  })
})

describe('agendarSincronizacaoPortal', () => {
  it('desligado sem a env (retorna null, nada agendado)', () => {
    delete process.env['SINCRONIZAR_PORTAL_MARINGA']
    const prisma = criarPrismaMock()
    expect(agendarSincronizacaoPortal(prisma as never, () => {})).toBeNull()
  })

  it('com a env, agenda e retorna o timer', () => {
    process.env['SINCRONIZAR_PORTAL_MARINGA'] = '1'
    vi.useFakeTimers()
    const prisma = criarPrismaMock()
    const timer = agendarSincronizacaoPortal(prisma as never, () => {})
    expect(timer).not.toBeNull()
    clearTimeout(timer!)
    vi.useRealTimers()
    delete process.env['SINCRONIZAR_PORTAL_MARINGA']
  })
})
