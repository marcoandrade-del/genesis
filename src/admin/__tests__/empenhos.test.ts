import { describe, it, expect, beforeEach, vi } from 'vitest'

const { listarMock, criarMock, anularMock } = vi.hoisted(() => ({ listarMock: vi.fn(), criarMock: vi.fn(), anularMock: vi.fn() }))

vi.mock('../../services/empenhos.js', () => ({
  EmpenhosService: class {
    listar = listarMock
    criar = criarMock
    anular = anularMock
  },
}))

import { criarApp } from '../../routes/__tests__/helpers/criarApp.js'
import { adminEmpenhosRoutes } from '../empenhos.js'
import type { FastifyInstance } from 'fastify'
import type { PrismaMock } from '../../services/__tests__/helpers/prisma-mock.js'

const ENTIDADE = { id: 'ent1', nome: 'Pref', municipio: { nome: 'Curitiba', estado: { sigla: 'PR', nome: 'Paraná' } } }
const EMPENHO = {
  id: 'e1', numero: '2026NE001', tipo: 'ORDINARIO', valor: '500', valorLiquidado: '0', status: 'ATIVO',
  fornecedor: { razaoSocial: 'ACME' },
  dotacaoDespesa: { unidadeOrcamentaria: { codigo: '02.001' }, contaDespesa: { codigo: '3.3.90.30' }, fonteRecurso: { codigo: '500' } },
  _count: { liquidacoes: 0 },
}

function form(obj: Record<string, string>) {
  return { payload: new URLSearchParams(obj).toString(), headers: { 'content-type': 'application/x-www-form-urlencoded' } }
}

describe('adminEmpenhosRoutes', () => {
  let app: FastifyInstance
  let prisma: PrismaMock
  beforeEach(async () => {
    ;[listarMock, criarMock, anularMock].forEach((m) => m.mockReset())
    ;({ app, prisma } = await criarApp({ registrar: adminEmpenhosRoutes, comView: true, simularAdmin: { sub: 'a1', email: 'a@x.com' } }))
  })

  it('GET / lista por entidade', async () => {
    prisma.estado.findMany.mockResolvedValue([])
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    listarMock.mockResolvedValue([EMPENHO])
    const res = await app.inject({ method: 'GET', url: '/?estadoId=e&municipioId=m&entidadeId=ent1' })
    expect(listarMock).toHaveBeenCalledWith('ent1')
    expect(res.body).toContain('2026NE001')
    expect(res.body).toContain('Ativo')
  })

  it('GET /form sem entidadeId → 400', async () => {
    const res = await app.inject({ method: 'GET', url: '/form' })
    expect(res.statusCode).toBe(400)
  })

  it('GET /form renderiza', async () => {
    const res = await app.inject({ method: 'GET', url: '/form?entidadeId=ent1' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('Novo Empenho')
  })

  it('POST / cria com reserva', async () => {
    criarMock.mockResolvedValue({ id: 'e1' })
    const res = await app.inject({
      method: 'POST', url: '/',
      ...form({ entidadeId: 'ent1', dotacaoDespesaId: 'dot1', fornecedorId: 'f1', reservaDotacaoId: 'r1', numero: '2026NE001', tipo: 'ORDINARIO', valor: '500' }),
    })
    expect(res.statusCode).toBe(204)
    expect(criarMock.mock.calls[0][0]).toBe('ent1')
    expect(criarMock.mock.calls[0][1]).toMatchObject({ dotacaoDespesaId: 'dot1', fornecedorId: 'f1', reservaDotacaoId: 'r1', tipo: 'ORDINARIO', valor: '500' })
  })

  it('POST /:id/anular', async () => {
    prisma.empenho.findUnique.mockResolvedValue({ entidadeId: 'ent1' })
    anularMock.mockResolvedValue({ id: 'e1' })
    const res = await app.inject({ method: 'POST', url: '/e1/anular' })
    expect(res.statusCode).toBe(204)
    expect(anularMock).toHaveBeenCalledWith('e1')
  })

  it('POST /:id/anular erro vira 400', async () => {
    prisma.empenho.findUnique.mockResolvedValue({ entidadeId: 'ent1' })
    anularMock.mockRejectedValue(new Error('com liquidações'))
    const res = await app.inject({ method: 'POST', url: '/e1/anular' })
    expect(res.statusCode).toBe(400)
  })
})
