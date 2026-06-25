import type { FastifyInstance } from 'fastify'
import argon2 from 'argon2'

/**
 * Login do usuário comum (não-admin do sistema). Cookie `genesis_user_token`
 * separado do `genesis_admin_token` — admin e usuário coexistem na mesma
 * sessão. Acesso ao /app requer ao menos um AcessoEntidade ativo.
 */
export async function appAuthRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { erro?: string } }>('/login', async (req, reply) => {
    const token = req.cookies['genesis_user_token']
    if (token) {
      try {
        app.jwt.verify(token)
        return reply.redirect('/app')
      } catch {
        /* token inválido, segue para o form */
      }
    }
    return reply.view('app/login', {
      error: req.query.erro ?? null,
      email: null,
      layout: null,
    })
  })

  app.post<{ Body: { email: string; senha: string } }>(
    '/login',
    { config: { rateLimit: { max: 10, timeWindow: '5 minutes' } } },
    async (req, reply) => {
      const { email, senha } = req.body

      const usuario = await app.prisma.usuario.findFirst({
        where: { emailPrincipal: email },
      })

      const senhaValida = usuario?.senhaHash ? await argon2.verify(usuario.senhaHash, senha) : false

      if (!usuario || !senhaValida) {
        return reply.view('app/login', { error: 'E-mail ou senha inválidos.', email, layout: null })
      }

      if (!usuario.emailValidado || !usuario.ativo) {
        return reply.view('app/login', {
          error: 'Conta pendente de ativação. Procure o administrador do sistema.',
          email,
          layout: null,
        })
      }

      // Usuário só pode entrar no /app se tiver ao menos um acesso ativo a
      // uma entidade ativa (entidade desativada não conta).
      const temAcesso = await app.prisma.acessoEntidade.findFirst({
        where: { usuarioId: usuario.id, ativo: true, entidade: { ativo: true } },
        select: { id: true },
      })
      if (!temAcesso) {
        return reply.view('app/login', {
          error: 'Você não tem acesso a nenhuma entidade. Procure o administrador para conceder permissão.',
          email,
          layout: null,
        })
      }

      const token = app.jwt.sign(
        { sub: usuario.id, email: usuario.emailPrincipal },
        { expiresIn: '8h' },
      )

      return reply
        .cookie('genesis_user_token', token, {
          httpOnly: true,
          path: '/',
          maxAge: 60 * 60 * 8,
          sameSite: 'strict',
          secure: process.env['NODE_ENV'] === 'production',
        })
        .redirect('/app/contexto')
    },
  )

  app.get('/logout', async (_req, reply) => {
    return reply
      .clearCookie('genesis_user_token', { path: '/' })
      .clearCookie('genesis_exercicio', { path: '/' })
      .redirect('/app/login')
  })
}
