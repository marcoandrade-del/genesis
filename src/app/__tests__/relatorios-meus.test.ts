import { describe, it, expect, beforeEach, vi } from 'vitest'

const m = vi.hoisted(() => ({
  listar: vi.fn(),
  buscar: vi.fn(),
  criar: vi.fn(),
  atualizar: vi.fn(),
  excluir: vi.fn(),
  salvarTotais: vi.fn(),
  executar: vi.fn(),
  listarViews: vi.fn(),
}))

vi.mock('../../services/meus-relatorios.js', () => ({
  MeusRelatoriosService: class {
    listar = m.listar
    buscar = m.buscar
    criar = m.criar
    atualizar = m.atualizar
    excluir = m.excluir
    salvarTotais = m.salvarTotais
  },
}))

vi.mock('../../services/relatorio-executor.js', () => ({
  criarExecutorPadrao: () => ({ executar: m.executar, listarViews: m.listarViews, configurado: true }),
}))

import { criarApp } from '../../routes/__tests__/helpers/criarApp.js'
import { appRelatoriosRoutes } from '../relatorios.js'
import { ErroNegocio } from '../../errors.js'
import type { FastifyInstance } from 'fastify'
import type { PrismaMock } from '../../services/__tests__/helpers/prisma-mock.js'

const ENTIDADE = {
  id: 'ent1',
  nome: 'Prefeitura',
  endereco: 'Rua X, 100',
  brasao: 'data:image/png;base64,AAAA',
  municipio: { nome: 'Curitiba', estado: { sigla: 'PR', nome: 'Paraná' } },
}

const form = (o: Record<string, string>) =>
  Object.entries(o).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')
const POST = (url: string, body: Record<string, string>) => ({
  method: 'POST' as const,
  url,
  payload: form(body),
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
})

async function montar(contexto = { entidadeId: 'ent1', ano: 2026, nivel: 'ESCRITA' as const }) {
  return criarApp({ registrar: appRelatoriosRoutes, comView: true, simularUsuario: { sub: 'u1', email: 'u@x.com' }, simularContexto: contexto })
}

describe('appRelatoriosRoutes — Meus Relatórios', () => {
  let app: FastifyInstance
  let prisma: PrismaMock

  beforeEach(async () => {
    Object.values(m).forEach((fn) => fn.mockReset())
    m.listar.mockResolvedValue([])
    m.listarViews.mockResolvedValue([])
    ;({ app, prisma } = await montar())
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
  })

  // ── Editor ────────────────────────────────────────────────────
  it('GET meus/novo abre o editor (ESCRITA)', async () => {
    const res = await app.inject({ method: 'GET', url: '/relatorios/meus/novo' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('Novo relatório')
    expect(res.body).toContain('rel_lancamentos')
  })

  it('GET meus/novo sem views do sandbox não renderiza o picker', async () => {
    const res = await app.inject({ method: 'GET', url: '/relatorios/meus/novo' })
    expect(res.statusCode).toBe(200)
    expect(res.body).not.toContain('picker-view')
  })

  it('GET meus/novo renderiza o picker com as views e colunas do sandbox', async () => {
    m.listarViews.mockResolvedValue([
      { nome: 'rel_contas', colunas: [{ nome: 'codigo', tipo: 'text' }, { nome: 'nome', tipo: 'text' }] },
    ])
    const res = await app.inject({ method: 'GET', url: '/relatorios/meus/novo' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('picker-view')
    expect(res.body).toContain('<option value="rel_contas">')
    // metadados embutidos para o JS do picker montar as colunas
    expect(res.body).toContain('"colunas":[{"nome":"codigo","tipo":"text"}')
  })

  it('GET meus/novo degrada sem picker se o sandbox falhar ao listar views', async () => {
    m.listarViews.mockRejectedValue(new Error('sandbox fora'))
    const res = await app.inject({ method: 'GET', url: '/relatorios/meus/novo' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('Novo relatório')
    expect(res.body).not.toContain('picker-view')
  })

  it('GET meus/novo bloqueado para LEITURA', async () => {
    ;({ app, prisma } = await montar({ entidadeId: 'ent1', ano: 2026, nivel: 'LEITURA' }))
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    const res = await app.inject({ method: 'GET', url: '/relatorios/meus/novo' })
    expect(res.statusCode).toBe(403)
    expect(res.body).toContain('apenas leitura')
  })

  it('GET meus/novo redireciona se entidade sumiu', async () => {
    prisma.entidade.findUnique.mockResolvedValue(null)
    expect((await app.inject({ method: 'GET', url: '/relatorios/meus/novo' })).statusCode).toBe(302)
  })

  it('GET meus/:id carrega relatório próprio', async () => {
    m.buscar.mockResolvedValue({ id: 'rp1', usuarioId: 'u1', entidadeId: 'ent1', nome: 'Meu Rel', descricao: 'd', query: 'select 1', cabecalhoId: null, rodapeId: null })
    const res = await app.inject({ method: 'GET', url: '/relatorios/meus/rp1' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('Meu Rel')
  })

  it('GET meus/:id inexistente → 404; de outro dono → 404', async () => {
    m.buscar.mockResolvedValue(null)
    expect((await app.inject({ method: 'GET', url: '/relatorios/meus/x' })).statusCode).toBe(404)
    m.buscar.mockResolvedValue({ id: 'rp1', usuarioId: 'OUTRO', entidadeId: 'ent1' })
    expect((await app.inject({ method: 'GET', url: '/relatorios/meus/rp1' })).statusCode).toBe(404)
  })

  it('GET meus/:id bloqueado para LEITURA', async () => {
    ;({ app, prisma } = await montar({ entidadeId: 'ent1', ano: 2026, nivel: 'LEITURA' }))
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    expect((await app.inject({ method: 'GET', url: '/relatorios/meus/rp1' })).statusCode).toBe(403)
  })

  // ── Criar ─────────────────────────────────────────────────────
  it('POST meus cria e redireciona', async () => {
    m.criar.mockResolvedValue({ id: 'rp1' })
    const res = await app.inject(POST('/relatorios/meus', { nome: 'R', query: 'select 1', cabecalhoId: 'c1', rodapeId: '' }))
    expect(res.statusCode).toBe(302)
    expect(res.headers.location).toBe('/app/relatorios')
    expect(m.criar).toHaveBeenCalledWith('u1', 'ent1', expect.objectContaining({ nome: 'R', query: 'select 1', cabecalhoId: 'c1' }))
  })

  it('POST meus repropaga ErroNegocio no editor', async () => {
    m.criar.mockRejectedValue(new ErroNegocio('REQUISICAO_INVALIDA', 'Escreva a query do relatório.'))
    const res = await app.inject(POST('/relatorios/meus', { nome: 'R', query: '' }))
    expect(res.statusCode).toBe(400)
    expect(res.body).toContain('Escreva a query')
  })

  it('POST meus propaga erro inesperado (500)', async () => {
    m.criar.mockRejectedValue(new Error('boom'))
    expect((await app.inject(POST('/relatorios/meus', { nome: 'R', query: 'select 1' }))).statusCode).toBe(500)
  })

  it('POST meus bloqueado para LEITURA', async () => {
    ;({ app, prisma } = await montar({ entidadeId: 'ent1', ano: 2026, nivel: 'LEITURA' }))
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    const res = await app.inject(POST('/relatorios/meus', { nome: 'R', query: 'select 1' }))
    expect(res.statusCode).toBe(403)
    expect(m.criar).not.toHaveBeenCalled()
  })

  it('POST meus redireciona se entidade sumiu', async () => {
    prisma.entidade.findUnique.mockResolvedValue(null)
    expect((await app.inject(POST('/relatorios/meus', { nome: 'R', query: 'select 1' }))).statusCode).toBe(302)
  })

  // ── Atualizar ─────────────────────────────────────────────────
  it('POST meus/:id atualiza e redireciona', async () => {
    m.atualizar.mockResolvedValue({ id: 'rp1' })
    const res = await app.inject(POST('/relatorios/meus/rp1', { nome: 'Novo', query: 'select 2' }))
    expect(res.statusCode).toBe(302)
    expect(m.atualizar).toHaveBeenCalledWith('rp1', 'u1', 'ent1', expect.objectContaining({ nome: 'Novo' }))
  })

  it('POST meus/:id com erro reabre o editor', async () => {
    m.atualizar.mockRejectedValue(new ErroNegocio('REQUISICAO_INVALIDA', 'A query deve começar com SELECT.'))
    const res = await app.inject(POST('/relatorios/meus/rp1', { nome: 'X', query: 'drop table y' }))
    expect(res.statusCode).toBe(400)
    expect(res.body).toContain('começar com SELECT')
  })

  it('POST meus/:id redireciona se entidade sumiu e bloqueia LEITURA', async () => {
    prisma.entidade.findUnique.mockResolvedValue(null)
    expect((await app.inject(POST('/relatorios/meus/rp1', { nome: 'X', query: 'select 1' }))).statusCode).toBe(302)
    ;({ app, prisma } = await montar({ entidadeId: 'ent1', ano: 2026, nivel: 'LEITURA' }))
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    expect((await app.inject(POST('/relatorios/meus/rp1', { nome: 'X', query: 'select 1' }))).statusCode).toBe(403)
  })

  // ── Excluir ───────────────────────────────────────────────────
  it('POST meus/:id/excluir remove e redireciona', async () => {
    m.excluir.mockResolvedValue({ id: 'rp1' })
    const res = await app.inject(POST('/relatorios/meus/rp1/excluir', {}))
    expect(res.statusCode).toBe(302)
    expect(m.excluir).toHaveBeenCalledWith('rp1', 'u1', 'ent1')
  })

  it('POST excluir com ErroNegocio volta ao hub', async () => {
    m.excluir.mockRejectedValue(new ErroNegocio('CONFLITO', 'Há favoritos vinculados.'))
    const res = await app.inject(POST('/relatorios/meus/rp1/excluir', {}))
    expect(res.statusCode).toBe(409)
    expect(res.body).toContain('favoritos vinculados')
  })

  it('POST excluir bloqueado para LEITURA', async () => {
    ;({ app, prisma } = await montar({ entidadeId: 'ent1', ano: 2026, nivel: 'LEITURA' }))
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    expect((await app.inject(POST('/relatorios/meus/rp1/excluir', {}))).statusCode).toBe(403)
    expect(m.excluir).not.toHaveBeenCalled()
  })

  // ── Executar / preview ────────────────────────────────────────
  it('GET meus/:id/executar mostra o preview com o resultado', async () => {
    m.buscar.mockResolvedValue({ id: 'rp1', usuarioId: 'u1', entidadeId: 'ent1', nome: 'Rel', query: 'select 1', cabecalho: null, rodape: null })
    m.executar.mockResolvedValue({ colunas: ['historico', 'valor'], linhas: [['Empenho', '100,00']], total: 1, truncado: false })
    const res = await app.inject({ method: 'GET', url: '/relatorios/meus/rp1/executar' })
    expect(res.statusCode).toBe(200)
    expect(m.executar).toHaveBeenCalledWith('select 1', { entidadeId: 'ent1', ano: 2026 })
    expect(res.body).toContain('Empenho')
    expect(res.body).toContain('historico')
    // menu de exportação (substitui o antigo botão de PDF) com link /app/.../exportar
    expect(res.body).toContain('/app/relatorios/meus/rp1/exportar/csv')
    expect(res.body).toContain('Exportar')
  })

  it('GET executar renderiza as faixas de cabeçalho/rodapé com os elementos', async () => {
    m.buscar.mockResolvedValue({
      id: 'rp1', usuarioId: 'u1', entidadeId: 'ent1', nome: 'Rel', query: 'select 1',
      cabecalho: { altura: 120, layout: [
        { tipo: 'BRASAO', x: 2, y: 10 }, { tipo: 'NOME_ENTIDADE', x: 30, y: 10 },
        { tipo: 'NOME_RELATORIO', x: 30, y: 50 }, { tipo: 'DATA_GERACAO', x: 80, y: 10 },
        { tipo: 'HORA_GERACAO', x: 80, y: 40 }, { tipo: 'NUMERO_PAGINA', x: 80, y: 70 },
      ] },
      rodape: { altura: 80, layout: [{ tipo: 'ENDERECO_ENTIDADE', x: 2, y: 30 }] },
    })
    m.executar.mockResolvedValue({ colunas: ['a'], linhas: [], total: 0, truncado: false })
    const res = await app.inject({ method: 'GET', url: '/relatorios/meus/rp1/executar' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('Prefeitura') // NOME_ENTIDADE
    expect(res.body).toContain('data:image/png;base64') // BRASAO
    expect(res.body).toContain('Rua X, 100') // ENDERECO no rodapé
  })

  it('GET executar aplica a formatação dos elementos da faixa (Frente D)', async () => {
    m.buscar.mockResolvedValue({
      id: 'rp1', usuarioId: 'u1', entidadeId: 'ent1', nome: 'Rel', query: 'select 1',
      cabecalho: { altura: 120, layout: [
        { tipo: 'NOME_ENTIDADE', x: 50, y: 10, fonte: 'serif', tamanho: 20, negrito: true, italico: true, sublinhado: true, alinhamento: 'centro' },
        { tipo: 'BRASAO', x: 2, y: 0, altura: 72 },
      ] },
      rodape: null,
    })
    m.executar.mockResolvedValue({ colunas: ['a'], linhas: [], total: 0, truncado: false })
    const res = await app.inject({ method: 'GET', url: '/relatorios/meus/rp1/executar' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('transform:translateX(-50%)')
    expect(res.body).toContain('font-family:serif')
    expect(res.body).toContain('font-size:20px')
    expect(res.body).toContain('font-weight:bold')
    expect(res.body).toContain('text-decoration:underline')
    expect(res.body).toContain('max-height:72px') // brasão redimensionado
  })

  it('GET executar mostra erro do sandbox no preview', async () => {
    m.buscar.mockResolvedValue({ id: 'rp1', usuarioId: 'u1', entidadeId: 'ent1', nome: 'Rel', query: 'select 1', cabecalho: null, rodape: null })
    m.executar.mockRejectedValue(new ErroNegocio('CONFLITO', 'Sandbox não configurado.'))
    const res = await app.inject({ method: 'GET', url: '/relatorios/meus/rp1/executar' })
    expect(res.statusCode).toBe(409)
    expect(res.body).toContain('Sandbox não configurado.')
  })

  it('GET executar (default): resumo "Total de <coluna>" + painel de totais (ESCRITA)', async () => {
    m.buscar.mockResolvedValue({ id: 'rp1', usuarioId: 'u1', entidadeId: 'ent1', nome: 'Rel', query: 'select 1', cabecalho: null, rodape: null })
    m.executar.mockResolvedValue({ colunas: ['nivel', 'valor'], linhas: [['1', '10.00'], ['2', '5.00']], total: 2, truncado: false })
    const res = await app.inject({ method: 'GET', url: '/relatorios/meus/rp1/executar' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('Total de nivel') // default automático soma TODA coluna numérica…
    expect(res.body).toContain('Total de valor')
    expect(res.body).toContain('painel-totais') // …e o painel permite desligar
    expect(res.body).toContain('/app/relatorios/meus/rp1/totais')
  })

  it('GET executar com config salva: rótulo do usuário e sem os totais desmarcados', async () => {
    m.buscar.mockResolvedValue({
      id: 'rp1', usuarioId: 'u1', entidadeId: 'ent1', nome: 'Rel', query: 'select 1', cabecalho: null, rodape: null,
      configuracao: { totais: { subtotalPagina: false, itens: [{ coluna: 'valor', agg: 'SOMA', rotulo: 'Total dos impostos' }] } },
    })
    m.executar.mockResolvedValue({ colunas: ['nivel', 'valor'], linhas: [['1', '10.00'], ['2', '5.00']], total: 2, truncado: false })
    const res = await app.inject({ method: 'GET', url: '/relatorios/meus/rp1/executar' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('Total dos impostos: <strong>15.00</strong>')
    expect(res.body).not.toContain('Total de nivel: <strong>') // desmarcado na config (o default só vive no painel)
    expect(res.body).toContain('personalizado')
  })

  it('GET executar para LEITURA não mostra o painel de totais', async () => {
    ;({ app, prisma } = await montar({ entidadeId: 'ent1', ano: 2026, nivel: 'LEITURA' }))
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    m.buscar.mockResolvedValue({ id: 'rp1', usuarioId: 'u1', entidadeId: 'ent1', nome: 'Rel', query: 'select 1', cabecalho: null, rodape: null })
    m.executar.mockResolvedValue({ colunas: ['valor'], linhas: [['10.00']], total: 1, truncado: false })
    const res = await app.inject({ method: 'GET', url: '/relatorios/meus/rp1/executar' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('Total de valor') // resumo aparece
    expect(res.body).not.toContain('painel-totais') // painel não
  })

  // ── Salvar configuração de totais ─────────────────────────────
  it('POST meus/:id/totais salva e redireciona para o executar', async () => {
    m.salvarTotais.mockResolvedValue({ id: 'rp1' })
    const cfg = JSON.stringify({ subtotalPagina: true, itens: [{ coluna: 'valor', agg: 'SOMA' }] })
    const res = await app.inject(POST('/relatorios/meus/rp1/totais', { totais: cfg }))
    expect(res.statusCode).toBe(302)
    expect(res.headers.location).toBe('/app/relatorios/meus/rp1/executar')
    expect(m.salvarTotais).toHaveBeenCalledWith('rp1', 'u1', 'ent1', { subtotalPagina: true, itens: [{ coluna: 'valor', agg: 'SOMA' }] })
  })

  it('POST totais vazio volta ao automático (raw vazio chega ao service)', async () => {
    m.salvarTotais.mockResolvedValue({ id: 'rp1' })
    const res = await app.inject(POST('/relatorios/meus/rp1/totais', { totais: '' }))
    expect(res.statusCode).toBe(302)
    expect(m.salvarTotais).toHaveBeenCalledWith('rp1', 'u1', 'ent1', '')
  })

  it('POST totais com JSON malformado → 400 no hub, sem gravar', async () => {
    const res = await app.inject(POST('/relatorios/meus/rp1/totais', { totais: '{lixo' }))
    expect(res.statusCode).toBe(400)
    expect(res.body).toContain('JSON malformado')
    expect(m.salvarTotais).not.toHaveBeenCalled()
  })

  it('POST totais com ErroNegocio do service volta ao hub com o status', async () => {
    m.salvarTotais.mockRejectedValue(new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Relatório não encontrado.'))
    const res = await app.inject(POST('/relatorios/meus/rp1/totais', { totais: '' }))
    expect(res.statusCode).toBe(404)
    expect(res.body).toContain('Relatório não encontrado.')
  })

  it('POST totais bloqueado para LEITURA; redireciona se entidade sumiu; propaga erro inesperado', async () => {
    ;({ app, prisma } = await montar({ entidadeId: 'ent1', ano: 2026, nivel: 'LEITURA' }))
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    expect((await app.inject(POST('/relatorios/meus/rp1/totais', { totais: '' }))).statusCode).toBe(403)
    ;({ app, prisma } = await montar())
    prisma.entidade.findUnique.mockResolvedValue(null)
    expect((await app.inject(POST('/relatorios/meus/rp1/totais', { totais: '' }))).statusCode).toBe(302)
    ;({ app, prisma } = await montar())
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    m.salvarTotais.mockRejectedValue(new Error('boom'))
    expect((await app.inject(POST('/relatorios/meus/rp1/totais', { totais: '' }))).statusCode).toBe(500)
  })

  it('GET executar é permitido para LEITURA (executar é leitura)', async () => {
    ;({ app, prisma } = await montar({ entidadeId: 'ent1', ano: 2026, nivel: 'LEITURA' }))
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    m.buscar.mockResolvedValue({ id: 'rp1', usuarioId: 'u1', entidadeId: 'ent1', nome: 'Rel', query: 'select 1', cabecalho: null, rodape: null })
    m.executar.mockResolvedValue({ colunas: ['a'], linhas: [['x']], total: 1, truncado: false })
    expect((await app.inject({ method: 'GET', url: '/relatorios/meus/rp1/executar' })).statusCode).toBe(200)
  })

  it('GET executar: relatório inexistente → 404; entidade sumiu → 302', async () => {
    m.buscar.mockResolvedValue(null)
    expect((await app.inject({ method: 'GET', url: '/relatorios/meus/x/executar' })).statusCode).toBe(404)
    prisma.entidade.findUnique.mockResolvedValue(null)
    expect((await app.inject({ method: 'GET', url: '/relatorios/meus/rp1/executar' })).statusCode).toBe(302)
  })

  it('GET executar propaga erro inesperado (não-ErroNegocio)', async () => {
    m.buscar.mockResolvedValue({ id: 'rp1', usuarioId: 'u1', entidadeId: 'ent1', nome: 'Rel', query: 'select 1', cabecalho: null, rodape: null })
    m.executar.mockRejectedValue(new Error('boom'))
    expect((await app.inject({ method: 'GET', url: '/relatorios/meus/rp1/executar' })).statusCode).toBe(500)
  })

  // ── Cobertura de ramos ────────────────────────────────────────
  it('GET meus/:id redireciona se entidade sumiu', async () => {
    prisma.entidade.findUnique.mockResolvedValue(null)
    expect((await app.inject({ method: 'GET', url: '/relatorios/meus/rp1' })).statusCode).toBe(302)
  })

  it('GET meus/:id preenche editor com campos nulos e templates definidos', async () => {
    m.buscar.mockResolvedValue({ id: 'rp1', usuarioId: 'u1', entidadeId: 'ent1', nome: 'R', descricao: null, query: null, cabecalhoId: 'c1', rodapeId: 'r1' })
    expect((await app.inject({ method: 'GET', url: '/relatorios/meus/rp1' })).statusCode).toBe(200)
  })

  it('POST meus sem corpo chama criar com {} e redireciona', async () => {
    m.criar.mockResolvedValue({ id: 'rp1' })
    expect((await app.inject({ method: 'POST', url: '/relatorios/meus' })).statusCode).toBe(302)
    expect(m.criar).toHaveBeenCalledWith('u1', 'ent1', {})
  })

  it('POST meus/:id sem corpo atualiza e redireciona', async () => {
    m.atualizar.mockResolvedValue({ id: 'rp1' })
    expect((await app.inject({ method: 'POST', url: '/relatorios/meus/rp1' })).statusCode).toBe(302)
  })

  it('POST meus/:id propaga erro inesperado (500)', async () => {
    m.atualizar.mockRejectedValue(new Error('boom'))
    expect((await app.inject(POST('/relatorios/meus/rp1', { nome: 'X', query: 'select 1' }))).statusCode).toBe(500)
  })

  it('POST excluir redireciona se entidade sumiu', async () => {
    prisma.entidade.findUnique.mockResolvedValue(null)
    expect((await app.inject(POST('/relatorios/meus/rp1/excluir', {}))).statusCode).toBe(302)
  })

  it('POST excluir propaga erro inesperado (500)', async () => {
    m.excluir.mockRejectedValue(new Error('boom'))
    expect((await app.inject(POST('/relatorios/meus/rp1/excluir', {}))).statusCode).toBe(500)
  })

  it('GET executar tolera query nula no relatório', async () => {
    m.buscar.mockResolvedValue({ id: 'rp1', usuarioId: 'u1', entidadeId: 'ent1', nome: 'Rel', query: null, cabecalho: null, rodape: null })
    m.executar.mockResolvedValue({ colunas: [], linhas: [], total: 0, truncado: false })
    expect((await app.inject({ method: 'GET', url: '/relatorios/meus/rp1/executar' })).statusCode).toBe(200)
    expect(m.executar).toHaveBeenCalledWith('', { entidadeId: 'ent1', ano: 2026 })
  })
})
