import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { AcessosEntidadeService } from '../services/acessos-entidade.js'
import { appAuthRoutes } from './auth.js'
import { appContextoRoutes, parseContextoCookie } from './contexto.js'
import { appDashboardRoutes } from './dashboard.js'

// `req.contexto` é o contexto de trabalho do usuário (qual entidade e ano ele
// escolheu na sessão atual). Injetado pelo middleware antes de qualquer rota
// que não seja login/contexto.
declare module 'fastify' {
  interface FastifyRequest {
    contexto: {
      entidadeId: string
      ano: number
      nivel: 'LEITURA' | 'ESCRITA' | 'ADMIN'
    }
  }
}

export function appNotFoundHandler(req: FastifyRequest, reply: FastifyReply) {
  return reply.status(404).view('404', { caminho: req.url })
}

/** Verifica cookie `genesis_user_token`; sem ele, manda para /app/login. */
export async function appAuthMiddleware(req: FastifyRequest, reply: FastifyReply) {
  const token = req.cookies['genesis_user_token']
  if (!token) return reply.redirect('/app/login')

  let payload: { sub: string; email: string }
  try {
    payload = req.server.jwt.verify(token)
  } catch {
    return reply.clearCookie('genesis_user_token', { path: '/' }).redirect('/app/login')
  }

  // Confirma que conta ainda é válida e tem ao menos um acesso ativo.
  const usuario = await req.server.prisma.usuario.findUnique({
    where: { id: payload.sub },
    select: { ativo: true, emailValidado: true },
  })
  if (!usuario || !usuario.ativo || !usuario.emailValidado) {
    return reply.clearCookie('genesis_user_token', { path: '/' }).redirect('/app/login')
  }
  const temAcesso = await req.server.prisma.acessoEntidade.findFirst({
    where: { usuarioId: payload.sub, ativo: true },
    select: { id: true },
  })
  if (!temAcesso) {
    return reply
      .clearCookie('genesis_user_token', { path: '/' })
      .redirect('/app/login?erro=Acesso+revogado.')
  }

  req.user = payload
}

/**
 * Lê `genesis_exercicio`, valida que o usuário ainda pode acessar aquela
 * entidade, e injeta `req.contexto`. Sem cookie/acesso: redireciona para
 * `/app/contexto`. Exceto a própria rota de escolha de contexto.
 */
export async function appContextoMiddleware(req: FastifyRequest, reply: FastifyReply) {
  // Rota de escolha não exige contexto pré-existente.
  const rawPath = req.url.split('?')[0]!.replace(/^\/app\/?/, '')
  if (rawPath === 'contexto') return

  const cookie = parseContextoCookie(req.cookies['genesis_exercicio'])
  if (!cookie) return reply.redirect('/app/contexto')

  const acessos = new AcessosEntidadeService(req.server.prisma)
  const acesso = await req.server.prisma.acessoEntidade.findUnique({
    where: { usuarioId_entidadeId: { usuarioId: req.user.sub, entidadeId: cookie.entidadeId } },
  })
  if (!acesso || !acesso.ativo) {
    return reply.clearCookie('genesis_exercicio', { path: '/' }).redirect('/app/contexto')
  }
  void acessos
  req.contexto = { entidadeId: cookie.entidadeId, ano: cookie.ano, nivel: acesso.nivel }
}

export async function appRoutes(app: FastifyInstance) {
  app.setNotFoundHandler(appNotFoundHandler)

  // ── Rotas públicas: login/logout ────────────────────────────────────────────
  app.register(appAuthRoutes)

  // ── Rotas autenticadas (cookie de usuário) ──────────────────────────────────
  app.register(async (autenticado) => {
    autenticado.addHook('onRequest', appAuthMiddleware)
    autenticado.addHook('onRequest', appContextoMiddleware)

    autenticado.register(appContextoRoutes)
    autenticado.register(appDashboardRoutes)
  })
}
