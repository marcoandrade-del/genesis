import { describe, it, expect, beforeEach } from 'vitest'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'
import { ExecucaoDespesaService } from '../execucao-despesa.js'

const dotacao = (over: Record<string, unknown>) => ({
  id: 'd1',
  valorAutorizado: '1000',
  contaDespesaEntidadeId: 'c3',
  unidadeOrcamentaria: { codigo: '02.001', nome: 'Chefia' },
  funcao: { codigo: '04', nome: 'Administração' },
  subfuncao: { codigo: '122', nome: 'Adm Geral' },
  programa: { codigo: '0001', nome: 'Gestão' },
  acao: { codigo: '2001', nome: 'Manutenção' },
  fonteRecurso: { codigo: '100', nomenclatura: 'Tesouro' },
  contaDespesa: { codigo: '3.3.90.30', descricao: 'Material de Consumo' },
  ...over,
})

// Árvore de natureza: 3 → 3.3 → 3.3.90.30
const CONTAS = [
  { id: 'c1', codigo: '3', descricao: 'Despesas Correntes', nivel: 1, parentId: null, origem: 'MODELO' },
  { id: 'c2', codigo: '3.3', descricao: 'Outras Desp. Correntes', nivel: 2, parentId: 'c1', origem: 'MODELO' },
  { id: 'c3', codigo: '3.3.90.30', descricao: 'Material de Consumo', nivel: 3, parentId: 'c2', origem: 'MODELO' },
]

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
    expect(r.porFP).toEqual([])
    expect(prisma.dotacaoDespesa.findMany).not.toHaveBeenCalled()
  })

  it('estágios por dotação (EMPENHO−ESTORNO etc.) + roll-up por dimensão', async () => {
    prisma.orcamento.findUnique.mockResolvedValue({ id: 'o1' })
    prisma.dotacaoDespesa.findMany.mockResolvedValue([dotacao({ id: 'd1' })])
    prisma.contaDespesaEntidade.findMany.mockResolvedValue(CONTAS)
    prisma.movimentoEmpenho.findMany.mockResolvedValue([
      { tipo: 'EMPENHO', valor: '600', empenho: { dotacaoDespesaId: 'd1' } },
      { tipo: 'ESTORNO_EMPENHO', valor: '100', empenho: { dotacaoDespesaId: 'd1' } }, // empenhado = 500
      { tipo: 'LIQUIDACAO', valor: '400', empenho: { dotacaoDespesaId: 'd1' } },
      { tipo: 'PAGAMENTO', valor: '300', empenho: { dotacaoDespesaId: 'd1' } },
    ])

    const r = await svc.calcular('ent1', 2026)
    expect(r.temOrcamento).toBe(true)
    expect(r.resumo).toEqual({ autorizado: 1000, empenhado: 500, liquidado: 400, pago: 300 })

    const esperado = { autorizado: 1000, empenhado: 500, aEmpenhar: 500, liquidado: 400, aLiquidar: 100, pago: 300, aPagar: 100 }
    // Natureza: folha e ancestrais (roll-up)
    expect(r.porNatureza.find((l) => l.codigo === '3.3.90.30')).toMatchObject(esperado)
    expect(r.porNatureza.find((l) => l.codigo === '3')).toMatchObject(esperado)
    // Fonte e Função (planos)
    expect(r.porFonte.find((l) => l.codigo === '100')).toMatchObject(esperado)
    expect(r.porFuncao.find((l) => l.codigo === '04')).toMatchObject(esperado)
    // Funcional-programática: nó-raiz (UO, nível 1) e folha de natureza (nível 6)
    expect(r.porFP.find((l) => l.codigo === '02.001' && l.nivel === 1)).toMatchObject(esperado)
    expect(r.porFP.find((l) => l.codigo === '3.3.90.30' && l.nivel === 6)).toMatchObject(esperado)
  })

  it('soma duas dotações na mesma fonte/função; FP separa pela ação', async () => {
    prisma.orcamento.findUnique.mockResolvedValue({ id: 'o1' })
    prisma.dotacaoDespesa.findMany.mockResolvedValue([
      dotacao({ id: 'd1', valorAutorizado: '1000' }),
      dotacao({ id: 'd2', valorAutorizado: '500', acao: { codigo: '2002', nome: 'Outra Ação' } }),
    ])
    prisma.contaDespesaEntidade.findMany.mockResolvedValue(CONTAS)
    prisma.movimentoEmpenho.findMany.mockResolvedValue([])

    const r = await svc.calcular('ent1', 2026)
    expect(r.resumo.autorizado).toBe(1500)
    // mesma fonte 100 soma as duas
    expect(r.porFonte.find((l) => l.codigo === '100')?.autorizado).toBe(1500)
    // FP: o programa (nível 4) soma as duas; cada ação (nível 5) fica separada
    expect(r.porFP.find((l) => l.codigo === '0001' && l.nivel === 4)?.autorizado).toBe(1500)
    expect(r.porFP.find((l) => l.codigo === '2001' && l.nivel === 5)?.autorizado).toBe(1000)
    expect(r.porFP.find((l) => l.codigo === '2002' && l.nivel === 5)?.autorizado).toBe(500)
  })
})
