import { describe, it, expect, beforeEach, vi } from 'vitest'

const m = vi.hoisted(() => ({
  arvore: vi.fn(),
  listarPastas: vi.fn(),
  criarPasta: vi.fn(),
  renomearPasta: vi.fn(),
  excluirPasta: vi.fn(),
  atribuirRelatorio: vi.fn(),
  buscar: vi.fn(),
  executar: vi.fn(),
  gerarPdf: vi.fn(),
}))

vi.mock('../../services/meus-relatorios-org.js', () => ({
  MeusRelatoriosOrgService: class {
    arvore = m.arvore
    listarPastas = m.listarPastas
    criarPasta = m.criarPasta
    renomearPasta = m.renomearPasta
    excluirPasta = m.excluirPasta
    atribuirRelatorio = m.atribuirRelatorio
  },
}))
vi.mock('../../services/meus-relatorios.js', () => ({
  MeusRelatoriosService: class {
    buscar = m.buscar
  },
}))
vi.mock('../../services/relatorio-executor.js', () => ({ criarExecutorPadrao: () => ({ executar: m.executar }) }))
vi.mock('../../services/relatorio-pdf.js', async (orig) => ({
  ...(await orig<typeof import('../../services/relatorio-pdf.js')>()),
  gerarPdf: m.gerarPdf,
}))

import { criarApp } from '../../routes/__tests__/helpers/criarApp.js'
import { appRelatoriosRoutes } from '../relatorios.js'
import { ErroNegocio } from '../../errors.js'
import type { FastifyInstance } from 'fastify'
import type { PrismaMock } from '../../services/__tests__/helpers/prisma-mock.js'

const ENTIDADE = {
  id: 'ent1', nome: 'Prefeitura', endereco: 'Rua X, 100', brasao: 'data:image/png;base64,AAAA',
  municipio: { nome: 'Curitiba', estado: { sigla: 'PR', nome: 'Paraná' } },
}
const form = (o: Record<string, string>) => Object.entries(o).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')
const POST = (url: string, body: Record<string, string>) => ({ method: 'POST' as const, url, payload: form(body), headers: { 'content-type': 'application/x-www-form-urlencoded' } })

async function montar(contexto = { entidadeId: 'ent1', ano: 2026, nivel: 'ESCRITA' as const }) {
  return criarApp({ registrar: appRelatoriosRoutes, comView: true, simularUsuario: { sub: 'u1', email: 'u@x.com' }, simularContexto: contexto })
}

describe('appRelatoriosRoutes — Pastas e PDF', () => {
  let app: FastifyInstance
  let prisma: PrismaMock

  beforeEach(async () => {
    Object.values(m).forEach((fn) => fn.mockReset())
    m.arvore.mockResolvedValue({ raizes: [], semPasta: [] })
    m.listarPastas.mockResolvedValue([])
    ;({ app, prisma } = await montar())
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
  })

  // Regressão: o JSON.stringify dos onsubmit (prompt de renomear / confirm de
  // excluir) precisa sair HTML-escapado — aspas literais terminavam o atributo
  // e o form submetia sem prompt/confirm nenhum (renomear "não funcionava" e
  // excluir não pedia confirmação).
  it('GET hub: onsubmit das pastas/relatórios sai com aspas escapadas (prompt/confirm vivos)', async () => {
    m.arvore.mockResolvedValue({
      raizes: [{ id: 'p1', nome: 'Minha pasta', relatorios: [{ id: 'r1', nome: 'Meu rel', descricao: null }], filhos: [] }],
      semPasta: [],
    })
    m.listarPastas.mockResolvedValue([{ id: 'p1', nome: 'Minha pasta' }])
    const res = await app.inject({ method: 'GET', url: '/relatorios' })
    expect(res.statusCode).toBe(200)
    // aspas do JSON escapadas como entidade dentro do atributo…
    expect(res.body).toContain('&#34;Minha pasta&#34;')
    expect(res.body).toContain('&#34;Meu rel&#34;')
    // …e NUNCA cruas (quebrariam o onsubmit no parser de HTML)
    expect(res.body).not.toMatch(/onsubmit="[^"]*prompt\('Novo nome da pasta:', $/m)
    expect(res.body).not.toContain(`, "Minha pasta")`)
    expect(res.body).not.toContain(`+ "Meu rel" +`)
  })

  // ── Pastas (via helper comEscrita) ────────────────────────────
  it('POST pastas cria e redireciona', async () => {
    m.criarPasta.mockResolvedValue({ id: 'p1' })
    const res = await app.inject(POST('/relatorios/pastas', { nome: 'Contas', parentId: '' }))
    expect(res.statusCode).toBe(302)
    expect(res.headers.location).toBe('/app/relatorios')
    expect(m.criarPasta).toHaveBeenCalledWith('u1', 'ent1', expect.objectContaining({ nome: 'Contas' }))
  })

  it('POST pastas repropaga ErroNegocio no hub', async () => {
    m.criarPasta.mockRejectedValue(new ErroNegocio('REQUISICAO_INVALIDA', 'Informe o nome da pasta.'))
    const res = await app.inject(POST('/relatorios/pastas', { nome: '' }))
    expect(res.statusCode).toBe(400)
    expect(res.body).toContain('Informe o nome da pasta.')
  })

  it('POST pastas propaga erro inesperado (500)', async () => {
    m.criarPasta.mockRejectedValue(new Error('boom'))
    expect((await app.inject(POST('/relatorios/pastas', { nome: 'X' }))).statusCode).toBe(500)
  })

  it('POST pastas bloqueado para LEITURA', async () => {
    ;({ app, prisma } = await montar({ entidadeId: 'ent1', ano: 2026, nivel: 'LEITURA' }))
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    expect((await app.inject(POST('/relatorios/pastas', { nome: 'X' }))).statusCode).toBe(403)
    expect(m.criarPasta).not.toHaveBeenCalled()
  })

  it('POST pastas redireciona se entidade sumiu', async () => {
    prisma.entidade.findUnique.mockResolvedValue(null)
    expect((await app.inject(POST('/relatorios/pastas', { nome: 'X' }))).statusCode).toBe(302)
  })

  it('POST pastas sem corpo chama criarPasta com {}', async () => {
    m.criarPasta.mockResolvedValue({ id: 'p1' })
    expect((await app.inject({ method: 'POST', url: '/relatorios/pastas' })).statusCode).toBe(302)
    expect(m.criarPasta).toHaveBeenCalledWith('u1', 'ent1', {})
  })

  it('POST pastas/:id renomeia', async () => {
    m.renomearPasta.mockResolvedValue({ id: 'p1' })
    expect((await app.inject(POST('/relatorios/pastas/p1', { nome: 'Novo' }))).statusCode).toBe(302)
    expect(m.renomearPasta).toHaveBeenCalledWith('p1', 'u1', 'ent1', 'Novo')
  })

  it('POST pastas/:id/excluir exclui; ErroNegocio volta ao hub', async () => {
    m.excluirPasta.mockResolvedValue({ id: 'p1' })
    expect((await app.inject(POST('/relatorios/pastas/p1/excluir', {}))).statusCode).toBe(302)
    m.excluirPasta.mockRejectedValue(new ErroNegocio('CONFLITO', 'Mova os relatórios para fora antes.'))
    const res = await app.inject(POST('/relatorios/pastas/p1/excluir', {}))
    expect(res.statusCode).toBe(409)
    expect(res.body).toContain('Mova os relatórios')
  })

  it('POST meus/:id/pasta move o relatório', async () => {
    m.atribuirRelatorio.mockResolvedValue({ id: 'f1' })
    expect((await app.inject(POST('/relatorios/meus/r1/pasta', { pastaId: 'p1' }))).statusCode).toBe(302)
    expect(m.atribuirRelatorio).toHaveBeenCalledWith('r1', 'u1', 'ent1', 'p1')
  })

  it('POST meus/:id/pasta bloqueado para LEITURA', async () => {
    ;({ app, prisma } = await montar({ entidadeId: 'ent1', ano: 2026, nivel: 'LEITURA' }))
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    expect((await app.inject(POST('/relatorios/meus/r1/pasta', { pastaId: 'p1' }))).statusCode).toBe(403)
  })

  // ── PDF ───────────────────────────────────────────────────────
  it('GET pdf gera o PDF (sem cabeçalho/rodapé)', async () => {
    m.buscar.mockResolvedValue({ id: 'r1', usuarioId: 'u1', entidadeId: 'ent1', nome: 'Rel', query: 'select 1', cabecalho: null, rodape: null })
    m.executar.mockResolvedValue({ colunas: ['a'], linhas: [['x']], total: 1, truncado: false })
    m.gerarPdf.mockResolvedValue(Buffer.from('%PDF-1.4 fake'))
    const res = await app.inject({ method: 'GET', url: '/relatorios/meus/r1/pdf' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('application/pdf')
    expect(res.rawPayload.toString()).toContain('%PDF')
    expect(m.executar).toHaveBeenCalledWith('select 1', { entidadeId: 'ent1', ano: 2026 })
    expect(m.gerarPdf).toHaveBeenCalled()
  })

  it('GET pdf monta header/footer a partir do cabeçalho/rodapé', async () => {
    m.buscar.mockResolvedValue({
      id: 'r1', usuarioId: 'u1', entidadeId: 'ent1', nome: 'Rel', query: 'select 1',
      cabecalho: { altura: 100, layout: [{ tipo: 'NOME_ENTIDADE', x: 10, y: 10 }] },
      rodape: { altura: 60, layout: [{ tipo: 'NUMERO_PAGINA', x: 80, y: 30 }] },
    })
    m.executar.mockResolvedValue({ colunas: ['a'], linhas: [], total: 0, truncado: false })
    m.gerarPdf.mockResolvedValue(Buffer.from('%PDF'))
    const res = await app.inject({ method: 'GET', url: '/relatorios/meus/r1/pdf' })
    expect(res.statusCode).toBe(200)
    const arg = m.gerarPdf.mock.calls[0]![0]
    expect(arg.header).toContain('Prefeitura')
    expect(arg.footer).toContain('pageNumber')
    expect(arg.margemTopoMm).toBeGreaterThan(12)
  })

  it('GET pdf: inexistente → 404; entidade sumiu → 302', async () => {
    m.buscar.mockResolvedValue(null)
    expect((await app.inject({ method: 'GET', url: '/relatorios/meus/x/pdf' })).statusCode).toBe(404)
    prisma.entidade.findUnique.mockResolvedValue(null)
    expect((await app.inject({ method: 'GET', url: '/relatorios/meus/r1/pdf' })).statusCode).toBe(302)
  })

  it('GET pdf: erro do sandbox volta ao hub', async () => {
    m.buscar.mockResolvedValue({ id: 'r1', usuarioId: 'u1', entidadeId: 'ent1', nome: 'Rel', query: 'select 1', cabecalho: null, rodape: null })
    m.executar.mockRejectedValue(new ErroNegocio('CONFLITO', 'Sandbox não configurado.'))
    const res = await app.inject({ method: 'GET', url: '/relatorios/meus/r1/pdf' })
    expect(res.statusCode).toBe(409)
    expect(res.body).toContain('Sandbox não configurado.')
  })

  it('GET pdf propaga erro inesperado (500)', async () => {
    m.buscar.mockResolvedValue({ id: 'r1', usuarioId: 'u1', entidadeId: 'ent1', nome: 'Rel', query: 'select 1', cabecalho: null, rodape: null })
    m.executar.mockResolvedValue({ colunas: ['a'], linhas: [], total: 0, truncado: false })
    m.gerarPdf.mockRejectedValue(new Error('chromium morreu'))
    expect((await app.inject({ method: 'GET', url: '/relatorios/meus/r1/pdf' })).statusCode).toBe(500)
  })

  it('GET pdf tolera query nula e entidade sem endereço/brasão', async () => {
    prisma.entidade.findUnique.mockResolvedValue({ ...ENTIDADE, endereco: null, brasao: null })
    m.buscar.mockResolvedValue({ id: 'r1', usuarioId: 'u1', entidadeId: 'ent1', nome: 'Rel', query: null, cabecalho: null, rodape: null })
    m.executar.mockResolvedValue({ colunas: ['a'], linhas: [], total: 0, truncado: false })
    m.gerarPdf.mockResolvedValue(Buffer.from('%PDF'))
    expect((await app.inject({ method: 'GET', url: '/relatorios/meus/r1/pdf' })).statusCode).toBe(200)
    expect(m.executar).toHaveBeenCalledWith('', { entidadeId: 'ent1', ano: 2026 })
  })

  // ── Exportar (multi-formato) ──────────────────────────────────
  const REL = { id: 'r1', usuarioId: 'u1', entidadeId: 'ent1', nome: 'Lançamentos 2026', query: 'select 1', cabecalho: null, rodape: null }
  const RESULTADO = { colunas: ['historico', 'valor'], linhas: [['Empenho;NE', 1234.5]], total: 1, truncado: false }

  it.each([
    ['csv', 'text/csv', 'attachment'],
    ['txt', 'text/plain', 'attachment'],
    ['json', 'application/json', 'attachment'],
    ['xml', 'application/xml', 'attachment'],
    ['html', 'text/html', 'inline'],
    ['xls', 'spreadsheetml.sheet', 'attachment'],
    ['doc', 'wordprocessingml.document', 'attachment'],
  ])('GET exportar/%s devolve o mime e a disposição certos', async (fmt, mime, disp) => {
    m.buscar.mockResolvedValue(REL)
    m.executar.mockResolvedValue(RESULTADO)
    const res = await app.inject({ method: 'GET', url: `/relatorios/meus/r1/exportar/${fmt}` })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain(mime)
    expect(res.headers['content-disposition']).toContain(disp)
    expect(res.headers['content-disposition']).toContain('lancamentos_2026.')
  })

  it('GET exportar/csv: BOM, separador ; e campo escapado', async () => {
    m.buscar.mockResolvedValue(REL)
    m.executar.mockResolvedValue(RESULTADO)
    const res = await app.inject({ method: 'GET', url: '/relatorios/meus/r1/exportar/csv' })
    expect(res.body.charCodeAt(0)).toBe(0xfeff)
    expect(res.body).toContain('historico;valor')
    expect(res.body).toContain('"Empenho;NE"')
  })

  it('GET exportar/json: corpo é JSON com as linhas', async () => {
    m.buscar.mockResolvedValue(REL)
    m.executar.mockResolvedValue(RESULTADO)
    const res = await app.inject({ method: 'GET', url: '/relatorios/meus/r1/exportar/json' })
    expect(JSON.parse(res.body).linhas[0]).toEqual({ historico: 'Empenho;NE', valor: 1234.5 })
  })

  it('GET exportar/xls e /doc são arquivos zip (PK)', async () => {
    m.buscar.mockResolvedValue(REL)
    m.executar.mockResolvedValue(RESULTADO)
    for (const fmt of ['xls', 'doc']) {
      const res = await app.inject({ method: 'GET', url: `/relatorios/meus/r1/exportar/${fmt}` })
      expect(res.statusCode).toBe(200)
      expect(res.rawPayload[0]).toBe(0x50)
      expect(res.rawPayload[1]).toBe(0x4b)
    }
  })

  it('GET exportar/pdf usa o Playwright (gerarPdf)', async () => {
    m.buscar.mockResolvedValue(REL)
    m.executar.mockResolvedValue(RESULTADO)
    m.gerarPdf.mockResolvedValue(Buffer.from('%PDF'))
    const res = await app.inject({ method: 'GET', url: '/relatorios/meus/r1/exportar/pdf' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('application/pdf')
    expect(m.gerarPdf).toHaveBeenCalled()
  })

  it('GET exportar/<inválido> → 400 sem executar a query', async () => {
    m.buscar.mockResolvedValue(REL)
    const res = await app.inject({ method: 'GET', url: '/relatorios/meus/r1/exportar/zip' })
    expect(res.statusCode).toBe(400)
    expect(res.body).toContain('Formato de exportação inválido')
    expect(m.executar).not.toHaveBeenCalled()
  })

  it('GET exportar: inexistente → 404; entidade sumiu → 302', async () => {
    m.buscar.mockResolvedValue(null)
    expect((await app.inject({ method: 'GET', url: '/relatorios/meus/x/exportar/csv' })).statusCode).toBe(404)
    prisma.entidade.findUnique.mockResolvedValue(null)
    expect((await app.inject({ method: 'GET', url: '/relatorios/meus/r1/exportar/csv' })).statusCode).toBe(302)
  })

  it('GET exportar: erro do sandbox volta ao hub', async () => {
    m.buscar.mockResolvedValue(REL)
    m.executar.mockRejectedValue(new ErroNegocio('CONFLITO', 'Sandbox não configurado.'))
    const res = await app.inject({ method: 'GET', url: '/relatorios/meus/r1/exportar/csv' })
    expect(res.statusCode).toBe(409)
    expect(res.body).toContain('Sandbox não configurado.')
  })

  it('GET exportar: LEITURA pode (é leitura)', async () => {
    ;({ app, prisma } = await montar({ entidadeId: 'ent1', ano: 2026, nivel: 'LEITURA' }))
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    m.buscar.mockResolvedValue(REL)
    m.executar.mockResolvedValue(RESULTADO)
    expect((await app.inject({ method: 'GET', url: '/relatorios/meus/r1/exportar/csv' })).statusCode).toBe(200)
  })

  it('GET exportar propaga erro inesperado (500)', async () => {
    m.buscar.mockResolvedValue(REL)
    m.executar.mockRejectedValue(new Error('boom'))
    expect((await app.inject({ method: 'GET', url: '/relatorios/meus/r1/exportar/csv' })).statusCode).toBe(500)
  })

  it('GET exportar tolera query nula (executa com string vazia)', async () => {
    m.buscar.mockResolvedValue({ ...REL, query: null })
    m.executar.mockResolvedValue(RESULTADO)
    expect((await app.inject({ method: 'GET', url: '/relatorios/meus/r1/exportar/csv' })).statusCode).toBe(200)
    expect(m.executar).toHaveBeenCalledWith('', { entidadeId: 'ent1', ano: 2026 })
  })
})
