import { describe, it, expect } from 'vitest'
import { naturezaReceita, parseProgramatica, agruparDigitos, dotificarProgramatica } from '../codigo.js'

describe('elotech · normalização de códigos', () => {
  it('agrupa a receita nos 12 grupos PCASP', () => {
    expect(agruparDigitos('11125001')).toBe('1.1.1.2.50.0.1')
    // completa com zeros até 12 grupos
    expect(naturezaReceita('11125001')).toBe('1.1.1.2.50.0.1.00.00.00.00.00')
  })

  it('aceita código JÁ PONTUADO sem corromper (regressão 2026-07-22)', () => {
    // alguns portais entregam a natureza já pontuada; fatiá-la como dígitos
    // crus corrompia p/ "1...1..1..2...50..0..1" (municípios de 21/07)
    expect(naturezaReceita('1.1.1.2.50.0.1')).toBe('1.1.1.2.50.0.1.00.00.00.00.00')
    expect(naturezaReceita('1.7.2.3.50.0.1.0.1')).toBe('1.7.2.3.50.0.1.0.1.00.00.00')
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

  it('dotifica a programática CONCATENADA do Elotech legado (folha 24 dígitos)', () => {
    // Sarandi (eloweb.net): sem pontos → padrão pontuado nas fronteiras fixas.
    expect(dotificarProgramatica('040010412200061061449040')).toBe('04.001.04.122.0006.1061.4.4.90.40')
  })

  it('dotifica nós intermediários (só os pontos que couberem)', () => {
    expect(dotificarProgramatica('04')).toBe('04') // órgão
    expect(dotificarProgramatica('04001')).toBe('04.001') // órgão+unidade
    expect(dotificarProgramatica('04001041220006')).toBe('04.001.04.122.0006') // até programa
  })

  it('a folha concatenada dotificada parseia igual à pontuada', () => {
    const c = parseProgramatica(dotificarProgramatica('040010412200061061449040'))
    expect(c).toEqual({
      orgao: '04',
      unidade: '001',
      funcao: '04',
      subfuncao: '122',
      programa: '0006',
      acao: '1061',
      naturezaPcasp: '4.4.90.40.00.00',
    })
  })
})
