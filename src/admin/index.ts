import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { adminAuthRoutes } from './auth.js'
import { adminDashboardRoutes } from './dashboard.js'
import { adminSistemasRoutes } from './sistemas.js'
import { adminModulosRoutes } from './modulos.js'
import { adminMenusRoutes } from './menus.js'
import { adminUsuariosRoutes } from './usuarios.js'
import { adminLookupRoutes } from './lookup.js'
import { adminLixeiraRoutes } from './lixeira.js'
import { adminPermissoesRoutes } from './permissoes.js'
import { adminRelatoriosRoutes } from './relatorios.js'
import { adminRelatoriosPersonalizadosRoutes } from './relatorios-personalizados.js'
import { adminFavoritosRoutes } from './favoritos.js'
import { adminFuncionandoRoutes } from './funcionando.js'

async function adminAuthMiddleware(req: FastifyRequest, reply: FastifyReply) {
  const token = req.cookies['genesis_admin_token']
  if (!token) return reply.redirect('/admin/login')
  try {
    req.user = req.server.jwt.verify(token)
  } catch {
    return reply.clearCookie('genesis_admin_token', { path: '/' }).redirect('/admin/login')
  }
}

export async function adminRoutes(app: FastifyInstance) {
  // Rotas públicas do admin (login/logout)
  app.register(adminAuthRoutes)

  // Rotas protegidas — exigem cookie válido
  app.register(async (admin) => {
    admin.addHook('onRequest', adminAuthMiddleware)

    // Rotas parciais (fragmentos HTMX) não podem ser acessadas diretamente pelo browser.
    // Se não vier de uma requisição HTMX, redireciona para o dashboard.
    admin.addHook('onRequest', async (req, reply) => {
      if (req.method !== 'GET' || req.headers['hx-request']) return
      const [rawPath = ''] = (req.url ?? '').split('?')
      const segments = rawPath.replace(/^\/admin\/?/, '').split('/').filter(Boolean)
      if (segments.length >= 2 && segments[0] !== 'funcionando') return reply.redirect('/admin')
    })

    admin.register(adminDashboardRoutes)
    admin.register(adminSistemasRoutes, { prefix: '/sistemas' })
    admin.register(adminModulosRoutes, { prefix: '/modulos' })
    admin.register(adminMenusRoutes, { prefix: '/menus' })
    admin.register(adminUsuariosRoutes, { prefix: '/usuarios' })
    admin.register(adminLookupRoutes, { prefix: '/lookup' })
    admin.register(adminPermissoesRoutes, { prefix: '/permissoes' })
    admin.register(adminRelatoriosRoutes, { prefix: '/relatorios' })
    admin.register(adminRelatoriosPersonalizadosRoutes, { prefix: '/relatorios-personalizados' })
    admin.register(adminFavoritosRoutes, { prefix: '/favoritos' })
    admin.register(adminLixeiraRoutes, { prefix: '/lixeira' })
    admin.register(adminFuncionandoRoutes, { prefix: '/funcionando' })
  })
}
