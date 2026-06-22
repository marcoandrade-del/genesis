import { describe, it, expect, beforeEach, vi } from 'vitest'

const m = vi.hoisted(() => ({ granularidade: vi.fn(), definir: vi.fn() }))
vi.mock('../../services/configuracao-dashboard.js', () => ({
  ConfiguracaoDashboardService: class {
    granularidade = m.granularidade
    definir = m.definir
  },
}))

import { criarApp } from '../../routes/__tests__/helpers/criarApp.js'
import { appConfiguracaoRoutes } from '../configuracao.js'
import type { FastifyInstance } from 'fastify'
import type { PrismaMock } from '../../services/__tests__/helpers/prisma-mock.js'

const ENTIDADE = { id: 'ent1', nome: 'Prefeitura', municipio: { nome: 'Maringá', estado: { sigla: 'PR', nome: 'Paraná' } } }
const form = (o: Record<string, string>) => Object.entries(o).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')
const POST = (body: Record<string, string>) => ({ method: 'POST' as const, url: '/configuracao', payload: form(body), headers: { 'content-type': 'application/x-www-form-urlencoded' } })

async function montar(contexto = { entidadeId: 'ent1', ano: 2026, nivel: 'ESCRITA' as const }) {
  return criarApp({ registrar: appConfiguracaoRoutes, comView: true, simularUsuario: { sub: 'u1', email: 'u@x.com' }, simularContexto: contexto })
}

describe('appConfiguracaoRoutes', () => {
  let app: FastifyInstance
  let prisma: PrismaMock
  beforeEach(async () => {
    m.granularidade.mockReset().mockResolvedValue('DESDOBRADO')
    m.definir.mockReset()
    ;({ app, prisma } = await montar())
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
  })

  it('GET mostra as duas opções e marca a atual', async () => {
    m.granularidade.mockResolvedValue('PADRAO')
    const res = await app.inject({ method: 'GET', url: '/configuracao' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('Plano padrão (modelo)')
    expect(res.body).toContain('Com desdobramentos locais')
    expect(res.body).toMatch(/id="gPadrao"[^>]*checked/)
  })

  it('POST salva a granularidade escolhida', async () => {
    const res = await app.inject(POST({ granularidadePlano: 'PADRAO' }))
    expect(res.statusCode).toBe(200)
    expect(m.definir).toHaveBeenCalledWith('ent1', 'PADRAO')
    expect(res.body).toContain('Configuração salva')
  })

  it('valor inválido cai para DESDOBRADO', async () => {
    await app.inject(POST({ granularidadePlano: 'xpto' }))
    expect(m.definir).toHaveBeenCalledWith('ent1', 'DESDOBRADO')
  })

  it('LEITURA não pode salvar (403)', async () => {
    ;({ app, prisma } = await montar({ entidadeId: 'ent1', ano: 2026, nivel: 'LEITURA' }))
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    const res = await app.inject(POST({ granularidadePlano: 'PADRAO' }))
    expect(res.statusCode).toBe(403)
    expect(m.definir).not.toHaveBeenCalled()
  })
})
