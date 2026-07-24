import { describe, it, expect } from 'vitest'
import { criarRitmo, dentroDaJanelaGentil, JanelaFechada, RitmoEsgotado } from '../empenhos.js'

describe('dentroDaJanelaGentil (22h–06h + fim de semana, hora local)', () => {
  // 2026-07-22 = quarta · 2026-07-25 = sábado · 2026-07-26 = domingo
  it('madrugada e noite de dia útil: dentro', () => {
    expect(dentroDaJanelaGentil(new Date(2026, 6, 22, 23, 0))).toBe(true)
    expect(dentroDaJanelaGentil(new Date(2026, 6, 22, 22, 0))).toBe(true)
    expect(dentroDaJanelaGentil(new Date(2026, 6, 22, 3, 0))).toBe(true)
    expect(dentroDaJanelaGentil(new Date(2026, 6, 22, 5, 59))).toBe(true)
  })
  it('horário comercial de dia útil: fora', () => {
    expect(dentroDaJanelaGentil(new Date(2026, 6, 22, 6, 0))).toBe(false)
    expect(dentroDaJanelaGentil(new Date(2026, 6, 22, 12, 0))).toBe(false)
    expect(dentroDaJanelaGentil(new Date(2026, 6, 22, 21, 59))).toBe(false)
  })
  it('fim de semana: dentro o dia todo', () => {
    expect(dentroDaJanelaGentil(new Date(2026, 6, 25, 14, 0))).toBe(true)
    expect(dentroDaJanelaGentil(new Date(2026, 6, 26, 9, 0))).toBe(true)
  })
})

/** ritmo com sleeps capturados e jitter neutro (aleatorio=0.5 → fator 1.0). */
function ritmoDeTeste(opts: Parameters<typeof criarRitmo>[0] = {}) {
  const sonos: number[] = []
  const ritmo = criarRitmo({ dormir: async (ms) => { sonos.push(ms) }, aleatorio: () => 0.5, ...opts })
  return { ritmo, sonos }
}

describe('criarRitmo', () => {
  it('pacing: antes() dorme a pausa base', async () => {
    const { ritmo, sonos } = ritmoDeTeste()
    await ritmo.antes()
    expect(sonos).toEqual([1200])
  })

  it('adaptação: latência acima do limiar dobra a pausa (até o teto); normaliza decai de volta ao base', async () => {
    const { ritmo } = ritmoDeTeste()
    ritmo.depois(5_000) // > limiar 4s
    expect(ritmo.estado().pausaMs).toBe(2_400)
    for (let i = 0; i < 10; i++) ritmo.depois(5_000)
    expect(ritmo.estado().pausaMs).toBe(10_000) // teto
    for (let i = 0; i < 50; i++) ritmo.depois(200)
    expect(ritmo.estado().pausaMs).toBe(1_200) // volta ao base, nunca abaixo
  })

  it('circuit breaker: cooldown exponencial e RitmoEsgotado após o máximo', async () => {
    const { ritmo, sonos } = ritmoDeTeste({ maxCooldowns: 2 })
    await ritmo.falha('x', 'HTTP 502')
    await ritmo.falha('x', 'HTTP 502')
    expect(sonos).toEqual([300_000, 600_000])
    await expect(ritmo.falha('x', 'HTTP 502')).rejects.toThrow(RitmoEsgotado)
  })

  it('janela: antes() lança JanelaFechada fora da janela; cooldown que atravessa o fim idem', async () => {
    let dentro = true
    const { ritmo } = ritmoDeTeste({ dentroDaJanela: () => dentro })
    await ritmo.antes() // dentro: ok
    dentro = false
    await expect(ritmo.antes()).rejects.toThrow(JanelaFechada)
    dentro = true
    const p = ritmoDeTeste({ dentroDaJanela: () => dentro, dormir: async () => { dentro = false } })
    await expect(p.ritmo.falha('x', 'timeout')).rejects.toThrow(JanelaFechada)
  })
})
