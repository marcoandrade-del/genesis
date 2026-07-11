import { describe, it, expect } from 'vitest'
import { naturezaReceita, parseProgramatica, agruparDigitos } from '../codigo.js'

describe('elotech · normalização de códigos', () => {
  it('agrupa a receita nos 12 grupos PCASP', () => {
    expect(agruparDigitos('11125001')).toBe('1.1.1.2.50.0.1')
    // completa com zeros até 12 grupos
    expect(naturezaReceita('11125001')).toBe('1.1.1.2.50.0.1.00.00.00.00.00')
  })

  it('parseia a programática da despesa (nível 11)', () => {
    const c = parseProgramatica('02.010.04.122.0002.2001.3.1.90.07')
    expect(c).toEqual({
      orgao: '02',
      unidade: '010',
      funcao: '04',
      subfuncao: '122',
      programa: '0002',
      acao: '2001',
      naturezaPcasp: '3.1.90.07.00.00',
    })
  })

  it('devolve null para programática fora de 10 posições', () => {
    expect(parseProgramatica('02.010.04.122')).toBeNull()
  })
})
