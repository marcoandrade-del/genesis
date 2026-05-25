import { describe, it, expect, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'
import { criarApp, tokenJwt } from './helpers/criarApp.js'
import { lancamentosRoutes } from '../lancamentos.js'
import type { FastifyInstance } from 'fastify'
import type { PrismaMock } from '../../services/__tests__/helpers/prisma-mock.js'

const MUNICIPIO = {
  id: 'mun1',
  modeloContabilId: null,
  estado: { modeloContabilId: 'm1' },
}
const PLANO = { id: 'p1', ano: 2026, modeloContabilId: 'm1' }
const CAIXA = { id: 'c1', codigo: '1.1.1', planoId: 'p1', admiteMovimento: true }
const RECEITA = { id: 'c2', codigo: '4.1.1', planoId: 'p1', admiteMovimento: true }

const PAYLOAD = {
  data: '2026-05-25',
  historico: 'Recebimento',
  itens: [
    { contaId: 'c1', tipo: 'DEBITO', valor: '100.00' },
    { contaId: 'c2', tipo: 'CREDITO', valor: '100.00' },
  ],
}

describe('lancamentosRoutes', () => {
  let app: FastifyInstance
  let prisma: PrismaMock
  let auth: { authorization: string }

  beforeEach(async () => {
    ({ app, prisma } = await criarApp({ registrar: lancamentosRoutes, proteger: true }))
    auth = { authorization: `Bearer ${tokenJwt(app, { sub: 'u1', email: 'a@b.com' })}` }
  })

  it('GET exige autenticação', async () => {
    const res = await app.inject({ method: 'GET', url: '/municipios/mun1/lancamentos' })
    expect(res.statusCode).toBe(401)
  })

  it('GET /municipios/:id/lancamentos lista', async () => {
    prisma.lancamento.findMany.mockResolvedValue([])
    const res = await app.inject({ method: 'GET', url: '/municipios/mun1/lancamentos', headers: auth })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toEqual([])
  })

  it('GET /lancamentos/:id 404 quando não existe', async () => {
    prisma.lancamento.findUnique.mockResolvedValue(null)
    const res = await app.inject({ method: 'GET', url: '/lancamentos/x', headers: auth })
    expect(res.statusCode).toBe(404)
  })

  it('GET /lancamentos/:id 200 com itens', async () => {
    prisma.lancamento.findUnique.mockResolvedValue({ id: 'lanc1', itens: [] })
    const res = await app.inject({ method: 'GET', url: '/lancamentos/lanc1', headers: auth })
    expect(res.statusCode).toBe(200)
  })

  it('POST 400 sem itens', async () => {
    const res = await app.inject({
      method: 'POST', url: '/municipios/mun1/lancamentos', headers: auth,
      payload: { data: '2026-05-25', historico: 'X' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('POST 400 com menos de 2 itens', async () => {
    const res = await app.inject({
      method: 'POST', url: '/municipios/mun1/lancamentos', headers: auth,
      payload: { ...PAYLOAD, itens: [PAYLOAD.itens[0]] },
    })
    expect(res.statusCode).toBe(400)
  })

  it('POST 400 com valor mal formado', async () => {
    const res = await app.inject({
      method: 'POST', url: '/municipios/mun1/lancamentos', headers: auth,
      payload: {
        ...PAYLOAD,
        itens: [
          { contaId: '00000000-0000-0000-0000-000000000001', tipo: 'DEBITO', valor: '100,00' }, // vírgula
          { contaId: '00000000-0000-0000-0000-000000000002', tipo: 'CREDITO', valor: '100.00' },
        ],
      },
    })
    expect(res.statusCode).toBe(400)
  })

  it('POST 400 com data fora do padrão', async () => {
    const res = await app.inject({
      method: 'POST', url: '/municipios/mun1/lancamentos', headers: auth,
      payload: { ...PAYLOAD, data: '25/05/2026' },
    })
    expect(res.statusCode).toBe(400)
  })

  // UUIDs casam com os mocks de CAIXA/RECEITA — o schema Fastify exige format:uuid.
  const UUID_CAIXA = '00000000-0000-0000-0000-000000000001'
  const UUID_RECEITA = '00000000-0000-0000-0000-000000000002'

  it('POST 201 caminho feliz', async () => {
    prisma.municipio.findUnique.mockResolvedValue(MUNICIPIO)
    prisma.planoDeContas.findFirst.mockResolvedValue(PLANO)
    prisma.conta.findMany.mockResolvedValue([
      { ...CAIXA, id: UUID_CAIXA },
      { ...RECEITA, id: UUID_RECEITA },
    ])
    prisma.lancamento.create.mockResolvedValue({ id: 'lanc1' })
    prisma.lancamentoItem.createMany.mockResolvedValue({ count: 2 })
    prisma.resumoMensalConta.upsert.mockResolvedValue({})

    const res = await app.inject({
      method: 'POST', url: '/municipios/mun1/lancamentos', headers: auth,
      payload: {
        ...PAYLOAD,
        itens: [
          { contaId: UUID_CAIXA, tipo: 'DEBITO', valor: '100.00' },
          { contaId: UUID_RECEITA, tipo: 'CREDITO', valor: '100.00' },
        ],
      },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().data.id).toBe('lanc1')
  })

  it('POST 422 quando lançamento desbalanceado', async () => {
    prisma.municipio.findUnique.mockResolvedValue(MUNICIPIO)
    prisma.planoDeContas.findFirst.mockResolvedValue(PLANO)
    prisma.conta.findMany.mockResolvedValue([CAIXA, RECEITA])

    const res = await app.inject({
      method: 'POST', url: '/municipios/mun1/lancamentos', headers: auth,
      payload: {
        ...PAYLOAD,
        itens: [
          { contaId: UUID_CAIXA, tipo: 'DEBITO', valor: '100.00' },
          { contaId: UUID_RECEITA, tipo: 'CREDITO', valor: '99.99' },
        ],
      },
    })
    expect(res.statusCode).toBe(422)
  })

  it('POST 404 quando município não existe', async () => {
    prisma.municipio.findUnique.mockResolvedValue(null)
    const res = await app.inject({
      method: 'POST', url: '/municipios/mun1/lancamentos', headers: auth,
      payload: {
        ...PAYLOAD,
        itens: [
          { contaId: UUID_CAIXA, tipo: 'DEBITO', valor: '100.00' },
          { contaId: UUID_RECEITA, tipo: 'CREDITO', valor: '100.00' },
        ],
      },
    })
    expect(res.statusCode).toBe(404)
  })

  it('DELETE 204 ao excluir lançamento', async () => {
    prisma.lancamento.findUnique.mockResolvedValue({
      id: 'lanc1',
      municipioId: 'mun1',
      data: new Date('2026-05-25T00:00:00Z'),
      itens: [
        { contaId: 'c1', tipo: 'DEBITO', valor: new Prisma.Decimal(100) },
        { contaId: 'c2', tipo: 'CREDITO', valor: new Prisma.Decimal(100) },
      ],
    })
    prisma.resumoMensalConta.update.mockResolvedValue({})
    prisma.lancamento.delete.mockResolvedValue({})

    const res = await app.inject({ method: 'DELETE', url: '/lancamentos/lanc1', headers: auth })
    expect(res.statusCode).toBe(204)
  })

  it('DELETE 404 quando não existe', async () => {
    prisma.lancamento.findUnique.mockResolvedValue(null)
    const res = await app.inject({ method: 'DELETE', url: '/lancamentos/lanc1', headers: auth })
    expect(res.statusCode).toBe(404)
  })
})
