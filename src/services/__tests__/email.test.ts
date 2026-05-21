import { describe, it, expect, beforeEach, vi } from 'vitest'

const sendMail = vi.fn().mockResolvedValue(undefined)

vi.mock('nodemailer', () => ({
  default: { createTransport: vi.fn(() => ({ sendMail })) },
}))

const { enviarCodigoEmail } = await import('../email.js')

describe('enviarCodigoEmail', () => {
  beforeEach(() => {
    sendMail.mockClear()
  })

  it('envia e-mail sem link de validação', async () => {
    await enviarCodigoEmail('alvo@exemplo.com', '123456', 10)
    expect(sendMail).toHaveBeenCalledOnce()
    const args = sendMail.mock.calls[0]![0]
    expect(args.to).toBe('alvo@exemplo.com')
    expect(args.subject).toContain('Gênesis')
    expect(args.html).toContain('123456')
    expect(args.html).toContain('10 minutos')
    expect(args.html).not.toContain('Validar e-mail')
  })

  it('envia e-mail com botão de validação quando link é fornecido', async () => {
    await enviarCodigoEmail('alvo@exemplo.com', '654321', 5, 'https://app.example.com/ativar/u1')
    expect(sendMail).toHaveBeenCalledOnce()
    const args = sendMail.mock.calls[0]![0]
    expect(args.html).toContain('https://app.example.com/ativar/u1')
    expect(args.html).toContain('Validar e-mail')
  })
})
