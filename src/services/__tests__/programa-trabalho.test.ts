import { describe, it, expect, beforeEach } from 'vitest'
import { ProgramaTrabalhoService } from '../programa-trabalho.js'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'

let prisma: PrismaMock
let service: ProgramaTrabalhoService

beforeEach(() => {
  prisma = criarPrismaMock()
  service = new ProgramaTrabalhoService(prisma as never)
})

const dot = (uo: string, fn: string, sf: string, pr: string, ac: string, valor: number) => ({
  valorAutorizado: valor,
  unidadeOrcamentaria: { codigo: uo, nome: `UO ${uo}` },
  funcao: { codigo: fn, nome: `Função ${fn}` },
  subfuncao: { codigo: sf, nome: `Subfunção ${sf}` },
  programa: { codigo: pr, nome: `Programa ${pr}` },
  acao: { codigo: ac, nome: `Ação ${ac}` },
})

describe('ProgramaTrabalhoService.calcular', () => {
  it('retorna vazio quando não há orçamento', async () => {
    prisma.orcamento.findUnique.mockResolvedValue(null)
    const r = await service.calcular('ent1', 2026)
    expect(r).toEqual({ temOrcamento: false, total: 0, linhas: [] })
  })

  it('cruza a funcional-programática com subtotais em pré-ordem', async () => {
    prisma.orcamento.findUnique.mockResolvedValue({ id: 'o1' })
    // Entrada fora de ordem (UO 05 antes da 02) para o sort precisar inverter.
    prisma.dotacaoDespesa.findMany.mockResolvedValue([
      dot('05', '10', '301', '0010', '2010', 200),
      dot('02', '04', '122', '0001', '2001', 100),
      dot('02', '04', '122', '0001', '2002', 50),
      dot('02', '04', '131', '0002', '2003', 30),
    ])

    const r = await service.calcular('ent1', 2026)
    expect(r.temOrcamento).toBe(true)
    expect(r.total).toBe(380)

    const resumo = r.linhas.map((l) => `${l.nivel}:${l.codigo}=${l.valor}`)
    expect(resumo).toEqual([
      '1:02=180', // UO 02 = 100+50+30
      '2:04=180',
      '3:122=150', // subfunção 122 = 100+50
      '4:0001=150',
      '5:2001=100',
      '5:2002=50',
      '3:131=30',
      '4:0002=30',
      '5:2003=30',
      '1:05=200', // UO 05 vem depois de todos os descendentes da 02
      '2:10=200',
      '3:301=200',
      '4:0010=200',
      '5:2010=200',
    ])
    expect(r.linhas[0]).toMatchObject({ codigo: '02', rotulo: 'UO 02', nivel: 1, valor: 180 })
  })

  it('soma dos níveis 1 fecha com o total', async () => {
    prisma.orcamento.findUnique.mockResolvedValue({ id: 'o1' })
    prisma.dotacaoDespesa.findMany.mockResolvedValue([
      dot('02', '04', '122', '0001', '2001', 100.005),
      dot('05', '10', '301', '0010', '2010', 200),
    ])
    const r = await service.calcular('ent1', 2026)
    const somaUO = r.linhas.filter((l) => l.nivel === 1).reduce((s, l) => s + l.valor, 0)
    expect(Math.round(somaUO * 100) / 100).toBe(r.total)
  })

  it('calcularPor com ordem custom (função → programa → subfunção) consolida sem UO', async () => {
    prisma.orcamento.findUnique.mockResolvedValue({ id: 'o1' })
    // Duas UOs diferentes na MESMA função 04 — devem consolidar (sem nível de UO).
    prisma.dotacaoDespesa.findMany.mockResolvedValue([
      dot('02', '04', '122', '0001', '2001', 100),
      dot('07', '04', '122', '0001', '2099', 40),
      dot('02', '04', '131', '0002', '2003', 30),
    ])
    const r = await service.calcularPor('ent1', 2026, ['funcao', 'programa', 'subfuncao'])
    const resumo = r.linhas.map((l) => `${l.nivel}:${l.codigo}=${l.valor}`)
    expect(resumo).toEqual([
      '1:04=170', // função 04 consolidada das duas UOs
      '2:0001=140', // programa 0001 = 100+40
      '3:122=140', // subfunção 122 sob o programa
      '2:0002=30',
      '3:131=30',
    ])
    expect(r.total).toBe(170)
  })
})
