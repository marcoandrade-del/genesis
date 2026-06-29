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

  it('árvore UO→Função/Subf→Programa/Ação→dotação com estágios e roll-up', async () => {
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
    // 4 níveis, pré-ordem (UO primeiro)
    expect(r.dotacoes.map((l) => l.nivel)).toEqual([1, 2, 3, 4])
    const uo = r.dotacoes.find((l) => l.nivel === 1)!
    expect(uo).toMatchObject({ uo: '02.001', temFilhos: true, ...vals })
    const folha = r.dotacoes.find((l) => l.nivel === 4)!
    expect(folha).toMatchObject({ natureza: '3.3.90.30', fonte: '100', temFilhos: false, ...vals })
    expect(r.dotacoes.find((l) => l.nivel === 2)).toMatchObject({ funcaoSubf: '04.122' })
    expect(r.dotacoes.find((l) => l.nivel === 3)).toMatchObject({ programaAcao: '0001.2001' })
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
    // UO (nível 1) e Função/Subf (nível 2) somam as duas dotações
    expect(r.dotacoes.find((l) => l.nivel === 1)?.autorizado).toBe(1500)
    expect(r.dotacoes.find((l) => l.nivel === 2)?.autorizado).toBe(1500)
    // Programa/Ação: cada ação fica separada
    expect(r.dotacoes.find((l) => l.programaAcao === '0001.2001')?.autorizado).toBe(1000)
    expect(r.dotacoes.find((l) => l.programaAcao === '0001.2002')?.autorizado).toBe(500)
    // duas folhas (uma por ação)
    expect(r.dotacoes.filter((l) => l.nivel === 4)).toHaveLength(2)
  })
})
