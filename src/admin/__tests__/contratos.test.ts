import { describe, it, expect, beforeEach, vi } from 'vitest'

const { listarMock, buscarMock, criarMock, atualizarMock, statusMock, excluirMock } = vi.hoisted(() => ({
  listarMock: vi.fn(), buscarMock: vi.fn(), criarMock: vi.fn(), atualizarMock: vi.fn(), statusMock: vi.fn(), excluirMock: vi.fn(),
}))

vi.mock('../../services/contratos.js', () => ({
  ContratosService: class {
    listar = listarMock
    buscarPorId = buscarMock
    criar = criarMock
    atualizar = atualizarMock
    alterarStatus = statusMock
    excluir = excluirMock
  },
}))

import { criarApp } from '../../routes/__tests__/helpers/criarApp.js'
import { adminContratosRoutes } from '../contratos.js'
import type { FastifyInstance } from 'fastify'
import type { PrismaMock } from '../../services/__tests__/helpers/prisma-mock.js'

const ENTIDADE = { id: 'ent1', nome: 'Pref', municipio: { nome: 'Curitiba', estado: { sigla: 'PR', nome: 'Paraná' } } }
const CONTRATO = {
  id: 'ct1', entidadeId: 'ent1', numero: 'C-001', objeto: 'Material', status: 'VIGENTE',
  vigenciaInicio: new Date('2026-01-01'), vigenciaFim: new Date('2026-12-31'), valorTotal: '1000',
  fornecedor: { razaoSocial: 'ACME' },
}

function form(obj: Record<string, string>) {
  return { payload: new URLSearchParams(obj).toString(), headers: { 'content-type': 'application/x-www-form-urlencoded' } }
}

describe('adminContratosRoutes', () => {
  let app: FastifyInstance
  let prisma: PrismaMock
  beforeEach(async () => {
    ;[listarMock, buscarMock, criarMock, atualizarMock, statusMock, excluirMock].forEach((m) => m.mockReset())
    ;({ app, prisma } = await criarApp({ registrar: adminContratosRoutes, comView: true, simularAdmin: { sub: 'a1', email: 'a@x.com' } }))
  })

  it('GET / lista por entidade', async () => {
    prisma.estado.findMany.mockResolvedValue([])
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    listarMock.mockResolvedValue([CONTRATO])
    const res = await app.inject({ method: 'GET', url: '/?estadoId=e&municipioId=m&entidadeId=ent1' })
    expect(listarMock).toHaveBeenCalledWith('ent1')
    expect(res.body).toContain('C-001')
    expect(res.body).toContain('ACME')
  })

  it('GET /form sem entidadeId → 400', async () => {
    const res = await app.inject({ method: 'GET', url: '/form' })
    expect(res.statusCode).toBe(400)
  })

  it('GET /form renderiza', async () => {
    const res = await app.inject({ method: 'GET', url: '/form?entidadeId=ent1' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('Novo Contrato')
  })

  it('POST / cria com itensJson', async () => {
    criarMock.mockResolvedValue({ id: 'ct1' })
    const itensJson = JSON.stringify([{ itemCatalogoId: 'c1', quantidadeContratada: '10', precoUnitario: '5' }])
    const res = await app.inject({
      method: 'POST', url: '/',
      ...form({ entidadeId: 'ent1', fornecedorId: 'f1', numero: 'C-001', objeto: 'X', vigenciaInicio: '2026-01-01', vigenciaFim: '2026-12-31', valorTotal: '1000', itensJson }),
    })
    expect(res.statusCode).toBe(204)
    expect(criarMock.mock.calls[0][0]).toBe('ent1')
    expect(criarMock.mock.calls[0][1].itens[0]).toMatchObject({ itemCatalogoId: 'c1' })
  })

  it('POST /:id/status encerra', async () => {
    prisma.contrato.findUnique.mockResolvedValue({ entidadeId: 'ent1' })
    statusMock.mockResolvedValue({ id: 'ct1' })
    const res = await app.inject({ method: 'POST', url: '/ct1/status', ...form({ status: 'ENCERRADO' }) })
    expect(res.statusCode).toBe(204)
    expect(statusMock).toHaveBeenCalledWith('ct1', 'ENCERRADO')
  })

  it('POST /:id/status inválido → 400', async () => {
    const res = await app.inject({ method: 'POST', url: '/ct1/status', ...form({ status: 'XX' }) })
    expect(res.statusCode).toBe(400)
  })

  it('DELETE /:id erro vira 400', async () => {
    excluirMock.mockRejectedValue(new Error('empenhado'))
    const res = await app.inject({ method: 'DELETE', url: '/ct1' })
    expect(res.statusCode).toBe(400)
  })
})
