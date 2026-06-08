import { describe, it, expect } from 'vitest'

import { ESCOPO, resumirEscopo, type AreaEscopo } from '../escopo.js'

describe('resumirEscopo', () => {
  it('conta itens por status e calcula o percentual concluído', () => {
    const areas: AreaEscopo[] = [
      {
        nome: 'A',
        icone: 'x',
        descricao: '',
        itens: [
          { titulo: 't1', descricao: '', status: 'PRONTO' },
          { titulo: 't2', descricao: '', status: 'PRONTO' },
          { titulo: 't3', descricao: '', status: 'EM_ANDAMENTO' },
        ],
      },
      {
        nome: 'B',
        icone: 'y',
        descricao: '',
        itens: [{ titulo: 't4', descricao: '', status: 'A_FAZER' }],
      },
    ]

    expect(resumirEscopo(areas)).toEqual({
      total: 4,
      pronto: 2,
      emAndamento: 1,
      aFazer: 1,
      percentConcluido: 50, // 2/4
    })
  })

  it('arredonda o percentual', () => {
    const areas: AreaEscopo[] = [
      {
        nome: 'A',
        icone: 'x',
        descricao: '',
        itens: [
          { titulo: 't1', descricao: '', status: 'PRONTO' },
          { titulo: 't2', descricao: '', status: 'A_FAZER' },
          { titulo: 't3', descricao: '', status: 'A_FAZER' },
        ],
      },
    ]
    // 1/3 = 33,33% → 33
    expect(resumirEscopo(areas).percentConcluido).toBe(33)
  })

  it('retorna zero quando não há itens', () => {
    expect(resumirEscopo([])).toEqual({
      total: 0,
      pronto: 0,
      emAndamento: 0,
      aFazer: 0,
      percentConcluido: 0,
    })
  })
})

describe('ESCOPO (dados do roadmap)', () => {
  it('tem ao menos uma área e o resumo bate com a contagem manual', () => {
    expect(ESCOPO.length).toBeGreaterThan(0)

    const r = resumirEscopo(ESCOPO)
    const totalItens = ESCOPO.reduce((acc, a) => acc + a.itens.length, 0)
    expect(r.total).toBe(totalItens)
    expect(r.pronto + r.emAndamento + r.aFazer).toBe(r.total)
    expect(r.percentConcluido).toBeGreaterThanOrEqual(0)
    expect(r.percentConcluido).toBeLessThanOrEqual(100)
  })

  it('todo item tem status válido e título/descrição não vazios', () => {
    const validos = new Set(['PRONTO', 'EM_ANDAMENTO', 'A_FAZER'])
    for (const area of ESCOPO) {
      expect(area.nome).not.toBe('')
      expect(area.icone).not.toBe('')
      for (const item of area.itens) {
        expect(validos.has(item.status)).toBe(true)
        expect(item.titulo).not.toBe('')
        expect(item.descricao).not.toBe('')
      }
    }
  })
})
