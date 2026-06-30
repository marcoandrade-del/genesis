import { describe, it, expect, beforeEach } from 'vitest'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'
import { ExecucaoDespesaService } from '../execucao-despesa.js'

const dotacao = (over: Record<string, unknown>) => ({
  id: 'd1',
  valorAutorizado: '1000',
  contaDespesaEntidadeId: 'c3',
  unidadeOrcamentaria: { codigo: '02.001', nome: 'Chefia', orgao: { codigo: '02', nome: 'Órgão 02' } },
  funcao: { codigo: '04', nome: 'Administração' },
  subfuncao: { codigo: '122', nome: 'Adm Geral' },
  programa: { codigo: '0001', nome: 'Gestão' },
  acao: { codigo: '2001', nome: 'Manutenção' },
  fonteRecurso: { codigo: '100', nomenclatura: 'Tesouro' },
  contaDespesa: { codigo: '3.3.90.30', descricao: 'Material de Consumo' },
  ...over,
})

describe('ExecucaoDespesaService.calcular', () => {
  let prisma: PrismaMock
  let svc: ExecucaoDespesaService

  beforeEach(() => {
    prisma = criarPrismaMock()
    svc = new ExecucaoDespesaService(prisma as never)
  })

  it('sem orçamento → vazio', async () => {
    prisma.orcamento.findUnique.mockResolvedValue(null)
    const r = await svc.calcular('ent1', 2026)
    expect(r.temOrcamento).toBe(false)
    expect(r.dotacoes).toEqual([])
    expect(prisma.dotacaoDespesa.findMany).not.toHaveBeenCalled()
  })

  it('árvore Órgão→UO→Função/Subf→Programa/Ação→dotação com estágios e roll-up', async () => {
    prisma.orcamento.findUnique.mockResolvedValue({ id: 'o1' })
    prisma.dotacaoDespesa.findMany.mockResolvedValue([dotacao({ id: 'd1' })])
    prisma.movimentoEmpenho.findMany.mockResolvedValue([
      { tipo: 'EMPENHO', valor: '600', empenho: { dotacaoDespesaId: 'd1' } },
      { tipo: 'ESTORNO_EMPENHO', valor: '100', empenho: { dotacaoDespesaId: 'd1' } }, // empenhado = 500
      { tipo: 'LIQUIDACAO', valor: '400', empenho: { dotacaoDespesaId: 'd1' } },
      { tipo: 'PAGAMENTO', valor: '300', empenho: { dotacaoDespesaId: 'd1' } },
    ])

    const r = await svc.calcular('ent1', 2026)
    expect(r.temOrcamento).toBe(true)
    expect(r.totalDotacoes).toBe(1)
    expect(r.resumo).toEqual({ autorizado: 1000, empenhado: 500, liquidado: 400, pago: 300 })

    const vals = { autorizado: 1000, empenhado: 500, aEmpenhar: 500, liquidado: 400, aLiquidar: 100, pago: 300, aPagar: 100 }
    // 5 níveis, pré-ordem (Órgão primeiro)
    expect(r.dotacoes.map((l) => l.nivel)).toEqual([1, 2, 3, 4, 5])
    expect(r.dotacoes.find((l) => l.nivel === 1)).toMatchObject({ orgao: '02', temFilhos: true, ...vals })
    expect(r.dotacoes.find((l) => l.nivel === 2)).toMatchObject({ uo: '02.001' })
    expect(r.dotacoes.find((l) => l.nivel === 3)).toMatchObject({ funcaoSubf: '04.122' })
    expect(r.dotacoes.find((l) => l.nivel === 4)).toMatchObject({ programaAcao: '0001.2001' })
    const folha = r.dotacoes.find((l) => l.nivel === 5)!
    expect(folha).toMatchObject({ natureza: '3.3.90.30', fonte: '100', temFilhos: false, ...vals })
  })

  it('agrupa por funcional: mesma UO/função soma; ações diferentes ficam separadas', async () => {
    prisma.orcamento.findUnique.mockResolvedValue({ id: 'o1' })
    prisma.dotacaoDespesa.findMany.mockResolvedValue([
      dotacao({ id: 'd1', valorAutorizado: '1000' }),
      dotacao({ id: 'd2', valorAutorizado: '500', acao: { codigo: '2002', nome: 'Outra Ação' } }),
    ])
    prisma.movimentoEmpenho.findMany.mockResolvedValue([])

    const r = await svc.calcular('ent1', 2026)
    expect(r.totalDotacoes).toBe(2)
    expect(r.resumo.autorizado).toBe(1500)
    // Órgão (1), UO (2) e Função/Subf (3) somam as duas dotações
    expect(r.dotacoes.find((l) => l.nivel === 1)?.autorizado).toBe(1500)
    expect(r.dotacoes.find((l) => l.nivel === 2)?.autorizado).toBe(1500)
    expect(r.dotacoes.find((l) => l.nivel === 3)?.autorizado).toBe(1500)
    // Programa/Ação (nível 4): cada ação fica separada
    expect(r.dotacoes.find((l) => l.programaAcao === '0001.2001')?.autorizado).toBe(1000)
    expect(r.dotacoes.find((l) => l.programaAcao === '0001.2002')?.autorizado).toBe(500)
    // duas folhas (uma por ação)
    expect(r.dotacoes.filter((l) => l.nivel === 5)).toHaveLength(2)
  })
})

describe('ExecucaoDespesaService.mensal', () => {
  let prisma: PrismaMock
  let svc: ExecucaoDespesaService
  beforeEach(() => {
    prisma = criarPrismaMock()
    svc = new ExecucaoDespesaService(prisma as never)
  })

  const movs = [
    { tipo: 'EMPENHO', valor: '600', data: new Date(Date.UTC(2026, 0, 10)) },
    { tipo: 'ESTORNO_EMPENHO', valor: '100', data: new Date(Date.UTC(2026, 0, 20)) }, // jan empenhado = 500
    { tipo: 'LIQUIDACAO', valor: '400', data: new Date(Date.UTC(2026, 1, 10)) }, // fev
    { tipo: 'PAGAMENTO', valor: '300', data: new Date(Date.UTC(2026, 2, 10)) }, // mar
  ]
  // path da folha: orgao|uo|func.subf|prog.acao|conta#fonte (defaults de dotacao())
  const LEAF = '02|02.001|04.122|0001.2001|3.3.90.30#100'

  it('série mensal (emp/liq/pago) do nó-folha pelo path', async () => {
    prisma.orcamento.findUnique.mockResolvedValue({ id: 'o1' })
    prisma.dotacaoDespesa.findMany.mockResolvedValue([dotacao({ id: 'd1' })])
    prisma.movimentoEmpenho.findMany.mockResolvedValue(movs)
    const r = await svc.mensal('ent1', 2026, LEAF)
    expect(r?.empenhadoMensal[0]).toBe(500)
    expect(r?.liquidadoMensal[1]).toBe(400)
    expect(r?.pagoMensal[2]).toBe(300)
  })

  it('nó-pai (Órgão) agrega a dotação sob o caminho', async () => {
    prisma.orcamento.findUnique.mockResolvedValue({ id: 'o1' })
    prisma.dotacaoDespesa.findMany.mockResolvedValue([dotacao({ id: 'd1' })])
    prisma.movimentoEmpenho.findMany.mockResolvedValue(movs)
    const r = await svc.mensal('ent1', 2026, '02') // órgão (topo)
    expect(r?.empenhadoMensal[0]).toBe(500)
  })

  it('path inexistente → null', async () => {
    prisma.orcamento.findUnique.mockResolvedValue({ id: 'o1' })
    prisma.dotacaoDespesa.findMany.mockResolvedValue([dotacao({ id: 'd1' })])
    expect(await svc.mensal('ent1', 2026, '99.999')).toBeNull()
  })
})

describe('ExecucaoDespesaService.lancamentos', () => {
  let prisma: PrismaMock
  let svc: ExecucaoDespesaService
  beforeEach(() => {
    prisma = criarPrismaMock()
    svc = new ExecucaoDespesaService(prisma as never)
  })

  it('lista o ledger da dotação (cronológico) com rótulo do documento', async () => {
    prisma.dotacaoDespesa.findUnique.mockResolvedValue({
      orcamento: { entidadeId: 'ent1' },
      unidadeOrcamentaria: { codigo: '02.001', nome: 'Chefia' },
      funcao: { codigo: '04' },
      contaDespesa: { codigo: '3.3.90.30', descricao: 'Material de Consumo' },
      fonteRecurso: { codigo: '100', nomenclatura: 'Tesouro' },
    })
    prisma.movimentoEmpenho.findMany.mockResolvedValue([
      { data: new Date(Date.UTC(2026, 2, 10)), tipo: 'EMPENHO', valor: '600', documento: null, empenho: { numero: '123' }, liquidacao: null, ordemPagamento: null },
      { data: new Date(Date.UTC(2026, 2, 20)), tipo: 'PAGAMENTO', valor: '300', documento: null, empenho: { numero: '123' }, liquidacao: null, ordemPagamento: { numero: '88' } },
    ])
    const r = await svc.lancamentos('ent1', 'd1')
    expect(r?.dotacao).toMatchObject({ natureza: 'Material de Consumo', orgao: 'Chefia', fonte: '100 - Tesouro' })
    expect(r?.movimentos[0]).toMatchObject({ tipo: 'EMPENHO', valor: 600, documento: 'Emp 123' })
    expect(r?.movimentos[1]?.documento).toBe('OP 88')
  })

  it('null se a dotação é de outra entidade', async () => {
    prisma.dotacaoDespesa.findUnique.mockResolvedValue({
      orcamento: { entidadeId: 'OUTRA' },
      unidadeOrcamentaria: { codigo: '', nome: '' }, funcao: { codigo: '' }, contaDespesa: { codigo: '', descricao: '' }, fonteRecurso: { codigo: '', nomenclatura: '' },
    })
    expect(await svc.lancamentos('ent1', 'd1')).toBeNull()
  })
})
