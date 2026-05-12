import nodemailer from 'nodemailer'

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
})

export async function enviarCodigoEmail(destinatario: string, codigo: string, expiracaoMin: number, link?: string) {
  const botaoLink = link
    ? `<div style="text-align:center;margin:20px 0">
         <a href="${link}" style="display:inline-block;background:#0d6efd;color:white;text-decoration:none;
            padding:12px 28px;border-radius:6px;font-weight:600">Validar e-mail</a>
       </div>`
    : ''

  await transporter.sendMail({
    from: `"Gênesis" <${process.env.GMAIL_USER}>`,
    to: destinatario,
    subject: 'Código de verificação — Gênesis',
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:auto">
        <h2 style="color:#0d6efd">Verificação de e-mail</h2>
        <p>Use o código abaixo para validar seu e-mail. Ele expira em <strong>${expiracaoMin} minutos</strong>.</p>
        <div style="font-size:2rem;font-weight:bold;letter-spacing:8px;text-align:center;
                    background:#f8f9fa;border-radius:8px;padding:20px;margin:20px 0">
          ${codigo}
        </div>
        ${botaoLink}
        <p style="color:#6c757d;font-size:0.85rem">Se você não solicitou esse código, ignore este e-mail.</p>
      </div>
    `,
  })
}
