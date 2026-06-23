import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Prisma } from '@prisma/client'

const m = vi.hoisted(() => ({ serie: vi.fn() }))
vi.mock('../../services/saldo-diario.js', () => ({ SaldoDiarioService: class { serie = m.serie } }))

import { criarApp } from '../../routes/__tests__/helpers/criarApp.js'
import { appContasRoutes } from '../contas.js'
import type { FastifyInstance } from 'fastify'
import type { PrismaMock } from '../../services/__tests__/helpers/prisma-mock.js'

const dec = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v)
const ENTIDADE = { id: 'ent1', nome: 'Prefeitura', municipio: { nome: 'Curitiba', estado: { sigla: 'PR', nome: 'Paraná' } } }

async function montar() {
  return criarApp({
    registrar: appContasRoutes,
    comView: true,
    simularUsuario: { sub: 'u1', email: 'u@x.com' },
    simularContexto: { entidadeId: 'ent1', ano: 2026, nivel: 'ESCRITA' as const },
  })
}

describe('GET /contas/:id/diario', () => {
  let app: FastifyInstance
  let prisma: PrismaMock
  beforeEach(async () => {
    m.serie.mockReset().mockResolvedValue({
      natureza: 'DEVEDORA', saldoInicial: dec(100), totalDebito: dec(50), totalCredito: dec(30), saldoFinal: dec(120),
      dias: [{ data: new Date(Date.UTC(2026, 0, 2)), debito: dec(50), credito: dec(0), saldoAcumulado: dec(150) }],
    })
    ;({ app, prisma } = await montar())
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
  })

  it('renderiza o acumulado diário da conta', async () => {
    prisma.contaContabilEntidade.findUnique.mockResolvedValue({ id: 'c1', codigo: '1.1.1.1.1.01', descricao: 'Caixa', entidadeId: 'ent1' })
    const res = await app.inject({ method: 'GET', url: '/contas/c1/diario' })
    expect(res.statusCode).toBe(200)
    expect(m.serie).toHaveBeenCalledWith('ent1', 'c1', 2026)
    expect(res.body).toContain('Acumulado diário')
    expect(res.body).toContain('1.1.1.1.1.01')
  })

  it('redireciona ao plano quando a conta é de outra entidade', async () => {
    prisma.contaContabilEntidade.findUnique.mockResolvedValue({ id: 'c1', codigo: 'x', descricao: 'y', entidadeId: 'OUTRA' })
    const res = await app.inject({ method: 'GET', url: '/contas/c1/diario' })
    expect(res.statusCode).toBe(302)
    expect(res.headers.location).toBe('/app/contas')
    expect(m.serie).not.toHaveBeenCalled()
  })
})
