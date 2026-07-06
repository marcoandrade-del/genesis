import { describe, it, expect } from 'vitest'
import { periodoQuadrimestre, quadrimestreCorrente, parseQuadrimestre, formatarDataUtc } from '../quadrimestre.js'

describe('periodoQuadrimestre', () => {
  it('1º quadrimestre: jan–abr, publicação até 30/05', () => {
    const p = periodoQuadrimestre(2026, 1)
    expect(p.inicio.toISOString().slice(0, 10)).toBe('2026-01-01')
    expect(p.fim.toISOString().slice(0, 10)).toBe('2026-04-30')
    expect(p.prazoPublicacao.toISOString().slice(0, 10)).toBe('2026-05-30')
    expect(p.rotulo).toBe('1º Quadrimestre (janeiro a abril)')
    expect(p.mesFim).toBe(4)
  })

  it('2º quadrimestre: mai–ago, publicação até 30/09', () => {
    const p = periodoQuadrimestre(2026, 2)
    expect(p.fim.toISOString().slice(0, 10)).toBe('2026-08-31')
    expect(p.prazoPublicacao.toISOString().slice(0, 10)).toBe('2026-09-30')
    expect(p.mesFim).toBe(8)
  })

  it('3º quadrimestre: set–dez, publicação até 30/01 do ano seguinte', () => {
    const p = periodoQuadrimestre(2026, 3)
    expect(p.inicio.toISOString().slice(0, 10)).toBe('2026-09-01')
    expect(p.fim.toISOString().slice(0, 10)).toBe('2026-12-31')
    expect(p.prazoPublicacao.toISOString().slice(0, 10)).toBe('2027-01-30')
  })
})

describe('quadrimestreCorrente', () => {
  it('segue o mês dentro do exercício', () => {
    expect(quadrimestreCorrente(2026, new Date(2026, 0, 15))).toBe(1)
    expect(quadrimestreCorrente(2026, new Date(2026, 3, 30))).toBe(1)
    expect(quadrimestreCorrente(2026, new Date(2026, 4, 1))).toBe(2)
    expect(quadrimestreCorrente(2026, new Date(2026, 6, 6))).toBe(2)
    expect(quadrimestreCorrente(2026, new Date(2026, 8, 1))).toBe(3)
    expect(quadrimestreCorrente(2026, new Date(2026, 11, 31))).toBe(3)
  })

  it('exercício fechado → 3º; futuro → 1º', () => {
    expect(quadrimestreCorrente(2025, new Date(2026, 6, 6))).toBe(3)
    expect(quadrimestreCorrente(2027, new Date(2026, 6, 6))).toBe(1)
  })
})

describe('parseQuadrimestre', () => {
  const hoje = new Date(2026, 6, 6) // jul → corrente = 2
  it('lê 1/2/3 da query', () => {
    expect(parseQuadrimestre('1', 2026, hoje)).toBe(1)
    expect(parseQuadrimestre('3', 2026, hoje)).toBe(3)
  })
  it('inválido/ausente cai no corrente', () => {
    expect(parseQuadrimestre(undefined, 2026, hoje)).toBe(2)
    expect(parseQuadrimestre('x', 2026, hoje)).toBe(2)
    expect(parseQuadrimestre('4', 2026, hoje)).toBe(2)
  })
})

describe('formatarDataUtc', () => {
  it('dd/mm/aaaa em UTC', () => {
    expect(formatarDataUtc(new Date(Date.UTC(2026, 8, 30)))).toBe('30/09/2026')
  })
})
