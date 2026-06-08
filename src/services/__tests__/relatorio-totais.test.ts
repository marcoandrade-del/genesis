import { describe, it, expect } from 'vitest'
import {
  celula,
  analisarColunas,
  totalGeralRow,
  linhaTotal,
  paginar,
  montarRender,
  linhasPorPagina,
  rotuloGeral,
} from '../relatorio-totais.js'

describe('relatorio-totais', () => {
  describe('celula', () => {
    it('formata null/Date/number/string', () => {
      expect(celula(null)).toBe('')
      expect(celula(undefined)).toBe('')
      expect(celula(new Date(2026, 0, 15))).toBe('15/01/2026')
      expect(celula(1234.5)).toBe('1234.5')
      expect(celula('abc')).toBe('abc')
    })
  })

  describe('analisarColunas', () => {
    it('detecta colunas de valor; ignora texto, código (zero à esquerda) e datas', () => {
      const r = {
        colunas: ['conta', 'descricao', 'valor', 'data'],
        linhas: [
          ['001', 'Empenho', '100.50', new Date(2026, 0, 1)],
          ['002', 'Liquidação', '200.25', new Date(2026, 0, 2)],
        ],
      }
      const t = analisarColunas(r)
      expect(t.numericas).toEqual([false, false, true, false]) // conta='001' é código, não valor
      expect(t.soma[2]).toBe(300.75)
      expect(t.decimais[2]).toBe(2)
      expect(t.algumaNumerica).toBe(true)
    })

    it('arredonda a soma às casas da coluna (sem ruído de float)', () => {
      const t = analisarColunas({ colunas: ['v'], linhas: [['0.1'], ['0.2']] })
      expect(t.soma[0]).toBe(0.3)
      expect(t.decimais[0]).toBe(1)
    })

    it('coluna com qualquer célula não-numérica não é de valor', () => {
      const t = analisarColunas({ colunas: ['v'], linhas: [['10'], ['x']] })
      expect(t.numericas[0]).toBe(false)
    })

    it('inteiros e números nativos contam como valor; célula vazia é ignorada', () => {
      const t = analisarColunas({ colunas: ['qtd'], linhas: [[2], [3], [null], ['']] })
      expect(t.numericas[0]).toBe(true)
      expect(t.soma[0]).toBe(5)
      expect(t.decimais[0]).toBe(0)
    })

    it('sem nenhuma coluna de valor → algumaNumerica false', () => {
      expect(analisarColunas({ colunas: ['a'], linhas: [['x'], ['y']] }).algumaNumerica).toBe(false)
    })
  })

  describe('linhaTotal / totalGeralRow', () => {
    const r = { colunas: ['conta', 'valor'], linhas: [['001', '10.00'], ['002', '5.50']] }
    it('rótulo na 1ª coluna não-numérica; números formatados nas casas da coluna', () => {
      const t = analisarColunas(r)
      expect(linhaTotal(t, r.colunas, t.soma, 'TOTAL GERAL')).toEqual(['TOTAL GERAL', '15.50'])
    })
    it('totalGeralRow nulo quando não há valor ou não há linhas', () => {
      expect(totalGeralRow({ colunas: ['a'], linhas: [['x']] })).toBeNull()
      expect(totalGeralRow({ colunas: ['v'], linhas: [] })).toBeNull()
    })
    it('rótulo "parcial" quando truncado', () => {
      expect(rotuloGeral(true)).toContain('parcial')
      const row = totalGeralRow({ ...r, truncado: true })
      expect(row![0]).toContain('parcial')
    })
    it('todas as colunas numéricas → rótulo na coluna 0 (cede a soma dela ao rótulo)', () => {
      const r2 = { colunas: ['a', 'b'], linhas: [['1', '2'], ['3', '4']] }
      const t2 = analisarColunas(r2)
      expect(linhaTotal(t2, r2.colunas, t2.soma, 'TOTAL')).toEqual(['TOTAL', '6'])
    })
  })

  describe('paginar', () => {
    it('quebra em páginas e soma cada subtotal', () => {
      const r = { colunas: ['c', 'v'], linhas: [['a', '1'], ['b', '2'], ['c', '3'], ['d', '4'], ['e', '5']] }
      const t = analisarColunas(r)
      const pgs = paginar(r, t, 2)
      expect(pgs).toHaveLength(3)
      expect(pgs[0]!.linhas).toHaveLength(2)
      expect(pgs[0]!.subtotal).toEqual(['Total da página', '3'])
      expect(pgs[2]!.subtotal).toEqual(['Total da página', '5'])
    })
  })

  describe('montarRender', () => {
    const num = { colunas: ['c', 'v'], linhas: [['a', '1'], ['b', '2'], ['c', '3']] }
    it('sem coluna de valor → só detalhes', () => {
      const { linhas, algumaNumerica } = montarRender({ colunas: ['c'], linhas: [['x'], ['y']] }, 2)
      expect(algumaNumerica).toBe(false)
      expect(linhas.every((l) => l.tipo === 'detalhe')).toBe(true)
    })
    it('uma página → detalhes + total geral, sem subtotal', () => {
      const { linhas } = montarRender(num, 10)
      expect(linhas.filter((l) => l.tipo === 'subtotal')).toHaveLength(0)
      expect(linhas.filter((l) => l.tipo === 'total')).toHaveLength(1)
      expect(linhas.at(-1)!.celulas).toEqual(['TOTAL GERAL', '6'])
    })
    it('múltiplas páginas → subtotal por página + total geral', () => {
      const { linhas } = montarRender(num, 2)
      expect(linhas.filter((l) => l.tipo === 'subtotal')).toHaveLength(2)
      expect(linhas.filter((l) => l.tipo === 'total')).toHaveLength(1)
    })
  })

  describe('linhasPorPagina', () => {
    it('estima pela geometria e respeita os limites [5,80]', () => {
      expect(linhasPorPagina(12, 12)).toBeGreaterThan(20)
      expect(linhasPorPagina(140, 140)).toBe(5) // margens enormes → piso 5
      expect(linhasPorPagina(0, 0)).toBeLessThanOrEqual(80)
    })
  })
})
