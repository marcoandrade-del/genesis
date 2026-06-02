import { describe, it, expect, beforeEach, vi } from 'vitest'

const { listarMock, criarMock, cancelarMock } = vi.hoisted(() => ({
  listarMock: vi.fn(),
  criarMock: vi.fn(),
  cancelarMock: vi.fn(),
}))

// Mantém saldoDisponivel real; só troca a classe de service.
vi.mock('../../services/reservas-dotacao.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/reservas-dotacao.js')>()
  return {
    ...actual,
    ReservasDotacaoService: class {
      listar = listarMock
      criar = criarMock
      cancelar = cancelarMock
    },
  }
})

import { criarApp } from '../../routes/__tests__/helpers/criarApp.js'
import { adminReservasDotacaoRoutes } from '../reservas-dotacao.js'
import type { FastifyInstance } from 'fastify'
import type { PrismaMock } from '../../services/__tests__/helpers/prisma-mock.js'

const ENTIDADE = {
  id: 'ent1',
  nome: 'Prefeitura',
  municipio: { nome: 'Curitiba', estado: { sigla: 'PR', nome: 'Paraná' } },
}

const RESERVA = {
  id: 'r1',
  numero: 'R-001',
  valor: 500,
  status: 'ATIVA',
  dotacaoDespesa: {
    unidadeOrcamentaria: { codigo: '02.001' },
    contaDespesa: { codigo: '3.3.90.30' },
    fonteRecurso: { codigo: '500' },
  },
  termoReferencia: null,
}

const DOTACAO = {
  id: 'dot1',
  valorAutorizado: '1000',
  valorReservado: '0',
  valorEmpenhado: '0',
  unidadeOrcamentaria: { codigo: '02.001' },
  contaDespesa: { codigo: '3.3.90.30' },
  fonteRecurso: { codigo: '500' },
  orcamento: { ano: 2026 },
}

function form(obj: Record<string, string>) {
  return { payload: new URLSearchParams(obj).toString(), headers: { 'content-type': 'application/x-www-form-urlencoded' } }
}

describe('adminReservasDotacaoRoutes', () => {
  let app: FastifyInstance
  let prisma: PrismaMock

  beforeEach(async () => {
    ;[listarMock, criarMock, cancelarMock].forEach((m) => m.mockReset())
    ;({ app, prisma } = await criarApp({
      registrar: adminReservasDotacaoRoutes,
      comView: true,
      simularAdmin: { sub: 'a1', email: 'a@x.com' },
    }))
  })

  describe('GET /', () => {
    it('sem entidade mostra picker', async () => {
      prisma.estado.findMany.mockResolvedValue([])
      const res = await app.inject({ method: 'GET', url: '/' })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Selecione estado')
      expect(listarMock).not.toHaveBeenCalled()
    })

    it('com entidade lista reservas', async () => {
      prisma.estado.findMany.mockResolvedValue([])
      prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
      listarMock.mockResolvedValue([RESERVA])
      const res = await app.inject({ method: 'GET', url: '/?estadoId=e1&municipioId=mun1&entidadeId=ent1' })
      expect(listarMock).toHaveBeenCalledWith('ent1')
      expect(res.body).toContain('R-001')
      expect(res.body).toContain('Ativa')
    })
  })

  describe('GET /form', () => {
    it('sem entidadeId → 400', async () => {
      const res = await app.inject({ method: 'GET', url: '/form' })
      expect(res.statusCode).toBe(400)
    })

    it('renderiza com dotações e saldo', async () => {
      prisma.dotacaoDespesa.findMany.mockResolvedValue([DOTACAO])
      prisma.termoReferencia.findMany.mockResolvedValue([])
      const res = await app.inject({ method: 'GET', url: '/form?entidadeId=ent1' })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Nova Reserva')
      expect(res.body).toContain('1000.00') // saldo disponível calculado
    })
  })

  describe('POST /', () => {
    it('cria e devolve HX-Redirect', async () => {
      criarMock.mockResolvedValue({ id: 'r1' })
      const res = await app.inject({
        method: 'POST',
        url: '/',
        ...form({ entidadeId: 'ent1', dotacaoDespesaId: 'dot1', numero: 'R-1', valor: '100' }),
      })
      expect(res.statusCode).toBe(204)
      expect(res.headers['hx-redirect']).toContain('entidadeId=ent1')
      expect(criarMock).toHaveBeenCalledWith('ent1', { dotacaoDespesaId: 'dot1', numero: 'R-1', valor: '100' })
    })

    it('saldo insuficiente re-renderiza form com erro', async () => {
      criarMock.mockRejectedValue(new Error('Saldo insuficiente na dotação'))
      prisma.dotacaoDespesa.findMany.mockResolvedValue([DOTACAO])
      prisma.termoReferencia.findMany.mockResolvedValue([])
      const res = await app.inject({
        method: 'POST',
        url: '/',
        ...form({ entidadeId: 'ent1', dotacaoDespesaId: 'dot1', numero: 'R-1', valor: '99999' }),
      })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Saldo insuficiente')
    })
  })

  describe('POST /:id/cancelar', () => {
    it('404 quando reserva não existe', async () => {
      prisma.reservaDotacao.findUnique.mockResolvedValue(null)
      const res = await app.inject({ method: 'POST', url: '/r1/cancelar' })
      expect(res.statusCode).toBe(404)
    })

    it('cancela e devolve HX-Redirect', async () => {
      prisma.reservaDotacao.findUnique.mockResolvedValue({ id: 'r1', entidadeId: 'ent1' })
      cancelarMock.mockResolvedValue({ id: 'r1' })
      const res = await app.inject({ method: 'POST', url: '/r1/cancelar' })
      expect(res.statusCode).toBe(204)
      expect(res.headers['hx-redirect']).toContain('entidadeId=ent1')
      expect(cancelarMock).toHaveBeenCalledWith('r1')
    })

    it('erro do service vira 400', async () => {
      prisma.reservaDotacao.findUnique.mockResolvedValue({ id: 'r1', entidadeId: 'ent1' })
      cancelarMock.mockRejectedValue(new Error('Só é possível cancelar reserva ATIVA'))
      const res = await app.inject({ method: 'POST', url: '/r1/cancelar' })
      expect(res.statusCode).toBe(400)
      expect(res.body).toContain('ATIVA')
    })
  })
})
