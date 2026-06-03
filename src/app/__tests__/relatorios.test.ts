import { describe, it, expect, beforeEach, vi } from 'vitest'

const m = vi.hoisted(() => ({
  listarCabecalhos: vi.fn(),
  listarRodapes: vi.fn(),
  buscarCabecalho: vi.fn(),
  criarCabecalho: vi.fn(),
  atualizarCabecalho: vi.fn(),
  excluirCabecalho: vi.fn(),
  buscarRodape: vi.fn(),
  criarRodape: vi.fn(),
  atualizarRodape: vi.fn(),
  excluirRodape: vi.fn(),
}))

vi.mock('../../services/cabecalhos-rodapes.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/cabecalhos-rodapes.js')>()
  return {
    ...actual,
    CabecalhosRodapesService: class {
      listarCabecalhos = m.listarCabecalhos
      listarRodapes = m.listarRodapes
      buscarCabecalho = m.buscarCabecalho
      criarCabecalho = m.criarCabecalho
      atualizarCabecalho = m.atualizarCabecalho
      excluirCabecalho = m.excluirCabecalho
      buscarRodape = m.buscarRodape
      criarRodape = m.criarRodape
      atualizarRodape = m.atualizarRodape
      excluirRodape = m.excluirRodape
    },
  }
})

import { criarApp } from '../../routes/__tests__/helpers/criarApp.js'
import { appRelatoriosRoutes } from '../relatorios.js'
import { ErroNegocio } from '../../errors.js'
import type { FastifyInstance } from 'fastify'
import type { PrismaMock } from '../../services/__tests__/helpers/prisma-mock.js'

const ENTIDADE = {
  id: 'ent1',
  nome: 'Prefeitura',
  endereco: 'Rua X, 100',
  brasao: null,
  municipio: { nome: 'Curitiba', estado: { sigla: 'PR', nome: 'Paraná' } },
}

const form = (o: Record<string, string>) =>
  Object.entries(o)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&')

const POST = (url: string, body: Record<string, string>) => ({
  method: 'POST' as const,
  url,
  payload: form(body),
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
})

async function montar(contexto = { entidadeId: 'ent1', ano: 2026, nivel: 'ESCRITA' as const }) {
  return criarApp({ registrar: appRelatoriosRoutes, comView: true, simularUsuario: { sub: 'u1', email: 'u@x.com' }, simularContexto: contexto })
}

describe('appRelatoriosRoutes', () => {
  let app: FastifyInstance
  let prisma: PrismaMock

  beforeEach(async () => {
    Object.values(m).forEach((fn) => fn.mockReset())
    m.listarCabecalhos.mockResolvedValue([])
    m.listarRodapes.mockResolvedValue([])
    ;({ app, prisma } = await montar())
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
  })

  // ── Hub ───────────────────────────────────────────────────────
  it('GET /relatorios lista cabeçalhos e rodapés', async () => {
    m.listarCabecalhos.mockResolvedValue([{ id: 'c1', nome: 'Cab Padrão', altura: 120, layout: [{ tipo: 'BRASAO', x: 0, y: 0 }] }])
    const res = await app.inject({ method: 'GET', url: '/relatorios' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('Cab Padrão')
    expect(res.body).toContain('Cabeçalhos')
  })

  it('GET /relatorios redireciona se a entidade sumiu', async () => {
    prisma.entidade.findUnique.mockResolvedValue(null)
    const res = await app.inject({ method: 'GET', url: '/relatorios' })
    expect(res.statusCode).toBe(302)
    expect(res.headers.location).toBe('/app/contexto')
  })

  // ── Editor (GET) ──────────────────────────────────────────────
  it('GET cabecalhos/novo abre o editor (ESCRITA)', async () => {
    const res = await app.inject({ method: 'GET', url: '/relatorios/cabecalhos/novo' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('modelo de cabeçalho')
    expect(res.body).toContain('Elementos disponíveis')
    // O form precisa postar com o prefixo /app, senão o submit do navegador
    // bate em rota inexistente (404) — o editor é servido sob /app.
    expect(res.body).toContain('action="/app/relatorios/cabecalhos"')
  })

  it('editor de edição posta para /app/...//:id (prefixo /app preservado)', async () => {
    m.buscarCabecalho.mockResolvedValue({ id: 'c1', entidadeId: 'ent1', nome: 'Meu Cab', altura: 150, layout: [{ tipo: 'BRASAO', x: 0, y: 0 }] })
    const res = await app.inject({ method: 'GET', url: '/relatorios/cabecalhos/c1' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('action="/app/relatorios/cabecalhos/c1"')
  })

  it('GET cabecalhos/novo bloqueado para LEITURA (403, volta ao hub)', async () => {
    ;({ app, prisma } = await montar({ entidadeId: 'ent1', ano: 2026, nivel: 'LEITURA' }))
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    const res = await app.inject({ method: 'GET', url: '/relatorios/cabecalhos/novo' })
    expect(res.statusCode).toBe(403)
    expect(res.body).toContain('apenas leitura')
  })

  it('GET cabecalhos/:id carrega registro existente', async () => {
    m.buscarCabecalho.mockResolvedValue({ id: 'c1', entidadeId: 'ent1', nome: 'Meu Cab', altura: 150, layout: [] })
    const res = await app.inject({ method: 'GET', url: '/relatorios/cabecalhos/c1' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('Meu Cab')
  })

  it('GET cabecalhos/:id inexistente → 404 no hub', async () => {
    m.buscarCabecalho.mockResolvedValue(null)
    const res = await app.inject({ method: 'GET', url: '/relatorios/cabecalhos/x' })
    expect(res.statusCode).toBe(404)
    expect(res.body).toContain('não encontrado')
  })

  it('GET cabecalhos/:id de outra entidade → 404', async () => {
    m.buscarCabecalho.mockResolvedValue({ id: 'c1', entidadeId: 'OUTRA', nome: 'X', altura: 120, layout: [] })
    const res = await app.inject({ method: 'GET', url: '/relatorios/cabecalhos/c1' })
    expect(res.statusCode).toBe(404)
  })

  it('GET cabecalhos/:id redireciona se entidade sumiu', async () => {
    prisma.entidade.findUnique.mockResolvedValue(null)
    const res = await app.inject({ method: 'GET', url: '/relatorios/cabecalhos/c1' })
    expect(res.statusCode).toBe(302)
  })

  // ── Criar ─────────────────────────────────────────────────────
  it('POST cabecalhos cria e redireciona; layout é parseado', async () => {
    m.criarCabecalho.mockResolvedValue({ id: 'c1' })
    const res = await app.inject(POST('/relatorios/cabecalhos', { nome: 'Padrão', altura: '120', layout: '[{"tipo":"BRASAO","x":1,"y":2}]' }))
    expect(res.statusCode).toBe(302)
    expect(res.headers.location).toBe('/app/relatorios')
    expect(m.criarCabecalho).toHaveBeenCalledWith('ent1', 'u1', expect.objectContaining({ nome: 'Padrão', layout: [{ tipo: 'BRASAO', x: 1, y: 2 }] }))
  })

  it('POST cabecalhos com JSON de layout malformado → 400 reabre editor', async () => {
    const res = await app.inject(POST('/relatorios/cabecalhos', { nome: 'X', layout: '{quebrado' }))
    expect(res.statusCode).toBe(400)
    expect(res.body).toContain('Layout inválido')
    expect(m.criarCabecalho).not.toHaveBeenCalled()
  })

  it('POST cabecalhos repropaga ErroNegocio do service no editor', async () => {
    m.criarCabecalho.mockRejectedValue(new ErroNegocio('REQUISICAO_INVALIDA', 'Informe o nome do template.'))
    const res = await app.inject(POST('/relatorios/cabecalhos', { nome: '', layout: '[]' }))
    expect(res.statusCode).toBe(400)
    expect(res.body).toContain('Informe o nome do template.')
  })

  it('POST cabecalhos propaga erro inesperado (não-ErroNegocio)', async () => {
    m.criarCabecalho.mockRejectedValue(new Error('boom'))
    const res = await app.inject(POST('/relatorios/cabecalhos', { nome: 'X', layout: '[]' }))
    expect(res.statusCode).toBe(500)
  })

  it('POST cabecalhos bloqueado para LEITURA', async () => {
    ;({ app, prisma } = await montar({ entidadeId: 'ent1', ano: 2026, nivel: 'LEITURA' }))
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    const res = await app.inject(POST('/relatorios/cabecalhos', { nome: 'X', layout: '[]' }))
    expect(res.statusCode).toBe(403)
    expect(m.criarCabecalho).not.toHaveBeenCalled()
  })

  it('POST cabecalhos redireciona se entidade sumiu', async () => {
    prisma.entidade.findUnique.mockResolvedValue(null)
    const res = await app.inject(POST('/relatorios/cabecalhos', { nome: 'X', layout: '[]' }))
    expect(res.statusCode).toBe(302)
  })

  // ── Atualizar ─────────────────────────────────────────────────
  it('POST cabecalhos/:id atualiza e redireciona', async () => {
    m.atualizarCabecalho.mockResolvedValue({ id: 'c1' })
    const res = await app.inject(POST('/relatorios/cabecalhos/c1', { nome: 'Novo', altura: '130', layout: '[]' }))
    expect(res.statusCode).toBe(302)
    expect(m.atualizarCabecalho).toHaveBeenCalledWith('c1', 'ent1', expect.objectContaining({ nome: 'Novo' }))
  })

  it('POST cabecalhos/:id com erro reabre o editor de edição', async () => {
    m.atualizarCabecalho.mockRejectedValue(new ErroNegocio('REQUISICAO_INVALIDA', 'Altura inválida.'))
    const res = await app.inject(POST('/relatorios/cabecalhos/c1', { nome: 'X', altura: '9', layout: '[]' }))
    expect(res.statusCode).toBe(400)
    expect(res.body).toContain('Altura inválida.')
  })

  // ── Excluir ───────────────────────────────────────────────────
  it('POST cabecalhos/:id/excluir remove e redireciona', async () => {
    m.excluirCabecalho.mockResolvedValue({ id: 'c1' })
    const res = await app.inject(POST('/relatorios/cabecalhos/c1/excluir', {}))
    expect(res.statusCode).toBe(302)
    expect(m.excluirCabecalho).toHaveBeenCalledWith('c1', 'ent1')
  })

  it('POST excluir com ErroNegocio → hub com erro', async () => {
    m.excluirCabecalho.mockRejectedValue(new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Cabeçalho não encontrado.'))
    const res = await app.inject(POST('/relatorios/cabecalhos/x/excluir', {}))
    expect(res.statusCode).toBe(404)
    expect(res.body).toContain('Cabeçalho não encontrado.')
  })

  it('POST excluir bloqueado para LEITURA', async () => {
    ;({ app, prisma } = await montar({ entidadeId: 'ent1', ano: 2026, nivel: 'LEITURA' }))
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    const res = await app.inject(POST('/relatorios/cabecalhos/c1/excluir', {}))
    expect(res.statusCode).toBe(403)
    expect(m.excluirCabecalho).not.toHaveBeenCalled()
  })

  // ── Rodapés (cobre o ramo RODAPE do registrador genérico) ─────
  it('GET rodapes/novo abre o editor de rodapé', async () => {
    const res = await app.inject({ method: 'GET', url: '/relatorios/rodapes/novo' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('modelo de rodapé')
  })

  it('POST rodapes cria via criarRodape', async () => {
    m.criarRodape.mockResolvedValue({ id: 'r1' })
    const res = await app.inject(POST('/relatorios/rodapes', { nome: 'Rodapé', altura: '80', layout: '[{"tipo":"NUMERO_PAGINA","x":90,"y":50}]' }))
    expect(res.statusCode).toBe(302)
    expect(m.criarRodape).toHaveBeenCalledWith('ent1', 'u1', expect.objectContaining({ nome: 'Rodapé', layout: [{ tipo: 'NUMERO_PAGINA', x: 90, y: 50 }] }))
  })

  it('POST rodapes/:id atualiza e exclui', async () => {
    m.atualizarRodape.mockResolvedValue({ id: 'r1' })
    expect((await app.inject(POST('/relatorios/rodapes/r1', { nome: 'N', layout: '[]' }))).statusCode).toBe(302)
    expect(m.atualizarRodape).toHaveBeenCalledWith('r1', 'ent1', expect.objectContaining({ nome: 'N' }))
    m.excluirRodape.mockResolvedValue({ id: 'r1' })
    expect((await app.inject(POST('/relatorios/rodapes/r1/excluir', {}))).statusCode).toBe(302)
    expect(m.excluirRodape).toHaveBeenCalledWith('r1', 'ent1')
  })

  // ── Cobertura de ramos ────────────────────────────────────────
  it('POST cabecalhos sem corpo: layout vira [] e cria', async () => {
    m.criarCabecalho.mockResolvedValue({ id: 'c1' })
    const res = await app.inject({ method: 'POST', url: '/relatorios/cabecalhos' })
    expect(res.statusCode).toBe(302)
    expect(m.criarCabecalho).toHaveBeenCalledWith('ent1', 'u1', expect.objectContaining({ layout: [] }))
  })

  it('POST cabecalhos aceita layout já como array (corpo JSON, não-string)', async () => {
    m.criarCabecalho.mockResolvedValue({ id: 'c1' })
    const res = await app.inject({
      method: 'POST',
      url: '/relatorios/cabecalhos',
      payload: JSON.stringify({ nome: 'X', layout: [{ tipo: 'BRASAO', x: 1, y: 2 }] }),
      headers: { 'content-type': 'application/json' },
    })
    expect(res.statusCode).toBe(302)
    expect(m.criarCabecalho).toHaveBeenCalledWith('ent1', 'u1', expect.objectContaining({ layout: [{ tipo: 'BRASAO', x: 1, y: 2 }] }))
  })

  it('POST cabecalhos: erro com layout não-array e sem nome reabre editor', async () => {
    m.criarCabecalho.mockRejectedValue(new ErroNegocio('REQUISICAO_INVALIDA', 'qualquer'))
    const res = await app.inject(POST('/relatorios/cabecalhos', { layout: '{"a":1}' }))
    expect(res.statusCode).toBe(400)
  })

  it('GET cabecalhos/novo redireciona se entidade sumiu', async () => {
    prisma.entidade.findUnique.mockResolvedValue(null)
    expect((await app.inject({ method: 'GET', url: '/relatorios/cabecalhos/novo' })).statusCode).toBe(302)
  })

  it('GET cabecalhos/:id bloqueado para LEITURA', async () => {
    ;({ app, prisma } = await montar({ entidadeId: 'ent1', ano: 2026, nivel: 'LEITURA' }))
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    expect((await app.inject({ method: 'GET', url: '/relatorios/cabecalhos/c1' })).statusCode).toBe(403)
  })

  it('GET cabecalhos/:id tolera layout não-array no banco', async () => {
    m.buscarCabecalho.mockResolvedValue({ id: 'c1', entidadeId: 'ent1', nome: 'C', altura: 120, layout: null })
    expect((await app.inject({ method: 'GET', url: '/relatorios/cabecalhos/c1' })).statusCode).toBe(200)
  })

  it('POST cabecalhos/:id redireciona se entidade sumiu', async () => {
    prisma.entidade.findUnique.mockResolvedValue(null)
    expect((await app.inject(POST('/relatorios/cabecalhos/c1', { nome: 'X', layout: '[]' }))).statusCode).toBe(302)
  })

  it('POST cabecalhos/:id bloqueado para LEITURA', async () => {
    ;({ app, prisma } = await montar({ entidadeId: 'ent1', ano: 2026, nivel: 'LEITURA' }))
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    expect((await app.inject(POST('/relatorios/cabecalhos/c1', { nome: 'X', layout: '[]' }))).statusCode).toBe(403)
  })

  it('POST cabecalhos/:id sem corpo atualiza (layout [])', async () => {
    m.atualizarCabecalho.mockResolvedValue({ id: 'c1' })
    expect((await app.inject({ method: 'POST', url: '/relatorios/cabecalhos/c1' })).statusCode).toBe(302)
  })

  it('POST cabecalhos/:id propaga erro inesperado (500)', async () => {
    m.atualizarCabecalho.mockRejectedValue(new Error('boom'))
    expect((await app.inject(POST('/relatorios/cabecalhos/c1', { nome: 'X', layout: '[]' }))).statusCode).toBe(500)
  })

  it('POST cabecalhos/:id re-render após ErroNegocio sem nome', async () => {
    m.atualizarCabecalho.mockRejectedValue(new ErroNegocio('REQUISICAO_INVALIDA', 'qualquer'))
    expect((await app.inject(POST('/relatorios/cabecalhos/c1', { layout: '[]' }))).statusCode).toBe(400)
  })

  it('POST excluir redireciona se entidade sumiu', async () => {
    prisma.entidade.findUnique.mockResolvedValue(null)
    expect((await app.inject(POST('/relatorios/cabecalhos/c1/excluir', {}))).statusCode).toBe(302)
  })

  it('POST excluir propaga erro inesperado (500)', async () => {
    m.excluirCabecalho.mockRejectedValue(new Error('boom'))
    expect((await app.inject(POST('/relatorios/cabecalhos/c1/excluir', {}))).statusCode).toBe(500)
  })

  it('GET rodapes/:id carrega rodapé existente', async () => {
    m.buscarRodape.mockResolvedValue({ id: 'r1', entidadeId: 'ent1', nome: 'Rodapé R', altura: 80, layout: [] })
    const res = await app.inject({ method: 'GET', url: '/relatorios/rodapes/r1' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('Rodapé R')
  })
})
