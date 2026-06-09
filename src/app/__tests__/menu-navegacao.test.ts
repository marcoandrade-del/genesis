import { describe, it, expect } from 'vitest'
import { criarApp, tokenJwt } from '../../routes/__tests__/helpers/criarApp.js'

// Integração: o preHandler de appRoutes injeta a árvore de menu em reply.locals,
// e as views do /app a renderizam (navbar dropdown + cards do dashboard).
const ENTIDADE = {
  id: 'ent1', nome: 'Prefeitura',
  municipio: { nome: 'Curitiba', estado: { sigla: 'PR', nome: 'Paraná' } },
}

async function montar() {
  const { appRoutes } = await import('../index.js')
  const { app, prisma } = await criarApp({ registrar: appRoutes, prefix: '/app', comView: true })
  // appAuthMiddleware + appContextoMiddleware
  prisma.usuario.findUnique.mockResolvedValue({ ativo: true, emailValidado: true })
  prisma.acessoEntidade.findFirst.mockResolvedValue({ id: 'a1' })
  prisma.acessoEntidade.findUnique.mockResolvedValue({ ativo: true, nivel: 'ESCRITA' })
  prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
  return { app, prisma }
}

function pedir(app: Awaited<ReturnType<typeof montar>>['app']) {
  return app.inject({
    method: 'GET',
    url: '/app',
    cookies: { genesis_user_token: tokenJwt(app, { sub: 'u1', email: 'u@x.com' }), genesis_exercicio: 'ent1:2026' },
  })
}

describe('navegação dinâmica do /app', () => {
  it('renderiza o menu do banco: dropdown do SUBMENU, folha e cards', async () => {
    const { app, prisma } = await montar()
    prisma.permissaoAcesso.findMany.mockResolvedValue([{ itemId: 'orc' }, { itemId: 'saldo' }, { itemId: 'lanc' }])
    prisma.itemFuncionalidade.findMany.mockResolvedValue([
      { id: 'orc', nome: 'Orçamento', descricao: 'Dotações e previsões', rota: '/app/orcamento', icone: 'bi-cash-coin', tipo: 'SUBMENU', parentId: null },
      { id: 'saldo', nome: 'Saldos', descricao: null, rota: '/app/orcamento/saldo', icone: 'bi-wallet2', tipo: 'FUNCIONALIDADE', parentId: 'orc' },
      { id: 'lanc', nome: 'Lançamentos', descricao: 'Execução contábil', rota: '/app/lancamentos', icone: 'bi-receipt', tipo: 'FUNCIONALIDADE', parentId: null },
    ])

    const res = await pedir(app)
    expect(res.statusCode).toBe(200)
    // navbar: Orçamento (tem filhos) vira dropdown; filho e folha aparecem
    expect(res.body).toContain('dropdown-toggle')
    expect(res.body).toContain('/app/orcamento/saldo')
    expect(res.body).toContain('/app/lancamentos')
    // bundle do Bootstrap injetado quando há menu
    expect(res.body).toContain('bootstrap.bundle')
    // cards do dashboard (áreas de topo) com descrição
    expect(res.body).toContain('Dotações e previsões')
  })

  it('sem permissões: degrada graciosamente (sem menu, sem bundle)', async () => {
    const { app, prisma } = await montar()
    prisma.permissaoAcesso.findMany.mockResolvedValue([])

    const res = await pedir(app)
    expect(res.statusCode).toBe(200)
    expect(res.body).not.toContain('dropdown-toggle')
    expect(res.body).not.toContain('bootstrap.bundle')
    // a barra base (contexto) continua renderizando
    expect(res.body).toContain('Prefeitura')
  })
})
