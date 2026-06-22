import { describe, it, expect, beforeEach, vi } from 'vitest'

const { listarMock, criarMock, cancelarMock } = vi.hoisted(() => ({ listarMock: vi.fn(), criarMock: vi.fn(), cancelarMock: vi.fn() }))

vi.mock('../../services/liquidacoes.js', () => ({
  LiquidacoesService: class {
    listar = listarMock
    criar = criarMock
    cancelar = cancelarMock
  },
}))

import { criarApp } from '../../routes/__tests__/helpers/criarApp.js'
import { adminLiquidacoesRoutes } from '../liquidacoes.js'
import type { FastifyInstance } from 'fastify'
import type { PrismaMock } from '../../services/__tests__/helpers/prisma-mock.js'

const ENTIDADE = { id: 'ent1', nome: 'Pref', municipio: { nome: 'Curitiba', estado: { sigla: 'PR', nome: 'Paraná' } } }
const LIQ = {
  id: 'l1', numero: 'LIQ-001', valor: '300', valorPago: '0', status: 'ATIVA', notaFiscal: 'NF-1',
  empenho: { numero: '2026NE001', fornecedor: { razaoSocial: 'ACME' } }, _count: { ordensPagamento: 0 },
}

function form(obj: Record<string, string>) {
  return { payload: new URLSearchParams(obj).toString(), headers: { 'content-type': 'application/x-www-form-urlencoded' } }
}

describe('adminLiquidacoesRoutes', () => {
  let app: FastifyInstance
  let prisma: PrismaMock
  beforeEach(async () => {
    ;[listarMock, criarMock, cancelarMock].forEach((m) => m.mockReset())
    ;({ app, prisma } = await criarApp({ registrar: adminLiquidacoesRoutes, comView: true, simularAdmin: { sub: 'a1', email: 'a@x.com' } }))
  })

  it('GET / lista por entidade', async () => {
    prisma.estado.findMany.mockResolvedValue([])
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    listarMock.mockResolvedValue([LIQ])
    const res = await app.inject({ method: 'GET', url: '/?estadoId=e&municipioId=m&entidadeId=ent1' })
    expect(listarMock).toHaveBeenCalledWith('ent1')
    expect(res.body).toContain('LIQ-001')
  })

  it('GET /form renderiza com empenhos', async () => {
    prisma.empenho.findMany.mockResolvedValue([{ id: 'e1', numero: '2026NE001', valor: '500', valorLiquidado: '100', fornecedor: { razaoSocial: 'ACME' } }])
    const res = await app.inject({ method: 'GET', url: '/form?entidadeId=ent1' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('Nova Liquidação')
    expect(res.body).toContain('400.00') // saldo 500-100
  })

  it('POST / cria', async () => {
    criarMock.mockResolvedValue({ id: 'l1' })
    const res = await app.inject({ method: 'POST', url: '/', ...form({ entidadeId: 'ent1', empenhoId: 'e1', numero: 'LIQ-001', valor: '300', notaFiscal: 'NF-1' }) })
    expect(res.statusCode).toBe(204)
    expect(criarMock.mock.calls[0][1]).toMatchObject({ empenhoId: 'e1', numero: 'LIQ-001', valor: '300', notaFiscal: 'NF-1' })
  })

  it('POST /:id/cancelar', async () => {
    prisma.liquidacao.findUnique.mockResolvedValue({ entidadeId: 'ent1' })
    cancelarMock.mockResolvedValue({ id: 'l1' })
    const res = await app.inject({ method: 'POST', url: '/l1/cancelar' })
    expect(res.statusCode).toBe(204)
    expect(cancelarMock).toHaveBeenCalledWith('l1', expect.any(String))
  })
})
