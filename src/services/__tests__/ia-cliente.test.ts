import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { MotorIaClientHttp, motorDisponivel } from '../ia-cliente.js'

const KEYS = ['ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'OPENAI_API_KEY', 'MARITACA_API_KEY']
const fakeResp = (body: unknown, ok = true, status = 200) => ({ ok, status, json: async () => body })

describe('ia-cliente (porta LLM pluggável)', () => {
  beforeEach(() => KEYS.forEach((k) => delete process.env[k]))
  afterEach(() => {
    KEYS.forEach((k) => delete process.env[k])
    vi.unstubAllGlobals()
  })

  it('motorDisponivel: exige motor conhecido + chave no .env', () => {
    expect(motorDisponivel('claude')).toBe(false)
    process.env.ANTHROPIC_API_KEY = 'k'
    expect(motorDisponivel('claude')).toBe(true)
    expect(motorDisponivel('inexistente')).toBe(false)
  })

  it('chamar sem chave → IA_NAO_CONFIGURADA (mensagem cita a ENV)', async () => {
    await expect(new MotorIaClientHttp().chamar({ motorId: 'gemini', user: 'oi' })).rejects.toMatchObject({
      code: 'IA_NAO_CONFIGURADA',
    })
  })

  it('chamar motor desconhecido → IA_NAO_CONFIGURADA', async () => {
    await expect(new MotorIaClientHttp().chamar({ motorId: 'xx', user: 'oi' })).rejects.toMatchObject({ code: 'IA_NAO_CONFIGURADA' })
  })

  it('claude: usa x-api-key + system + extrai content[0].text', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test'
    const fetchMock = vi.fn().mockResolvedValue(fakeResp({ content: [{ text: 'RESPOSTA' }] }))
    vi.stubGlobal('fetch', fetchMock)
    const r = await new MotorIaClientHttp().chamar({ motorId: 'claude', system: 'S', user: 'U', maxTokens: 100 })
    expect(r.texto).toBe('RESPOSTA')
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('api.anthropic.com')
    expect((init.headers as Record<string, string>)['x-api-key']).toBe('sk-test')
    expect(String(init.body)).toContain('"system":"S"')
  })

  it('gemini: extrai candidates[0].content.parts[0].text', async () => {
    process.env.GEMINI_API_KEY = 'g'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fakeResp({ candidates: [{ content: { parts: [{ text: 'GEM' }] } }] })))
    expect((await new MotorIaClientHttp().chamar({ motorId: 'gemini', user: 'U' })).texto).toBe('GEM')
  })

  it('gpt: extrai choices[0].message.content', async () => {
    process.env.OPENAI_API_KEY = 'o'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fakeResp({ choices: [{ message: { content: 'GPT' } }] })))
    expect((await new MotorIaClientHttp().chamar({ motorId: 'gpt', user: 'U' })).texto).toBe('GPT')
  })

  it('sabia (Maritaca): Authorization Bearer + choices[0].message.content', async () => {
    process.env.MARITACA_API_KEY = 'm'
    const fetchMock = vi.fn().mockResolvedValue(fakeResp({ choices: [{ message: { content: 'SAB' } }] }))
    vi.stubGlobal('fetch', fetchMock)
    expect((await new MotorIaClientHttp().chamar({ motorId: 'sabia', user: 'U' })).texto).toBe('SAB')
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('maritaca')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer m')
  })

  it('HTTP não-ok → IA_FALHOU', async () => {
    process.env.ANTHROPIC_API_KEY = 'k'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fakeResp({}, false, 500)))
    await expect(new MotorIaClientHttp().chamar({ motorId: 'claude', user: 'U' })).rejects.toMatchObject({ code: 'IA_FALHOU' })
  })

  it('falha de rede → IA_FALHOU', async () => {
    process.env.ANTHROPIC_API_KEY = 'k'
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('net')))
    await expect(new MotorIaClientHttp().chamar({ motorId: 'claude', user: 'U' })).rejects.toMatchObject({ code: 'IA_FALHOU' })
  })

  it('resposta vazia → IA_FALHOU', async () => {
    process.env.ANTHROPIC_API_KEY = 'k'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fakeResp({ content: [{ text: '' }] })))
    await expect(new MotorIaClientHttp().chamar({ motorId: 'claude', user: 'U' })).rejects.toMatchObject({ code: 'IA_FALHOU' })
  })
})
