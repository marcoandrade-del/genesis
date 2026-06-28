import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const m = vi.hoisted(() => ({ rcl: vi.fn(), rclConsolidada: vi.fn(), guardiao: vi.fn() }))
vi.mock('../../services/memorial-rcl.js', () => ({
  MemorialRclService: class {
    rcl = m.rcl
    rclConsolidada = m.rclConsolidada
  },
}))
vi.mock('../../services/memorial-guardiao.js', () => ({
  MemorialGuardiaoService: class {
    guardiao = m.guardiao
  },
}))

import { criarApp } from '../../routes/__tests__/helpers/criarApp.js'
import { memoriaisApiRoutes, CONTRATO_MEMORIAIS } from '../memoriais.js'
import type { FastifyInstance } from 'fastify'

const TOKEN = 'segredo-de-teste'
const auth = { authorization: `Bearer ${TOKEN}` }

describe('memoriaisApiRoutes (data API versionada)', () => {
  let app: FastifyInstance
  const envAntes = process.env.GENESIS_API_TOKEN

  beforeEach(async () => {
    m.rcl.mockReset()
    m.rclConsolidada.mockReset()
    m.guardiao.mockReset()
    process.env.GENESIS_API_TOKEN = TOKEN
    ;({ app } = await criarApp({ registrar: memoriaisApiRoutes, prefix: '/api' }))
  })
  afterEach(() => {
    if (envAntes === undefined) delete process.env.GENESIS_API_TOKEN
    else process.env.GENESIS_API_TOKEN = envAntes
  })

  it('503 quando GENESIS_API_TOKEN não está configurado', async () => {
    delete process.env.GENESIS_API_TOKEN
    const res = await app.inject({ method: 'GET', url: '/api/memoriais/contrato' })
    expect(res.statusCode).toBe(503)
  })

  it('401 sem token e com token errado', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/memoriais/contrato' })).statusCode).toBe(401)
    const r2 = await app.inject({ method: 'GET', url: '/api/memoriais/contrato', headers: { authorization: 'Bearer errado' } })
    expect(r2.statusCode).toBe(401)
  })

  it('GET /contrato devolve versão + recursos (o Oxy checa antes de consumir)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/memoriais/contrato', headers: auth })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.versao).toBe(CONTRATO_MEMORIAIS.versao)
    expect(body.recursos.map((r: { recurso: string }) => r.recurso)).toContain('rcl')
  })

  it('400 quando faltam entidadeId/ano', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/memoriais/rcl', headers: auth })).statusCode).toBe(400)
    // entidadeId presente mas ano inválido também é 400
    expect((await app.inject({ method: 'GET', url: '/api/memoriais/rcl?entidadeId=e1', headers: auth })).statusCode).toBe(400)
  })

  it('200 RCL em envelope versionado', async () => {
    m.rcl.mockResolvedValue({ rcl: 1000 })
    const res = await app.inject({ method: 'GET', url: '/api/memoriais/rcl?entidadeId=e1&ano=2026', headers: auth })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.contrato.versao).toBe(CONTRATO_MEMORIAIS.versao)
    expect(body.contrato.recurso).toBe('rcl')
    expect(body.dados.rcl).toBe(1000)
    expect(m.rcl).toHaveBeenCalledWith('e1', 2026)
  })

  it('404 quando a entidade não existe', async () => {
    m.rcl.mockResolvedValue(null)
    const res = await app.inject({ method: 'GET', url: '/api/memoriais/rcl?entidadeId=x&ano=2026', headers: auth })
    expect(res.statusCode).toBe(404)
  })

  it('200 RCL consolidada em envelope', async () => {
    m.rclConsolidada.mockResolvedValue({ rclTotal: 500 })
    const res = await app.inject({ method: 'GET', url: '/api/memoriais/rcl-consolidada?entidadeId=e1&ano=2026', headers: auth })
    expect(res.statusCode).toBe(200)
    expect(res.json().contrato.recurso).toBe('rcl-consolidada')
    expect(res.json().dados.rclTotal).toBe(500)
  })

  it('404 consolidada quando não existe', async () => {
    m.rclConsolidada.mockResolvedValue(null)
    const res = await app.inject({ method: 'GET', url: '/api/memoriais/rcl-consolidada?entidadeId=x&ano=2026', headers: auth })
    expect(res.statusCode).toBe(404)
  })

  it('200 Guardião (lista de indicadores) em envelope', async () => {
    m.guardiao.mockResolvedValue({ indicadores: [{ indicador: 'Despesa com Pessoal' }] })
    const res = await app.inject({ method: 'GET', url: '/api/memoriais/guardiao?entidadeId=e1&ano=2026', headers: auth })
    expect(res.statusCode).toBe(200)
    expect(res.json().contrato.recurso).toBe('guardiao')
    expect(res.json().dados.indicadores[0].indicador).toBe('Despesa com Pessoal')
  })

  it('404 Guardião quando a entidade não existe', async () => {
    m.guardiao.mockResolvedValue(null)
    const res = await app.inject({ method: 'GET', url: '/api/memoriais/guardiao?entidadeId=x&ano=2026', headers: auth })
    expect(res.statusCode).toBe(404)
  })
})
