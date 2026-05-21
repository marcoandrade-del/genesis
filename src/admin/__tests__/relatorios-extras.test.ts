import { describe, it, expect, beforeEach, vi } from 'vitest'

const { criarFixoMock, atualizarFixoMock, excluirFixoMock } = vi.hoisted(() => ({
  criarFixoMock: vi.fn(),
  atualizarFixoMock: vi.fn(),
  excluirFixoMock: vi.fn(),
}))

vi.mock('../../services/relatorios.js', () => ({
  RelatoriosService: class {
    criarFixo = criarFixoMock
    atualizarFixo = atualizarFixoMock
    excluirFixo = excluirFixoMock
  },
}))

import { criarApp } from '../../routes/__tests__/helpers/criarApp.js'
import { adminRelatoriosRoutes } from '../relatorios.js'
import type { FastifyInstance } from 'fastify'
import type { PrismaMock } from '../../services/__tests__/helpers/prisma-mock.js'

function form(obj: Record<string, string>) {
  return {
    payload: new URLSearchParams(obj).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  }
}

describe('adminRelatoriosRoutes — branches restantes', () => {
  let app: FastifyInstance
  let prisma: PrismaMock

  beforeEach(async () => {
    [criarFixoMock, atualizarFixoMock, excluirFixoMock].forEach(m => m.mockReset())
    ;({ app, prisma } = await criarApp({
      registrar: adminRelatoriosRoutes,
      comView: true,
      simularAdmin: { sub: 'admin1', email: 'admin@x.com' },
    }))
  })

  // Line 71 — POST / com erro não-Error
  it('POST / usa mensagem fallback quando criar lança valor não-Error', async () => {
    criarFixoMock.mockRejectedValue('string crua')
    const res = await app.inject({
      method: 'POST', url: '/',
      ...form({ sistemaId: 's1', nome: 'X', rota: '/x', descricao: '' }),
    })
    expect(res.body).toContain('Erro ao criar relatório.')
  })

  // Line 89 — PUT com nome vazio e relatório não encontrado
  it('PUT /:id com nome vazio renderiza form mesmo quando relatório não existe', async () => {
    prisma.relatorioFixo.findUnique.mockResolvedValue(null)
    const res = await app.inject({
      method: 'PUT', url: '/r1',
      ...form({ nome: '', descricao: '', rota: '/x' }),
    })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('Nome e rota são obrigatórios.')
  })

  // Line 107 — PUT com erro não-Error
  it('PUT /:id usa mensagem fallback quando atualizar lança valor não-Error', async () => {
    atualizarFixoMock.mockRejectedValue('string crua')
    prisma.relatorioFixo.findUnique.mockResolvedValue({
      id: 'r1', nome: 'V', rota: '/v', sistemaId: 's1', sistema: { nome: 'ERP' },
    })
    const res = await app.inject({
      method: 'PUT', url: '/r1',
      ...form({ nome: 'X', descricao: '', rota: '/x' }),
    })
    expect(res.body).toContain('Erro ao atualizar relatório.')
  })

  // Line 110 — PUT catch com relatório não encontrado
  it('PUT /:id no catch lida com relatório inexistente', async () => {
    atualizarFixoMock.mockRejectedValue(new Error('Falhou.'))
    prisma.relatorioFixo.findUnique.mockResolvedValue(null)
    const res = await app.inject({
      method: 'PUT', url: '/r1',
      ...form({ nome: 'X', descricao: '', rota: '/x' }),
    })
    expect(res.body).toContain('Falhou.')
  })

  // Line 121 — DELETE com erro não-Error
  it('DELETE /:id usa mensagem fallback quando excluir lança valor não-Error', async () => {
    excluirFixoMock.mockRejectedValue('string crua')
    const res = await app.inject({ method: 'DELETE', url: '/r1' })
    expect(res.statusCode).toBe(400)
    expect(res.body).toBe('Erro ao excluir.')
  })
})
