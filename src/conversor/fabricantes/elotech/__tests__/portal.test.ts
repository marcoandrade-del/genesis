import { describe, it, expect, vi, afterEach } from 'vitest'
import { lerDespesa } from '../portal.js'

/** Stub de `fetch` que devolve sempre o mesmo payload (lerDespesa faz 1 GET). */
function mockFetch(payload: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => payload })),
  )
}
afterEach(() => vi.unstubAllGlobals())

describe('elotech · portal.lerDespesa', () => {
  it('detecta a folha por aceitaMovimentacao (não por nível fixo) e traz a execução do portal', async () => {
    const rows = [
      { programatica: '02', descricao: 'ÓRGÃO', nivel: 1, aceitaMovimentacao: 'N', valorPrevisto: 100, valorEmpenhado: 50, valorLiquidado: 40, valorPago: 30 },
      // folha num nível "não-11" (Elotech antigo / variações) → DEVE entrar
      { programatica: '02.010.04.122.0002.2001.3.1.90.07', descricao: 'FOLHA', nivel: 9, aceitaMovimentacao: 'S', valorPrevisto: 1000, valorEmpenhado: 600, valorLiquidado: 500, valorPago: 400 },
      // nó no nível 11 mas NÃO-folha (aceita 'N') → DEVE ser ignorado
      { programatica: '02.010.04.122.0002.2001.3.1.90', descricao: 'INTERMEDIÁRIO', nivel: 11, aceitaMovimentacao: 'N', valorPrevisto: 999, valorEmpenhado: 999, valorLiquidado: 999, valorPago: 999 },
    ]
    mockFetch(rows)
    const linhas = await lerDespesa('http://x', 2026, '1')
    expect(linhas).toHaveLength(1)
    const l = linhas[0]!
    expect(l.naturezaPcasp).toBe('3.1.90.07.00.00')
    expect(l.autorizado).toBe(100_000) // 1000 * 100 centavos
    expect(l.empenhado).toBe(60_000)
    expect(l.liquidado).toBe(50_000)
    expect(l.pago).toBe(40_000)
    expect(l.fonte.codigo).toBe('9999') // portal não publica fonte por dotação
  })

  it('inclui folha só-executada (previsto 0, empenhado > 0)', async () => {
    const rows = [{ programatica: '02.010.04.122.0002.2001.3.1.90.07', descricao: 'FOLHA', nivel: 11, aceitaMovimentacao: 'S', valorPrevisto: 0, valorEmpenhado: 700, valorLiquidado: 0, valorPago: 0 }]
    mockFetch(rows)
    const linhas = await lerDespesa('http://x', 2026, '1')
    expect(linhas).toHaveLength(1)
    expect(linhas[0]!.autorizado).toBe(0)
    expect(linhas[0]!.empenhado).toBe(70_000)
  })

  it('ignora folha sem previsto nem execução', async () => {
    const rows = [{ programatica: '02.010.04.122.0002.2001.3.1.90.07', descricao: 'FOLHA', nivel: 11, aceitaMovimentacao: 'S', valorPrevisto: 0, valorEmpenhado: 0, valorLiquidado: 0, valorPago: 0 }]
    mockFetch(rows)
    expect(await lerDespesa('http://x', 2026, '1')).toHaveLength(0)
  })
})
