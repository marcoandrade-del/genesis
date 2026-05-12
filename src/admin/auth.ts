import type { FastifyInstance } from 'fastify'
import argon2 from 'argon2'
import { AuthService } from '../services/auth.js'
import { CodigosService } from '../services/codigos.js'

export async function adminAuthRoutes(app: FastifyInstance) {
  const authService = new AuthService(app.prisma)
  const codigosService = new CodigosService(app.prisma)

  // ---------- Registro ----------

  app.get('/registro', async (_req, reply) => {
    return reply.view('registro', { error: null, dados: null })
  })

  app.post<{
    Body: {
      nomeCompleto: string; nomeSocial?: string; cpf?: string
      dataNascimento: string; emailPrincipal: string; telefonePrincipal: string
      senha: string; confirmarSenha: string
    }
  }>('/registro', async (req, reply) => {
    const { confirmarSenha, ...corpo } = req.body
    const dados = { ...corpo, nomeSocial: corpo.nomeSocial ?? corpo.nomeCompleto }

    if (corpo.senha !== confirmarSenha) {
      return reply.view('registro', { error: 'As senhas não conferem.', dados })
    }

    try {
      const usuario = await authService.registrar(dados)
      // Dispara ambos os códigos imediatamente após o registro
      await codigosService.solicitar(usuario.id, 'EMAIL')
      await codigosService.solicitar(usuario.id, 'CELULAR')
      return reply.redirect(`/admin/ativar/${usuario.id}?passo=EMAIL`)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Erro ao criar conta.'
      return reply.view('registro', { error: msg, dados })
    }
  })

  // ---------- Ativação ----------

  app.get<{ Params: { usuarioId: string }; Querystring: { passo?: string } }>(
    '/ativar/:usuarioId',
    async (req, reply) => {
      const { usuarioId } = req.params
      const passo = req.query.passo === 'CELULAR' ? 'CELULAR' : 'EMAIL'
      const usuario = await app.prisma.usuario.findUnique({ where: { id: usuarioId } })
      if (!usuario) return reply.redirect('/admin/login')
      return reply.view('ativar', {
        usuarioId, passo, error: null, info: null,
        email: usuario.emailPrincipal, telefone: usuario.telefonePrincipal,
      })
    }
  )

  app.post<{ Params: { usuarioId: string }; Body: { passo: string; codigo: string } }>(
    '/ativar/:usuarioId',
    async (req, reply) => {
      const { usuarioId } = req.params
      const { passo, codigo } = req.body
      const tipo = passo === 'CELULAR' ? 'CELULAR' : 'EMAIL'

      const usuario = await app.prisma.usuario.findUnique({ where: { id: usuarioId } })
      if (!usuario) return reply.redirect('/admin/login')

      try {
        const resultado = await codigosService.validar(usuarioId, tipo, codigo)

        if (resultado.ativo) {
          return reply.redirect('/admin/login?ativado=1')
        }
        // EMAIL validado — agora valida CELULAR
        return reply.redirect(`/admin/ativar/${usuarioId}?passo=CELULAR`)
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Código inválido.'
        return reply.view('ativar', {
          usuarioId, passo: tipo, error: msg, info: null,
          email: usuario.emailPrincipal, telefone: usuario.telefonePrincipal,
        })
      }
    }
  )

  // ---------- Reenviar código ----------

  app.post<{ Params: { usuarioId: string }; Body: { passo: string } }>(
    '/reenviar/:usuarioId',
    async (req, reply) => {
      const { usuarioId } = req.params
      const tipo = req.body.passo === 'CELULAR' ? 'CELULAR' : 'EMAIL'

      const usuario = await app.prisma.usuario.findUnique({ where: { id: usuarioId } })
      if (!usuario) return reply.redirect('/admin/login')

      try {
        await codigosService.solicitar(usuarioId, tipo)
        return reply.view('ativar', {
          usuarioId, passo: tipo, error: null, info: 'Código reenviado com sucesso.',
          email: usuario.emailPrincipal, telefone: usuario.telefonePrincipal,
        })
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Erro ao reenviar.'
        return reply.view('ativar', {
          usuarioId, passo: tipo, error: msg, info: null,
          email: usuario.emailPrincipal, telefone: usuario.telefonePrincipal,
        })
      }
    }
  )

  app.get<{ Querystring: { ativado?: string } }>('/login', async (req, reply) => {
    const token = req.cookies['genesis_admin_token']
    if (token) {
      try { app.jwt.verify(token); return reply.redirect('/admin') } catch { /* inválido */ }
    }
    return reply.view('login', { error: null, email: null, ativado: req.query.ativado === '1' })
  })

  app.post<{ Body: { email: string; senha: string } }>('/login', async (req, reply) => {
    const { email, senha } = req.body

    const usuario = await app.prisma.usuario.findFirst({
      where: { emailPrincipal: email },
    })

    const senhaValida = usuario?.senhaHash
      ? await argon2.verify(usuario.senhaHash, senha)
      : false

    if (!usuario || !senhaValida) {
      return reply.view('login', { error: 'E-mail ou senha inválidos.', email, ativado: false })
    }

    if (!usuario.emailValidado) {
      return reply.redirect(`/admin/ativar/${usuario.id}?passo=EMAIL`)
    }
    if (!usuario.ativo) {
      return reply.redirect(`/admin/ativar/${usuario.id}?passo=CELULAR`)
    }

    const isAdmin = await app.prisma.adminSistema.findFirst({
      where: { usuarioId: usuario.id, ativo: true },
    })

    if (!isAdmin) {
      return reply.view('login', {
        error: 'Acesso restrito a administradores de sistema.',
        email, ativado: false,
      })
    }

    const token = app.jwt.sign({ sub: usuario.id, email: usuario.emailPrincipal })

    return reply
      .cookie('genesis_admin_token', token, { httpOnly: true, path: '/', maxAge: 60 * 60 * 8 })
      .redirect('/admin')
  })

  app.get('/logout', async (_req, reply) => {
    return reply.clearCookie('genesis_admin_token', { path: '/' }).redirect('/admin/login')
  })

  app.post<{ Body: { email: string; senha: string } }>('/verificar-sessao', async (req, reply) => {
    const { email, senha } = req.body
    const usuario = await app.prisma.usuario.findFirst({
      where: { emailPrincipal: email, emailValidado: true, ativo: true },
    })
    const senhaValida = usuario?.senhaHash ? await argon2.verify(usuario.senhaHash, senha) : false
    if (!usuario || !senhaValida) return reply.status(401).send({ ok: false, erro: 'Credenciais inválidas.' })
    return reply.send({ ok: true })
  })
}
