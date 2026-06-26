import { describe, it, expect } from 'vitest'
import { validarBrasao } from '../brasao.js'

describe('validarBrasao', () => {
  it('string vazia → sem brasão (null)', () => {
    expect(validarBrasao('   ')).toEqual({ ok: true, valor: null })
  })

  it('data URL de imagem válida é aceita', () => {
    const v = 'data:image/png;base64,iVBORw0KGgo='
    expect(validarBrasao(v)).toEqual({ ok: true, valor: v })
  })

  it('rejeita o que não é data URL de imagem', () => {
    const r = validarBrasao('http://exemplo/logo.png')
    expect(r.ok).toBe(false)
  })

  it('rejeita imagem acima do limite de tamanho', () => {
    const gigante = 'data:image/png;base64,' + 'A'.repeat(1.6 * 1024 * 1024)
    const r = validarBrasao(gigante)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.erro).toContain('muito grande')
  })
})
