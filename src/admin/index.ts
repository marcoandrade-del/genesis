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
import { adminModelosContabeisRoutes } from './modelos-contabeis.js'
import { adminEstadosRoutes } from './estados.js'
import { adminMunicipiosRoutes } from './municipios.js'
import { adminPlanosDeContasRoutes } from './planos-de-contas.js'
import { adminContasRoutes } from './contas.js'
import { adminLancamentosRoutes } from './lancamentos.js'

// Caminhos profundos (≥2 segmentos) que são páginas completas, abertas por
// navegação direta do browser via <a href> (não por HTMX). Todo o resto sob
// ≥2 segmentos é fragmento (modal, partial de árvore/lookup) e só pode ser
// servido dentro de uma requisição HTMX.
const PAGINAS_COMPLETAS_PROFUNDAS = new Set(['lancamentos/novo'])

export function adminNotFoundHandler(req: FastifyRequest, reply: FastifyReply) {
  return reply.status(404).view('404', { caminho: req.url })
}

export async function adminAuthMiddleware(req: FastifyRequest, reply: FastifyReply) {
  const token = req.cookies['genesis_admin_token']
  if (!token) return reply.redirect('/admin/login')

  let payload: { sub: string; email: string }
  try {
    payload = req.server.jwt.verify(token)
  } catch {
    return reply.clearCookie('genesis_admin_token', { path: '/' }).redirect('/admin/login')
  }

  // Re-verifica acesso a cada request: vínculo AdminSistema ativo + e-mail/celular
  // ainda validados. Se o estado da conta regrediu (admin removeu vínculo, e-mail
  // foi desvalidado, etc.), a sessão é revogada imediatamente.
  const vinculo = await req.server.prisma.adminSistema.findFirst({
    where: { usuarioId: payload.sub, ativo: true },
    select: { usuario: { select: { emailValidado: true, ativo: true } } },
  })
  if (!vinculo) {
    return reply.clearCookie('genesis_admin_token', { path: '/' }).redirect('/admin/login')
  }
  if (!vinculo.usuario.emailValidado) {
    return reply
      .clearCookie('genesis_admin_token', { path: '/' })
      .redirect(`/admin/ativar/${payload.sub}?passo=EMAIL`)
  }
  if (!vinculo.usuario.ativo) {
    return reply
      .clearCookie('genesis_admin_token', { path: '/' })
      .redirect(`/admin/ativar/${payload.sub}?passo=CELULAR`)
  }

  req.user = payload
}

export async function adminRoutes(app: FastifyInstance) {
  // 404 do escopo /admin: HTML com layout Wise + link de volta.
  // Escopo encapsulado garante que API segue retornando JSON default.
  app.setNotFoundHandler(adminNotFoundHandler)

  // Rotas públicas do admin (login/logout)
  app.register(adminAuthRoutes)

  // Rotas protegidas — exigem cookie válido
  app.register(async (admin) => {
    admin.addHook('onRequest', adminAuthMiddleware)

    // Rotas parciais (fragmentos HTMX) não podem ser acessadas diretamente pelo browser.
    // Se não vier de uma requisição HTMX, redireciona para o dashboard. Exceções:
    // o escopo `funcionando` e páginas completas (renderizadas com layout) que
    // vivem sob caminhos de ≥2 segmentos — ver PAGINAS_COMPLETAS_PROFUNDAS.
    admin.addHook('onRequest', async (req, reply) => {
      if (req.method !== 'GET' || req.headers['hx-request']) return
      // req.url é sempre definido em Fastify; split('?') sempre retorna ≥ 1 elemento.
      const rawPath = req.url.split('?')[0]!
      const segments = rawPath.replace(/^\/admin\/?/, '').split('/').filter(Boolean)
      if (segments.length < 2 || segments[0] === 'funcionando') return
      if (PAGINAS_COMPLETAS_PROFUNDAS.has(segments.join('/'))) return
      return reply.redirect('/admin')
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
    admin.register(adminModelosContabeisRoutes, { prefix: '/modelos-contabeis' })
    admin.register(adminEstadosRoutes, { prefix: '/estados' })
    admin.register(adminMunicipiosRoutes, { prefix: '/municipios' })
    admin.register(adminPlanosDeContasRoutes, { prefix: '/planos-de-contas' })
    admin.register(adminContasRoutes, { prefix: '/contas' })
    admin.register(adminLancamentosRoutes, { prefix: '/lancamentos' })
  })
}
