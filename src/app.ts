import Fastify from 'fastify'
import rateLimitPlugin from '@fastify/rate-limit'
import prismaPlugin from './plugins/prisma.js'
import jwtPlugin from './plugins/jwt.js'
import cookiePlugin from './plugins/cookie.js'
import formbodyPlugin from './plugins/formbody.js'
import viewPlugin from './plugins/view.js'
import { adminRoutes } from './admin/index.js'
import { authRoutes } from './routes/auth.js'
import { usuariosRoutes } from './routes/usuarios.js'
import { codigosRoutes } from './routes/codigos.js'
import { sistemasRoutes } from './routes/sistemas.js'
import { modulosRoutes } from './routes/modulos.js'
import { menusRoutes } from './routes/menus.js'
import { itensRoutes } from './routes/itens.js'
import { adminsRoutes } from './routes/admins.js'
import { permissoesRoutes } from './routes/permissoes.js'
import { relatoriosRoutes } from './routes/relatorios.js'
import { favoritosRoutes } from './routes/favoritos.js'

export const app = Fastify({ logger: true })

app.register(prismaPlugin)
app.register(jwtPlugin)
app.register(cookiePlugin)
app.register(formbodyPlugin)
app.register(viewPlugin)
app.register(rateLimitPlugin, { global: false })

app.get('/health', async () => ({ status: 'ok', system: 'Gênesis' }))

// ── Painel Admin (HTML, autenticação via cookie) ──────────────────────────────
app.register(adminRoutes, { prefix: '/admin' })

// ── Rotas públicas (sem token) ────────────────────────────────────────────────
app.register(authRoutes)   // /auth/registro, /auth/login, /auth/solicitar-validacao, /auth/validar

// ── Rotas protegidas (exigem Bearer token JWT) ────────────────────────────────
app.register(async (api) => {
  api.addHook('onRequest', app.authenticate)

  api.register(usuariosRoutes)
  api.register(codigosRoutes)
  api.register(sistemasRoutes)
  api.register(modulosRoutes)
  api.register(menusRoutes)
  api.register(itensRoutes)
  api.register(adminsRoutes)
  api.register(permissoesRoutes)
  api.register(relatoriosRoutes)
  api.register(favoritosRoutes)
})
