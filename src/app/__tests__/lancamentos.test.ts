import { describe, it, expect, beforeEach, vi } from 'vitest'

const { listarMock } = vi.hoisted(() => ({ listarMock: vi.fn() }))

vi.mock('../../services/lancamentos.js', () => ({
  LancamentosService: class {
    listar = listarMock
  },
}))

import { criarApp } from '../../routes/__tests__/helpers/criarApp.js'
import { appLancamentosRoutes } from '../lancamentos.js'
import type { FastifyInstance } from 'fastify'
import type { PrismaMock } from '../../services/__tests__/helpers/prisma-mock.js'

const ENTIDADE = { id: 'ent1', nome: 'Prefeitura', municipio: { nome: 'Curitiba', estado: { sigla: 'PR', nome: 'Paraná' } } }

async function montar(contexto = { entidadeId: 'ent1', ano: 2026, nivel: 'ESCRITA' as const }) {
  return criarApp({ registrar: appLancamentosRoutes, comView: true, simularUsuario: { sub: 'u1', email: 'u@x.com' }, simularContexto: contexto })
}

describe('appLancamentosRoutes', () => {
  let app: FastifyInstance
  let prisma: PrismaMock

  beforeEach(async () => {
    listarMock.mockReset()
    ;({ app, prisma } = await montar())
  })

  it('filtra pelo ano do contexto (1º-jan a 31-dez)', async () => {
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    listarMock.mockResolvedValue([
      { data: new Date('2026-03-10'), historico: 'Empenho material', valor: '150.00' },
      { data: new Date('2026-04-01'), historico: 'Pagamento', valor: '50.00' },
    ])
    const res = await app.inject({ method: 'GET', url: '/lancamentos' })
    expect(res.statusCode).toBe(200)
    expect(listarMock).toHaveBeenCalledWith('ent1', { dataInicio: '2026-01-01', dataFim: '2026-12-31' })
    expect(res.body).toContain('Empenho material')
    expect(res.body).toContain('200,00') // total 150+50 formatado pt-BR
  })

  it('estado vazio quando não há lançamentos', async () => {
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    listarMock.mockResolvedValue([])
    const res = await app.inject({ method: 'GET', url: '/lancamentos' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('Nenhum lançamento')
  })

  it('usa o ano do contexto alternativo', async () => {
    ;({ app, prisma } = await montar({ entidadeId: 'ent9', ano: 2023, nivel: 'LEITURA' }))
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    listarMock.mockResolvedValue([])
    await app.inject({ method: 'GET', url: '/lancamentos' })
    expect(listarMock).toHaveBeenCalledWith('ent9', { dataInicio: '2023-01-01', dataFim: '2023-12-31' })
  })

  it('redireciona para /app/contexto se a entidade sumiu', async () => {
    prisma.entidade.findUnique.mockResolvedValue(null)
    const res = await app.inject({ method: 'GET', url: '/lancamentos' })
    expect(res.statusCode).toBe(302)
    expect(res.headers.location).toBe('/app/contexto')
  })
})
