import { describe, it, expect } from 'vitest'
import { parseFiltroConsulta } from '../filtro-consulta.js'

describe('parseFiltroConsulta', () => {
  it('aceita datas ISO do exercício', () => {
    const f = parseFiltroConsulta({ de: '2026-03-01', ate: '2026-03-31' }, 2026)
    expect(f.de?.toISOString().slice(0, 10)).toBe('2026-03-01')
    expect(f.ate?.toISOString().slice(0, 10)).toBe('2026-03-31')
    expect(f.deStr).toBe('2026-03-01')
    expect(f.ateStr).toBe('2026-03-31')
  })

  it('ignora data fora do exercício', () => {
    const f = parseFiltroConsulta({ de: '2025-12-31', ate: '2027-01-01' }, 2026)
    expect(f.de).toBeUndefined()
    expect(f.ate).toBeUndefined()
    expect(f.deStr).toBe('')
    expect(f.ateStr).toBe('')
  })

  it('ignora formato inválido', () => {
    const f = parseFiltroConsulta({ de: '01/03/2026', ate: 'lixo' }, 2026)
    expect(f.de).toBeUndefined()
    expect(f.ate).toBeUndefined()
  })

  it('normaliza contas: array, string única e vazio', () => {
    expect(parseFiltroConsulta({ contas: ['a', 'b'] }, 2026).contaIds).toEqual(['a', 'b'])
    expect(parseFiltroConsulta({ contas: 'x' }, 2026).contaIds).toEqual(['x'])
    expect(parseFiltroConsulta({}, 2026).contaIds).toEqual([])
  })
})
