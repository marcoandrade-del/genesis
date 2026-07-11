import { describe, it, expect } from 'vitest'
import { reconciliarDespesa } from '../reconciliar.js'
import type { LinhaDespesa } from '../tipos.js'

const base = (fonte: { codigo: string; descricao: string }, over: Partial<LinhaDespesa> = {}): LinhaDespesa => ({
  orgao: { codigo: '02', nome: 'Governo' },
  unidade: { codigo: '001', nome: 'Gabinete' },
  funcao: '04',
  subfuncao: '122',
  programa: { codigo: '0001' },
  acao: { codigo: '2000' },
  naturezaPcasp: '3.1.90.11.00.00',
  fonte,
  ...over,
})

describe('reconciliarDespesa (orçado LOA × empenhado TCE)', () => {
  it('funde na mesma dotação quando a fonte casa por descrição (código diverge)', () => {
    const loa = [base({ codigo: '01000', descricao: 'Recursos Ordinários (Livres)' }, { autorizado: 10_000_00 })]
    const exec = [base({ codigo: '000', descricao: 'Recursos Ordinários (Livres)' }, { empenhado: 4_000_00, liquidado: 3_000_00 })]
    const m = reconciliarDespesa(loa, exec)
    expect(m).toHaveLength(1)
    expect(m[0]!.fonte.codigo).toBe('01000') // re-chaveado p/ a fonte da LOA
    expect(m[0]!.autorizado).toBe(10_000_00)
    expect(m[0]!.empenhado).toBe(4_000_00)
    expect(m[0]!.liquidado).toBe(3_000_00)
  })

  it('execução sem LOA correspondente vira dotação própria (mantém a fonte do TCE)', () => {
    const loa: LinhaDespesa[] = []
    const exec = [base({ codigo: '107', descricao: 'Salário-Educação' }, { empenhado: 500_00 })]
    const m = reconciliarDespesa(loa, exec)
    expect(m).toHaveLength(1)
    expect(m[0]!.fonte.codigo).toBe('107')
    expect(m[0]!.autorizado).toBeUndefined()
    expect(m[0]!.empenhado).toBe(500_00)
  })

  it('agrega execução de mesma chave', () => {
    const f = { codigo: '000', descricao: 'Recursos Ordinários (Livres)' }
    const m = reconciliarDespesa([], [base(f, { empenhado: 100_00 }), base(f, { empenhado: 50_00 })])
    expect(m).toHaveLength(1)
    expect(m[0]!.empenhado).toBe(150_00)
  })
})
