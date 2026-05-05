// Mock SMS — substituir por Twilio/Zenvia quando houver contrato
export async function enviarCodigoSms(telefone: string, codigo: string, expiracaoMin: number) {
  console.log(`[SMS MOCK] Para: ${telefone} | Código: ${codigo} | Expira em: ${expiracaoMin}min`)
}
