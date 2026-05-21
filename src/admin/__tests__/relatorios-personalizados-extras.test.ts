import { describe, it, expect, beforeEach, vi } from 'vitest'

const { criarPersonalizadoMock, atualizarPersonalizadoMock, excluirPersonalizadoMock } = vi.hoisted(() => ({
  criarPersonalizadoMock: vi.fn(),
  atualizarPersonalizadoMock: vi.fn(),
  excluirPersonalizadoMock: vi.fn(),
}))

vi.mock('../../services/relatorios.js', () => ({
  RelatoriosService: class {
    criarPersonalizado = criarPersonalizadoMock
    atualizarPersonalizado = atualizarPersonalizadoMock
    excluirPersonalizado = excluirPersonalizadoMock
  },
}))

import { criarApp } from '../../routes/__tests__/helpers/criarApp.js'
import { adminRelatoriosPersonalizadosRoutes } from '../relatorios-personalizados.js'
import type { FastifyInstance } from 'fastify'
import type { PrismaMock } from '../../services/__tests__/helpers/prisma-mock.js'

function form(obj: Record<string, string>) {
  return {
    payload: new URLSearchParams(obj).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  }
}

describe('adminRelatoriosPersonalizadosRoutes — branches restantes', () => {
  let app: FastifyInstance
  let prisma: PrismaMock

  beforeEach(async () => {
    [criarPersonalizadoMock, atualizarPersonalizadoMock, excluirPersonalizadoMock].forEach(m => m.mockReset())
    ;({ app, prisma } = await criarApp({
      registrar: adminRelatoriosPersonalizadosRoutes,
      comView: true,
      simularAdmin: { sub: 'admin1', email: 'admin@x.com' },
    }))
  })

  // Line 76 — POST / com erro não-Error
  it('POST / usa mensagem fallback quando criar lança valor não-Error', async () => {
    criarPersonalizadoMock.mockRejectedValue('string crua')
    const res = await app.inject({
      method: 'POST', url: '/',
      ...form({ usuarioId: 'u1', nome: 'X', descricao: '', configuracao: '{}' }),
    })
    expect(res.body).toContain('Erro ao criar relatório.')
  })

  // Line 94 — recarregarForm com relatório não encontrado
  it('PUT /:id com nome vazio renderiza form mesmo quando relatório não existe', async () => {
    prisma.relatorioPersonalizado.findUnique.mockResolvedValue(null)
    const res = await app.inject({
      method: 'PUT', url: '/rp1',
      ...form({ nome: '', descricao: '', configuracao: '' }),
    })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('O nome é obrigatório.')
  })

  // Line 121 — PUT com erro não-Error
  it('PUT /:id usa mensagem fallback quando atualizar lança valor não-Error', async () => {
    atualizarPersonalizadoMock.mockRejectedValue('string crua')
    prisma.relatorioPersonalizado.findUnique.mockResolvedValue({
      id: 'rp1', nome: 'C', usuarioId: 'u1', usuario: { nomeCompleto: 'Maria' },
    })
    const res = await app.inject({
      method: 'PUT', url: '/rp1',
      ...form({ nome: 'X', descricao: '', configuracao: '{}' }),
    })
    expect(res.body).toContain('Erro ao atualizar relatório.')
  })

  // Line 131 — DELETE com erro não-Error
  it('DELETE /:id usa mensagem fallback quando excluir lança valor não-Error', async () => {
    excluirPersonalizadoMock.mockRejectedValue('string crua')
    const res = await app.inject({ method: 'DELETE', url: '/rp1' })
    expect(res.statusCode).toBe(400)
    expect(res.body).toBe('Erro ao excluir.')
  })
})
