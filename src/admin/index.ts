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
import { adminPlanosContasReceitaRoutes } from './planos-contas-receita.js'
import { adminContasReceitaRoutes } from './contas-receita.js'
import { adminPlanosContasDespesaRoutes } from './planos-contas-despesa.js'
import { adminContasDespesaRoutes } from './contas-despesa.js'
import { adminFontesRecursoRoutes } from './fontes-recurso.js'
import { adminEntidadesRoutes } from './entidades.js'
import { adminContasDespesaEntidadeRoutes } from './contas-despesa-entidade.js'
import { adminContasReceitaEntidadeRoutes } from './contas-receita-entidade.js'
import { adminContasContabilEntidadeRoutes } from './contas-contabil-entidade.js'
import { adminFuncoesRoutes } from './funcoes.js'
import { adminUnidadesOrcamentariaRoutes } from './unidades-orcamentaria.js'
import { adminEventosContabeisRoutes } from './eventos-contabeis.js'
import { adminProgramasRoutes } from './programas.js'
import { adminOrcamentosRoutes } from './orcamentos.js'
import { adminAcessosEntidadeRoutes } from './acessos-entidade.js'
import { adminItensCatalogoRoutes } from './itens-catalogo.js'
import { adminReservasDotacaoRoutes } from './reservas-dotacao.js'
import { adminPlanosContratacaoRoutes } from './planos-contratacao.js'
import { adminDocumentosDemandaRoutes } from './documentos-demanda.js'

// Caminhos profundos (≥2 segmentos) que são páginas completas. Aceita string
// literal OU RegExp (para caminhos com ID variável, ex.: ".../:id/editar").
const PAGINAS_COMPLETAS_PROFUNDAS: ReadonlyArray<string | RegExp> = [
  'lancamentos/novo',
  'eventos-contabeis/novo',
  /^eventos-contabeis\/[^/]+\/editar$/,
  /^programas\/[^/]+\/acoes$/,
  /^orcamentos\/[^/]+$/,
  /^acessos-entidade\/usuario\/[^/]+$/,
]

function ePaginaCompletaProfunda(path: string): boolean {
  return PAGINAS_COMPLETAS_PROFUNDAS.some((p) => (typeof p === 'string' ? p === path : p.test(path)))
}

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
      if (ePaginaCompletaProfunda(segments.join('/'))) return
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
    admin.register(adminPlanosContasReceitaRoutes, { prefix: '/planos-contas-receita' })
    admin.register(adminContasReceitaRoutes, { prefix: '/contas-receita' })
    admin.register(adminPlanosContasDespesaRoutes, { prefix: '/planos-contas-despesa' })
    admin.register(adminContasDespesaRoutes, { prefix: '/contas-despesa' })
    admin.register(adminFontesRecursoRoutes, { prefix: '/fontes-recurso' })
    admin.register(adminEntidadesRoutes, { prefix: '/entidades' })
    admin.register(adminContasDespesaEntidadeRoutes, { prefix: '/contas-despesa-entidade' })
    admin.register(adminContasReceitaEntidadeRoutes, { prefix: '/contas-receita-entidade' })
    admin.register(adminContasContabilEntidadeRoutes, { prefix: '/contas-contabil-entidade' })
    admin.register(adminFuncoesRoutes, { prefix: '/funcoes' })
    admin.register(adminUnidadesOrcamentariaRoutes, { prefix: '/unidades-orcamentaria' })
    admin.register(adminEventosContabeisRoutes, { prefix: '/eventos-contabeis' })
    admin.register(adminProgramasRoutes, { prefix: '/programas' })
    admin.register(adminOrcamentosRoutes, { prefix: '/orcamentos' })
    admin.register(adminAcessosEntidadeRoutes, { prefix: '/acessos-entidade' })
    admin.register(adminItensCatalogoRoutes, { prefix: '/itens-catalogo' })
    admin.register(adminReservasDotacaoRoutes, { prefix: '/reservas-dotacao' })
    admin.register(adminPlanosContratacaoRoutes, { prefix: '/planos-contratacao' })
    admin.register(adminDocumentosDemandaRoutes, { prefix: '/documentos-demanda' })
  })
}
