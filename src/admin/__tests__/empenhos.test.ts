import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Prisma } from '@prisma/client'
import { resumirEmpenho } from '../../services/saldos-empenho.js'

const { listarMock, criarMock, estornarMock, fichaMock } = vi.hoisted(() => ({ listarMock: vi.fn(), criarMock: vi.fn(), estornarMock: vi.fn(), fichaMock: vi.fn() }))

vi.mock('../../services/empenhos.js', () => ({
  EmpenhosService: class {
    listar = listarMock
    criar = criarMock
    estornar = estornarMock
    ficha = fichaMock
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
    ;[listarMock, criarMock, estornarMock, fichaMock].forEach((m) => m.mockReset())
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

  it('GET /:id/ficha renderiza a ficha (6 colunas + histórico)', async () => {
    const movimentos = [
      { tipo: 'EMPENHO', valor: new Prisma.Decimal('500'), data: new Date('2026-02-01'), historico: 'Empenho 2026NE001' },
      { tipo: 'LIQUIDACAO', valor: new Prisma.Decimal('200'), data: new Date('2026-03-01'), historico: 'Liquidação LIQ-1', liquidacaoId: 'l1' },
    ]
    fichaMock.mockResolvedValue({
      empenho: {
        id: 'e1', numero: '2026NE001', entidadeId: 'ent1', tipo: 'ORDINARIO', data: new Date('2026-02-01'), status: 'ATIVO',
        fornecedor: { razaoSocial: 'ACME', cnpj: '00.000.000/0001-00', cpf: null },
        dotacaoDespesa: {
          unidadeOrcamentaria: { codigo: '02.001', nome: 'Secretaria', orgao: { codigo: '02', nome: 'Prefeitura Municipal' } },
          contaDespesa: { codigo: '3.3.90.30', descricao: 'Material de consumo' },
          fonteRecurso: { codigo: '500', nomenclatura: 'Recursos Livres' },
        },
      },
      movimentos,
      resumo: resumirEmpenho(movimentos),
    })
    const res = await app.inject({ method: 'GET', url: '/e1/ficha' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('Ficha de Empenho')
    expect(res.body).toContain('2026NE001')
    expect(res.body).toContain('Material de consumo')
    expect(res.body).toContain('Estorno empenho')
    expect(res.body).toContain('Órgão')
    expect(res.body).toContain('Prefeitura Municipal')
  })
  it('GET /:id/ficha inexistente → 404', async () => {
    fichaMock.mockRejectedValue(new Error('not found'))
    const res = await app.inject({ method: 'GET', url: '/x/ficha' })
    expect(res.statusCode).toBe(404)
  })

  it('POST /:id/estornar', async () => {
    prisma.empenho.findUnique.mockResolvedValue({ entidadeId: 'ent1' })
    estornarMock.mockResolvedValue({ id: 'e1' })
    const res = await app.inject({ method: 'POST', url: '/e1/estornar', ...form({ valor: '500' }) })
    expect(res.statusCode).toBe(204)
    expect(estornarMock).toHaveBeenCalledWith('e1', '500', expect.any(String), undefined)
  })

  it('POST /:id/estornar erro vira 400', async () => {
    prisma.empenho.findUnique.mockResolvedValue({ entidadeId: 'ent1' })
    estornarMock.mockRejectedValue(new Error('excede o saldo'))
    const res = await app.inject({ method: 'POST', url: '/e1/estornar', ...form({ valor: '999' }) })
    expect(res.statusCode).toBe(400)
  })
})
