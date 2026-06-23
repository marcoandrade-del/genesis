import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Prisma } from '@prisma/client'

const m = vi.hoisted(() => ({ serie: vi.fn() }))
vi.mock('../../services/arrecadacao-diaria.js', () => ({ ArrecadacaoDiariaService: class { serie = m.serie } }))

import { criarApp } from '../../routes/__tests__/helpers/criarApp.js'
import { appArrecadacaoRoutes } from '../arrecadacao.js'
import type { FastifyInstance } from 'fastify'
import type { PrismaMock } from '../../services/__tests__/helpers/prisma-mock.js'

const dec = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v)
const ENTIDADE = { id: 'ent1', nome: 'Prefeitura', municipio: { nome: 'Curitiba', estado: { sigla: 'PR', nome: 'Paraná' } } }

async function montar() {
  return criarApp({
    registrar: appArrecadacaoRoutes,
    comView: true,
    simularUsuario: { sub: 'u1', email: 'u@x.com' },
    simularContexto: { entidadeId: 'ent1', ano: 2026, nivel: 'LEITURA' as const },
  })
}

describe('GET /orcamento/arrecadacao/diario', () => {
  let app: FastifyInstance
  let prisma: PrismaMock
  beforeEach(async () => {
    m.serie.mockReset().mockResolvedValue({
      temOrcamento: true, previstoTotal: dec(1000), arrecadadoTotal: dec(450),
      dias: [{ data: new Date(Date.UTC(2026, 0, 2)), arrecadadoDia: dec(300), arrecadadoAcumulado: dec(300) }],
    })
    ;({ app, prisma } = await montar())
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
  })

  it('renderiza o acumulado diário da receita', async () => {
    const res = await app.inject({ method: 'GET', url: '/orcamento/arrecadacao/diario' })
    expect(res.statusCode).toBe(200)
    expect(m.serie).toHaveBeenCalledWith('ent1', 2026)
    expect(res.body).toContain('acumulado diário')
    expect(res.body).toContain('450')
  })

  it('mostra aviso quando não há orçamento', async () => {
    m.serie.mockResolvedValue({ temOrcamento: false, previstoTotal: dec(0), arrecadadoTotal: dec(0), dias: [] })
    const res = await app.inject({ method: 'GET', url: '/orcamento/arrecadacao/diario' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('Não há orçamento')
  })
})
