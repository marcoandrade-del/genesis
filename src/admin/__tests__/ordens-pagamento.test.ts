import { describe, it, expect, beforeEach, vi } from 'vitest'

const { listarMock, criarMock, confirmarMock, cancelarMock } = vi.hoisted(() => ({ listarMock: vi.fn(), criarMock: vi.fn(), confirmarMock: vi.fn(), cancelarMock: vi.fn() }))

vi.mock('../../services/ordens-pagamento.js', () => ({
  OrdensPagamentoService: class {
    listar = listarMock
    criar = criarMock
    confirmarPagamento = confirmarMock
    cancelar = cancelarMock
  },
}))

import { criarApp } from '../../routes/__tests__/helpers/criarApp.js'
import { adminOrdensPagamentoRoutes } from '../ordens-pagamento.js'
import type { FastifyInstance } from 'fastify'
import type { PrismaMock } from '../../services/__tests__/helpers/prisma-mock.js'

const ENTIDADE = { id: 'ent1', nome: 'Pref', municipio: { nome: 'Curitiba', estado: { sigla: 'PR', nome: 'Paraná' } } }
const OP = {
  id: 'op1', numero: 'OP-001', valor: '200', contaBancaria: 'BB 1234-5', status: 'EMITIDA',
  liquidacao: { numero: 'LIQ-001', empenho: { numero: '2026NE001' } },
}

function form(obj: Record<string, string>) {
  return { payload: new URLSearchParams(obj).toString(), headers: { 'content-type': 'application/x-www-form-urlencoded' } }
}

describe('adminOrdensPagamentoRoutes', () => {
  let app: FastifyInstance
  let prisma: PrismaMock
  beforeEach(async () => {
    ;[listarMock, criarMock, confirmarMock, cancelarMock].forEach((m) => m.mockReset())
    ;({ app, prisma } = await criarApp({ registrar: adminOrdensPagamentoRoutes, comView: true, simularAdmin: { sub: 'a1', email: 'a@x.com' } }))
  })

  it('GET / lista por entidade', async () => {
    prisma.estado.findMany.mockResolvedValue([])
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    listarMock.mockResolvedValue([OP])
    const res = await app.inject({ method: 'GET', url: '/?estadoId=e&municipioId=m&entidadeId=ent1' })
    expect(listarMock).toHaveBeenCalledWith('ent1')
    expect(res.body).toContain('OP-001')
    expect(res.body).toContain('Emitida')
  })

  it('GET /form renderiza com liquidações', async () => {
    prisma.liquidacao.findMany.mockResolvedValue([{ id: 'l1', numero: 'LIQ-001', valor: '300', valorPago: '100', empenho: { numero: '2026NE001' } }])
    const res = await app.inject({ method: 'GET', url: '/form?entidadeId=ent1' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('Nova Ordem de Pagamento')
    expect(res.body).toContain('200.00') // saldo 300-100
  })

  it('POST / cria', async () => {
    criarMock.mockResolvedValue({ id: 'op1' })
    const res = await app.inject({ method: 'POST', url: '/', ...form({ entidadeId: 'ent1', liquidacaoId: 'l1', numero: 'OP-001', valor: '200', contaBancaria: 'BB 1234-5' }) })
    expect(res.statusCode).toBe(204)
    expect(criarMock.mock.calls[0][1]).toMatchObject({ liquidacaoId: 'l1', numero: 'OP-001', valor: '200', contaBancaria: 'BB 1234-5' })
  })

  it('POST /:id/confirmar', async () => {
    prisma.ordemPagamento.findUnique.mockResolvedValue({ entidadeId: 'ent1' })
    confirmarMock.mockResolvedValue({ id: 'op1' })
    const res = await app.inject({ method: 'POST', url: '/op1/confirmar', ...form({ comprovante: 'TED-9' }) })
    expect(res.statusCode).toBe(204)
    expect(confirmarMock).toHaveBeenCalledWith('op1', 'TED-9')
  })

  it('POST /:id/cancelar', async () => {
    prisma.ordemPagamento.findUnique.mockResolvedValue({ entidadeId: 'ent1' })
    cancelarMock.mockResolvedValue({ id: 'op1' })
    const res = await app.inject({ method: 'POST', url: '/op1/cancelar' })
    expect(res.statusCode).toBe(204)
    expect(cancelarMock).toHaveBeenCalledWith('op1')
  })
})
