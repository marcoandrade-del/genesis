import Fastify from 'fastify'
import rateLimitPlugin from '@fastify/rate-limit'
import prismaPlugin from './plugins/prisma.js'
import jwtPlugin from './plugins/jwt.js'
import cookiePlugin from './plugins/cookie.js'
import formbodyPlugin from './plugins/formbody.js'
import multipartPlugin from './plugins/multipart.js'
import viewPlugin from './plugins/view.js'
import { adminRoutes } from './admin/index.js'
import { appRoutes } from './app/index.js'
import { authRoutes } from './routes/auth.js'
import { memoriaisApiRoutes } from './api/memoriais.js'
import { acoesUsuarioApiRoutes } from './api/acoes-usuario.js'
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
import { modelosContabeisRoutes } from './routes/modelos-contabeis.js'
import { estadosRoutes } from './routes/estados.js'
import { municipiosRoutes } from './routes/municipios.js'
import { planosDeContasRoutes } from './routes/planos-de-contas.js'
import { contasRoutes } from './routes/contas.js'
import { lancamentosRoutes } from './routes/lancamentos.js'

export const app = Fastify({ logger: true })

app.register(prismaPlugin)
app.register(jwtPlugin)
app.register(cookiePlugin)
app.register(formbodyPlugin)
app.register(multipartPlugin)
app.register(viewPlugin)
app.register(rateLimitPlugin, { global: false })

app.get('/health', async () => ({ status: 'ok', system: 'Gênesis' }))

// Raiz → app do usuário (a URL "pelada" cai no login em vez de 404).
app.get('/', async (_req, reply) => reply.redirect('/app'))

// ── Painel Admin (HTML, autenticação via cookie) ──────────────────────────────
app.register(adminRoutes, { prefix: '/admin' })

// ── App do Usuário (HTML, cookie próprio + contexto de exercício) ─────────────
app.register(appRoutes, { prefix: '/app' })

// ── Rotas públicas (sem token) ────────────────────────────────────────────────
app.register(authRoutes)   // /auth/registro, /auth/login, /auth/solicitar-validacao, /auth/validar

// ── Data API read-only dos memoriais (LRF) p/ o Oxy — token de serviço ────────
app.register(memoriaisApiRoutes, { prefix: '/api' })

// ── Data API de ações do usuário do BI (solicitar acesso) — token de serviço ──
app.register(acoesUsuarioApiRoutes, { prefix: '/api' })

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
  api.register(modelosContabeisRoutes)
  api.register(estadosRoutes)
  api.register(municipiosRoutes)
  api.register(planosDeContasRoutes)
  api.register(contasRoutes)
  api.register(lancamentosRoutes)
})
