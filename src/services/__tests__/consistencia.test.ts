import { describe, it, expect, beforeEach, vi } from 'vitest'

const m = vi.hoisted(() => ({ simples: vi.fn(), pessoalExec: vi.fn(), dcl: vi.fn() }))
vi.mock('../rgf-simplificado.js', () => ({ RgfSimplificadoService: class { calcular = m.simples } }))
vi.mock('../despesa-pessoal.js', async (orig) => ({
  ...(await orig() as object),
  DespesaPessoalService: class { calcularExecutado = m.pessoalExec },
}))
vi.mock('../dcl.js', () => ({ DclService: class { calcular = m.dcl } }))

import { Prisma } from '@prisma/client'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'
import { ConsistenciaService } from '../consistencia.js'

const dec = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v)
const porCodigo = (r: { verificacoes: { codigo: string }[] }, c: string) =>
  (r.verificacoes as { codigo: string; status: string; delta: number | null; detalhe: string }[]).find((v) => v.codigo === c)!

describe('ConsistenciaService', () => {
  let prisma: PrismaMock
  let svc: ConsistenciaService

  beforeEach(() => {
    prisma = criarPrismaMock()
    svc = new ConsistenciaService(prisma as never)
    prisma.orcamento.findUnique.mockResolvedValue({ id: 'o1' })
    prisma.entidade.findUnique.mockResolvedValue({ municipio: { estado: { sigla: 'PR', pessoalComposicao: null, modeloContabil: null } } })
    // base coerente por padrão (tudo OK)
    prisma.arrecadacao.findMany.mockResolvedValue([
      { tipo: 'ARRECADACAO', valor: dec(120) },
      { tipo: 'ESTORNO', valor: dec(20) },
    ])
    prisma.previsaoReceita.aggregate.mockResolvedValue({ _sum: { valorArrecadado: dec(100), valorPrevisto: dec(1000) } })
    prisma.movimentoEmpenho.findMany.mockResolvedValue([
      { tipo: 'EMPENHO', valor: dec(500) },
      { tipo: 'ESTORNO_EMPENHO', valor: dec(50) },
      { tipo: 'LIQUIDACAO', valor: dec(300) },
      { tipo: 'PAGAMENTO', valor: dec(250) }, // não entra em empenhado/liquidado
    ])
    prisma.empenho.aggregate.mockResolvedValue({ _sum: { valor: dec(450), valorLiquidado: dec(300) } })
    prisma.dotacaoDespesa.aggregate.mockResolvedValue({ _sum: { valorAutorizado: dec(1080), valorEmpenhado: dec(450) } })
    prisma.creditoAdicionalItem.findMany.mockResolvedValue([
      { operacao: 'REFORCO', valor: dec(100) },
      { operacao: 'ANULACAO', valor: dec(20) },
    ])
    prisma.dotacaoDespesa.findMany.mockResolvedValue([
      { valorAutorizado: dec(1080), valorEmpenhado: dec(450), valorReservado: dec(0) },
    ])
    m.simples.mockResolvedValue({ linhas: [
      { rotulo: 'Despesa Total com Pessoal — DTP (executada)', valor: 200 },
      { rotulo: 'Dívida Consolidada Líquida — DCL', valor: -50 },
    ] })
    m.pessoalExec.mockResolvedValue({ dtp: 200 })
    m.dcl.mockResolvedValue({ dcl: -50 })
    prisma.sincronizacaoPortal.findMany.mockResolvedValue([
      { tipo: 'ARRECADACAO', status: 'OK', criadoEm: new Date() },
      { tipo: 'DESPESA_EXECUCAO', status: 'OK', criadoEm: new Date() },
    ])
  })

  it('base coerente → selo 8/8', async () => {
    const r = await svc.verificar('e1', 2026)
    expect(r.selo).toEqual({ aprovadas: 8, avaliadas: 8, total: 8 })
    expect(r.verificacoes.every((v) => v.status === 'OK')).toBe(true)
  })

  it('V1 pega drift entre movimentos e materializado, com Δ exposto', async () => {
    prisma.previsaoReceita.aggregate.mockResolvedValue({ _sum: { valorArrecadado: dec(90), valorPrevisto: dec(1000) } })
    const r = await svc.verificar('e1', 2026)
    const v1 = porCodigo(r, 'V1_ARRECADACAO')
    expect(v1.status).toBe('DIVERGENTE')
    expect(v1.delta).toBe(-10) // materializado 90 − razão 100
    expect(r.selo.aprovadas).toBe(7)
  })

  it('V5 pega crédito aplicado fora da máquina (autorizado editado na mão)', async () => {
    // autorizado 1200, créditos líquidos 80 → volta 1120 ≠ receita 1000
    prisma.dotacaoDespesa.aggregate.mockResolvedValue({ _sum: { valorAutorizado: dec(1200), valorEmpenhado: dec(450) } })
    const r = await svc.verificar('e1', 2026)
    const v5 = porCodigo(r, 'V5_EQUILIBRIO_CREDITOS')
    expect(v5.status).toBe('DIVERGENTE')
    expect(v5.delta).toBe(120)
  })

  it('V5 agrega TODAS as entidades do município (equilíbrio é do ente, não de cada entidade)', async () => {
    prisma.entidade.findUnique.mockResolvedValue({
      municipioId: 'm1',
      municipio: { estado: { sigla: 'PR', pessoalComposicao: null, modeloContabil: null } },
    })
    prisma.orcamento.findMany.mockResolvedValue([{ id: 'o1' }, { id: 'o2' }])
    // Σ município: prevista 2000 = autorizado 2080 − créditos 80 (por entidade não fecharia)
    prisma.previsaoReceita.aggregate.mockResolvedValue({ _sum: { valorArrecadado: dec(100), valorPrevisto: dec(2000) } })
    prisma.dotacaoDespesa.aggregate.mockResolvedValue({ _sum: { valorAutorizado: dec(2080), valorEmpenhado: dec(450) } })
    const r = await svc.verificar('e1', 2026)
    const v5 = porCodigo(r, 'V5_EQUILIBRIO_CREDITOS')
    expect(v5.status).toBe('OK')
    expect(v5.detalhe).toContain('2 entidade(s)')
    // agregação consultou os orçamentos do município, não só o da entidade
    expect(prisma.orcamento.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ entidade: { is: { municipioId: 'm1', ativo: true } } }) }),
    )
  })

  it('V6 conta dotações estouradas', async () => {
    prisma.dotacaoDespesa.findMany.mockResolvedValue([
      { valorAutorizado: dec(100), valorEmpenhado: dec(90), valorReservado: dec(20) }, // estourada
      { valorAutorizado: dec(100), valorEmpenhado: dec(100), valorReservado: dec(0) }, // no limite = ok
    ])
    const r = await svc.verificar('e1', 2026)
    const v6 = porCodigo(r, 'V6_SEM_ESTOURO')
    expect(v6.status).toBe('DIVERGENTE')
    expect(v6.detalhe).toContain('1 dotação')
  })

  it('V7 pega divergência entre Anexo 6 e os anexos-fonte', async () => {
    m.dcl.mockResolvedValue({ dcl: -60 }) // fonte diz −60, simplificado diz −50
    const r = await svc.verificar('e1', 2026)
    expect(porCodigo(r, 'V7_ANEXO6_FONTES').status).toBe('DIVERGENTE')
  })

  it('V8: última sincronização DIVERGENTE derruba o selo; sem execuções = não aplicável', async () => {
    prisma.sincronizacaoPortal.findMany.mockResolvedValue([
      { tipo: 'ARRECADACAO', status: 'DIVERGENTE', criadoEm: new Date() },
      { tipo: 'ARRECADACAO', status: 'OK', criadoEm: new Date(Date.now() - 86400000) }, // antiga OK não salva
    ])
    const r = await svc.verificar('e1', 2026)
    expect(porCodigo(r, 'V8_SINCRONIZACAO').status).toBe('DIVERGENTE')

    prisma.sincronizacaoPortal.findMany.mockResolvedValue([])
    const r2 = await svc.verificar('e1', 2026)
    expect(porCodigo(r2, 'V8_SINCRONIZACAO').status).toBe('NAO_APLICAVEL')
    expect(r2.selo.avaliadas).toBe(7)
  })

  it('sem orçamento → único item não aplicável', async () => {
    prisma.orcamento.findUnique.mockResolvedValue(null)
    const r = await svc.verificar('e1', 2026)
    expect(r.selo).toEqual({ aprovadas: 0, avaliadas: 0, total: 1 })
    expect(r.verificacoes[0]!.status).toBe('NAO_APLICAVEL')
  })
})
