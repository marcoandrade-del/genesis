import { describe, it, expect, beforeEach, vi } from 'vitest'

const m = vi.hoisted(() => ({ calcular: vi.fn() }))
vi.mock('../../services/preview-memoriais.js', () => ({
  PreviewMemoriaisService: class {
    calcular = m.calcular
  },
}))

import { criarApp } from '../../routes/__tests__/helpers/criarApp.js'
import { appMemoriaisBancadaRoutes } from '../memoriais-bancada.js'
import type { FastifyInstance } from 'fastify'
import type { PrismaMock } from '../../services/__tests__/helpers/prisma-mock.js'

describe('appMemoriaisBancadaRoutes (bancada — item restrito)', () => {
  let app: FastifyInstance
  let prisma: PrismaMock

  beforeEach(async () => {
    m.calcular.mockReset()
    ;({ app, prisma } = await criarApp({
      registrar: appMemoriaisBancadaRoutes,
      prefix: '/app',
      simularUsuario: { sub: 'u1', email: 'a@a' },
      comView: true,
    }))
  })

  it('403 no preview sem permissão (poder específico)', async () => {
    prisma.permissaoAcesso.findFirst.mockResolvedValue(null)
    const res = await app.inject({ method: 'POST', url: '/app/memoriais/bancada/preview', payload: { entidadeId: 'e1', ano: 2026 } })
    expect(res.statusCode).toBe(403)
    expect(m.calcular).not.toHaveBeenCalled()
  })

  it('200 preview quando tem permissão', async () => {
    prisma.permissaoAcesso.findFirst.mockResolvedValue({ id: 'p1' })
    m.calcular.mockResolvedValue({ rcl: { proposto: { rcl: 100 } } })
    const res = await app.inject({
      method: 'POST',
      url: '/app/memoriais/bancada/preview',
      payload: { entidadeId: 'e1', ano: 2026, rcl: { nome: 'X', deducoes: [] } },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().rcl.proposto.rcl).toBe(100)
    expect(m.calcular).toHaveBeenCalledWith(expect.objectContaining({ entidadeId: 'e1', ano: 2026 }))
  })

  it('400 sem entidadeId/ano', async () => {
    prisma.permissaoAcesso.findFirst.mockResolvedValue({ id: 'p1' })
    const res = await app.inject({ method: 'POST', url: '/app/memoriais/bancada/preview', payload: { ano: 2026 } })
    expect(res.statusCode).toBe(400)
  })

  it('404 quando a entidade não existe', async () => {
    prisma.permissaoAcesso.findFirst.mockResolvedValue({ id: 'p1' })
    m.calcular.mockResolvedValue(null)
    const res = await app.inject({ method: 'POST', url: '/app/memoriais/bancada/preview', payload: { entidadeId: 'x', ano: 2026 } })
    expect(res.statusCode).toBe(404)
  })

  it('GET renderiza a bancada quando tem permissão', async () => {
    prisma.permissaoAcesso.findFirst.mockResolvedValue({ id: 'p1' })
    prisma.entidade.findMany.mockResolvedValue([{ id: 'e1', nome: 'Pref', municipio: { nome: 'Maringá', estado: { sigla: 'PR' } } }])
    const res = await app.inject({ method: 'GET', url: '/app/memoriais/bancada' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('Memoriais de cálculo')
    expect(res.body).toContain('Maringá')
  })

  it('GET 403 sem permissão', async () => {
    prisma.permissaoAcesso.findFirst.mockResolvedValue(null)
    const res = await app.inject({ method: 'GET', url: '/app/memoriais/bancada' })
    expect(res.statusCode).toBe(403)
  })

  it('naturezas (picker) receita: agrega por código com impacto', async () => {
    prisma.permissaoAcesso.findFirst.mockResolvedValue({ id: 'p1' })
    prisma.previsaoReceita.findMany.mockResolvedValue([
      { valorArrecadado: '100', valorPrevisto: '200', contaReceita: { codigo: '1.1.1', descricao: 'IPTU' } },
      { valorArrecadado: '50', valorPrevisto: '80', contaReceita: { codigo: '1.1.1', descricao: 'IPTU' } },
      { valorArrecadado: '0', valorPrevisto: '30', contaReceita: { codigo: '1.7.5', descricao: 'FUNDEB' } },
    ])
    const res = await app.inject({ method: 'GET', url: '/app/memoriais/bancada/naturezas?entidadeId=e1&ano=2026&tipo=receita' })
    expect(res.statusCode).toBe(200)
    const nat = res.json().naturezas
    expect(nat).toEqual([
      { codigo: '1.1.1', descricao: 'IPTU', valor: 150 }, // 100+50 arrecadado
      { codigo: '1.7.5', descricao: 'FUNDEB', valor: 30 }, // arrecadado 0 → cai no previsto 30
    ])
  })

  it('naturezas despesa usa dotações (autorizado)', async () => {
    prisma.permissaoAcesso.findFirst.mockResolvedValue({ id: 'p1' })
    prisma.dotacaoDespesa.findMany.mockResolvedValue([
      { valorAutorizado: '900', contaDespesa: { codigo: '3.1.90.11', descricao: 'Vencimentos' } },
    ])
    const res = await app.inject({ method: 'GET', url: '/app/memoriais/bancada/naturezas?entidadeId=e1&ano=2026&tipo=despesa' })
    expect(res.statusCode).toBe(200)
    expect(res.json().naturezas[0]).toEqual({ codigo: '3.1.90.11', descricao: 'Vencimentos', valor: 900 })
  })

  it('naturezas 400 com tipo inválido; 403 sem permissão', async () => {
    prisma.permissaoAcesso.findFirst.mockResolvedValue({ id: 'p1' })
    expect((await app.inject({ method: 'GET', url: '/app/memoriais/bancada/naturezas?entidadeId=e1&ano=2026&tipo=x' })).statusCode).toBe(400)
    prisma.permissaoAcesso.findFirst.mockResolvedValue(null)
    expect((await app.inject({ method: 'GET', url: '/app/memoriais/bancada/naturezas?entidadeId=e1&ano=2026&tipo=receita' })).statusCode).toBe(403)
  })
})
