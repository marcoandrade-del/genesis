import { describe, it, expect, beforeEach, vi } from 'vitest'

const { listarMock, criarMock, buscarMock, excluirMock } = vi.hoisted(() => ({
  listarMock: vi.fn(), criarMock: vi.fn(), buscarMock: vi.fn(), excluirMock: vi.fn(),
}))

vi.mock('../../services/lancamentos.js', () => ({
  LancamentosService: class {
    listar = listarMock
    criar = criarMock
    buscarPorId = buscarMock
    excluir = excluirMock
  },
}))

import { criarApp } from '../../routes/__tests__/helpers/criarApp.js'
import { appLancamentosRoutes } from '../lancamentos.js'
import type { FastifyInstance } from 'fastify'
import type { PrismaMock } from '../../services/__tests__/helpers/prisma-mock.js'

const ENTIDADE = { id: 'ent1', nome: 'Prefeitura', municipio: { nome: 'Curitiba', estado: { sigla: 'PR', nome: 'Paraná' } } }

async function montar(contexto = { entidadeId: 'ent1', ano: 2026, nivel: 'ESCRITA' as const }) {
  return criarApp({ registrar: appLancamentosRoutes, comView: true, simularUsuario: { sub: 'u1', email: 'u@x.com' }, simularContexto: contexto })
}

describe('appLancamentosRoutes', () => {
  let app: FastifyInstance
  let prisma: PrismaMock

  beforeEach(async () => {
    listarMock.mockReset()
    criarMock.mockReset()
    buscarMock.mockReset()
    excluirMock.mockReset()
    ;({ app, prisma } = await montar())
  })

  it('filtra pelo ano do contexto (1º-jan a 31-dez)', async () => {
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    listarMock.mockResolvedValue([
      { data: new Date('2026-03-10'), historico: 'Empenho material', valor: '150.00' },
      { data: new Date('2026-04-01'), historico: 'Pagamento', valor: '50.00' },
    ])
    const res = await app.inject({ method: 'GET', url: '/lancamentos' })
    expect(res.statusCode).toBe(200)
    expect(listarMock).toHaveBeenCalledWith('ent1', { dataInicio: '2026-01-01', dataFim: '2026-12-31' })
    expect(res.body).toContain('Empenho material')
    expect(res.body).toContain('200,00') // total 150+50 formatado pt-BR
  })

  it('estado vazio quando não há lançamentos', async () => {
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    listarMock.mockResolvedValue([])
    const res = await app.inject({ method: 'GET', url: '/lancamentos' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('Nenhum lançamento')
  })

  it('usa o ano do contexto alternativo', async () => {
    ;({ app, prisma } = await montar({ entidadeId: 'ent9', ano: 2023, nivel: 'LEITURA' }))
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    listarMock.mockResolvedValue([])
    await app.inject({ method: 'GET', url: '/lancamentos' })
    expect(listarMock).toHaveBeenCalledWith('ent9', { dataInicio: '2023-01-01', dataFim: '2023-12-31' })
  })

  it('redireciona para /app/contexto se a entidade sumiu', async () => {
    prisma.entidade.findUnique.mockResolvedValue(null)
    const res = await app.inject({ method: 'GET', url: '/lancamentos' })
    expect(res.statusCode).toBe(302)
    expect(res.headers.location).toBe('/app/contexto')
  })

  it('POST lançar com nível LEITURA → 403', async () => {
    ;({ app, prisma } = await montar({ entidadeId: 'ent1', ano: 2026, nivel: 'LEITURA' }))
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    listarMock.mockResolvedValue([])
    const res = await app.inject({ method: 'POST', url: '/lancamentos', payload: { data: '2026-03-15', historico: 'X', itens: '[]' } })
    expect(res.statusCode).toBe(403)
    expect(criarMock).not.toHaveBeenCalled()
  })

  it('POST lançar resolve códigos→conta e chama criar (302)', async () => {
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    listarMock.mockResolvedValue([])
    prisma.contaContabilEntidade.findMany.mockResolvedValue([
      { id: 'c1', codigo: '1.1.1.01' },
      { id: 'c2', codigo: '2.1.1.01' },
    ])
    criarMock.mockResolvedValue({ id: 'L1' })
    const itens = JSON.stringify([
      { codigo: '1.1.1.01', tipo: 'DEBITO', valor: '100' },
      { codigo: '2.1.1.01', tipo: 'CREDITO', valor: '100' },
    ])
    const res = await app.inject({ method: 'POST', url: '/lancamentos', payload: { data: '2026-03-15', historico: 'Teste', itens } })
    expect(res.statusCode).toBe(302)
    expect(res.headers.location).toBe('/app/lancamentos')
    expect(criarMock).toHaveBeenCalledWith(
      expect.objectContaining({
        entidadeId: 'ent1', data: '2026-03-15', historico: 'Teste', criadoPorId: 'u1',
        itens: [
          { contaId: 'c1', tipo: 'DEBITO', valor: '100' },
          { contaId: 'c2', tipo: 'CREDITO', valor: '100' },
        ],
      }),
    )
  })

  it('POST lançar com código inexistente → erro amigável (400)', async () => {
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    listarMock.mockResolvedValue([])
    prisma.contaContabilEntidade.findMany.mockResolvedValue([])
    const itens = JSON.stringify([
      { codigo: '9.9.9', tipo: 'DEBITO', valor: '100' },
      { codigo: '8.8.8', tipo: 'CREDITO', valor: '100' },
    ])
    const res = await app.inject({ method: 'POST', url: '/lancamentos', payload: { data: '2026-03-15', historico: 'Teste', itens } })
    expect(res.statusCode).toBe(400)
    expect(res.body).toContain('não encontrada neste exercício')
    expect(criarMock).not.toHaveBeenCalled()
  })

  it('POST excluir → chama excluir e redireciona', async () => {
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    listarMock.mockResolvedValue([])
    buscarMock.mockResolvedValue({ id: 'L1', entidadeId: 'ent1' })
    excluirMock.mockResolvedValue(undefined)
    const res = await app.inject({ method: 'POST', url: '/lancamentos/L1/excluir' })
    expect(res.statusCode).toBe(302)
    expect(excluirMock).toHaveBeenCalledWith('L1')
  })

  it('POST excluir lançamento de outra entidade → 404', async () => {
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    listarMock.mockResolvedValue([])
    buscarMock.mockResolvedValue({ id: 'L1', entidadeId: 'OUTRA' })
    const res = await app.inject({ method: 'POST', url: '/lancamentos/L1/excluir' })
    expect(res.statusCode).toBe(404)
    expect(excluirMock).not.toHaveBeenCalled()
  })
})
