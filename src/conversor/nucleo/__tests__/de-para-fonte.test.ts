import { describe, it, expect } from 'vitest'
import { casarFontesPorDescricao } from '../de-para-fonte.js'

describe('de/para de fonte por descrição', () => {
  const tce = [
    { codigo: '000', descricao: 'Recursos Ordinários (Livres)' },
    { codigo: '1045', descricao: 'Outros Recursos não Vinculados' },
    { codigo: '040', descricao: 'Regime Próprio de Previdência Social – RPPS' },
    { codigo: '100', descricao: 'Reservas de Sobras da Taxa de Administração do RPPS' },
  ]
  const ipm = [
    { codigo: '01000', descricao: 'Recursos Ordinários (Livres)' },
    { codigo: '01045', descricao: 'Outros Recursos não Vinculados' },
    { codigo: '01040', descricao: 'Regime Próprio de Previdência Social' }, // difere: sem "– RPPS"
    { codigo: '01100', descricao: 'Reserva de Sobras da Taxa de Administração do RPPS' }, // "Reserva" x "Reservas"
  ]

  it('casa exato pela descrição', () => {
    const m = casarFontesPorDescricao(tce, ipm)
    expect(m.get('000')).toBe('01000')
    expect(m.get('1045')).toBe('01045')
  })

  it('casa por fuzzy quando a descrição difere por 1 token', () => {
    const m = casarFontesPorDescricao(tce, ipm)
    expect(m.get('040')).toBe('01040') // "…Social – RPPS" ~ "…Social"
    expect(m.get('100')).toBe('01100') // "Reservas" ~ "Reserva"
  })

  it('não casa o que não tem par (abaixo do limiar)', () => {
    const m = casarFontesPorDescricao([{ codigo: '999', descricao: 'Convênio Federal Xyz Específico' }], ipm)
    expect(m.has('999')).toBe(false)
  })
})
