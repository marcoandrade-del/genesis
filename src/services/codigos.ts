import { PrismaClient, TipoValidacao } from '@prisma/client'
import { randomInt } from 'crypto'
import { ErroNegocio } from '../errors.js'
import { enviarCodigoEmail } from './email.js'
import { enviarCodigoSms } from './sms.js'

const EXPIRACAO_MINUTOS = 15
const MAX_TENTATIVAS = 5

export class CodigosService {
  constructor(private prisma: PrismaClient) {}

  async solicitar(usuarioId: string, tipo: TipoValidacao) {
    const usuario = await this.prisma.usuario.findUnique({ where: { id: usuarioId } })
    if (!usuario) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Usuário não encontrado.')

    if (tipo === 'EMAIL' && usuario.emailValidado) {
      throw new ErroNegocio('CONFLITO', 'E-mail já validado.')
    }
    if (tipo === 'CELULAR' && usuario.celularValidado) {
      throw new ErroNegocio('CONFLITO', 'Celular já validado.')
    }

    // Invalida códigos anteriores do mesmo tipo
    await this.prisma.codigoValidacao.deleteMany({
      where: { usuarioId, tipo, usadoEm: null },
    })

    const codigo = randomInt(100000, 999999).toString()
    const expiradoEm = new Date(Date.now() + EXPIRACAO_MINUTOS * 60 * 1000)

    const registro = await this.prisma.codigoValidacao.create({
      data: { usuarioId, tipo, codigo, expiradoEm },
    })

    if (tipo === 'EMAIL') {
      const base = (process.env['BASE_URL'] ?? 'http://localhost:3000').replace(/\/$/, '')
      const link = `${base}/admin/ativar/${usuarioId}?passo=EMAIL`
      await enviarCodigoEmail(usuario.emailPrincipal, codigo, EXPIRACAO_MINUTOS, link)
    } else {
      await enviarCodigoSms(usuario.telefonePrincipal, codigo, EXPIRACAO_MINUTOS)
    }

    return { id: registro.id, expiradoEm: registro.expiradoEm }
  }

  async validar(usuarioId: string, tipo: TipoValidacao, codigo: string) {
    const usuario = await this.prisma.usuario.findUnique({ where: { id: usuarioId } })
    if (!usuario) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Usuário não encontrado.')

    // Busca o código ativo sem filtrar por valor — comparação separada para
    // permitir contar tentativas falhas e bloquear brute-force.
    const registro = await this.prisma.codigoValidacao.findFirst({
      where: {
        usuarioId,
        tipo,
        usadoEm: null,
        expiradoEm: { gt: new Date() },
      },
    })

    if (!registro) {
      throw new ErroNegocio('REQUISICAO_INVALIDA', 'Código inválido ou expirado.')
    }

    if (registro.codigo !== codigo) {
      const novasTentativas = registro.tentativas + 1
      if (novasTentativas >= MAX_TENTATIVAS) {
        await this.prisma.codigoValidacao.update({
          where: { id: registro.id },
          data: { tentativas: novasTentativas, usadoEm: new Date() },
        })
        throw new ErroNegocio('REQUISICAO_INVALIDA', 'Código inválido. Limite de tentativas atingido — solicite um novo código.')
      }
      await this.prisma.codigoValidacao.update({
        where: { id: registro.id },
        data: { tentativas: novasTentativas },
      })
      throw new ErroNegocio('REQUISICAO_INVALIDA', 'Código inválido ou expirado.')
    }

    const emailValidado = tipo === 'EMAIL' ? true : usuario.emailValidado
    const celularValidado = tipo === 'CELULAR' ? true : usuario.celularValidado
    const ativo = emailValidado && celularValidado

    await this.prisma.$transaction([
      this.prisma.codigoValidacao.update({
        where: { id: registro.id },
        data: { usadoEm: new Date() },
      }),
      this.prisma.usuario.update({
        where: { id: usuarioId },
        data: { emailValidado, celularValidado, ativo },
      }),
    ])

    return { emailValidado, celularValidado, ativo }
  }
}
