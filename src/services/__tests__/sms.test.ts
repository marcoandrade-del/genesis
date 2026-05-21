import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const create = vi.fn().mockResolvedValue(undefined)
const twilioFactory = vi.fn(() => ({ messages: { create } }))

vi.mock('twilio', () => ({ default: twilioFactory }))

const ENV_KEYS = ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM_NUMBER'] as const

describe('enviarCodigoSms', () => {
  const envOriginal: Record<string, string | undefined> = {}

  beforeEach(() => {
    for (const k of ENV_KEYS) envOriginal[k] = process.env[k]
    create.mockClear()
    twilioFactory.mockClear()
    vi.resetModules()
  })

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (envOriginal[k] === undefined) delete process.env[k]
      else process.env[k] = envOriginal[k]
    }
  })

  it('cai no mock console quando faltam variáveis de ambiente', async () => {
    for (const k of ENV_KEYS) delete process.env[k]
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { enviarCodigoSms } = await import('../sms.js')

    await enviarCodigoSms('+5511999999999', '123456', 10)

    expect(warn).toHaveBeenCalledOnce()
    expect(warn.mock.calls[0]![0]).toContain('+5511999999999')
    expect(warn.mock.calls[0]![0]).toContain('123456')
    expect(twilioFactory).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('envia via Twilio quando todas as variáveis estão presentes', async () => {
    process.env.TWILIO_ACCOUNT_SID = 'AC_TEST'
    process.env.TWILIO_AUTH_TOKEN = 'tok'
    process.env.TWILIO_FROM_NUMBER = '+15550001111'
    const { enviarCodigoSms } = await import('../sms.js')

    await enviarCodigoSms('+5511999999999', '654321', 5)

    expect(twilioFactory).toHaveBeenCalledWith('AC_TEST', 'tok')
    expect(create).toHaveBeenCalledOnce()
    const args = create.mock.calls[0]![0]
    expect(args.from).toBe('+15550001111')
    expect(args.to).toBe('+5511999999999')
    expect(args.body).toContain('654321')
    expect(args.body).toContain('5 minutos')
  })
})
