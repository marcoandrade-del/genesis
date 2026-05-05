import twilio from 'twilio'

const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER } = process.env

// Falls back to console mock when Twilio env vars are absent (dev/CI without contract).
export async function enviarCodigoSms(telefone: string, codigo: string, expiracaoMin: number) {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM_NUMBER) {
    console.warn(`[SMS MOCK] Para: ${telefone} | Código: ${codigo} | Expira em: ${expiracaoMin}min`)
    return
  }

  const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
  await client.messages.create({
    from: TWILIO_FROM_NUMBER,
    to: telefone,
    body: `Gênesis: seu código de verificação é ${codigo}. Válido por ${expiracaoMin} minutos.`,
  })
}
