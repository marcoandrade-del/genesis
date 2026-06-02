import { describe, it, expect, beforeEach, vi } from 'vitest'

const { listarMock, buscarMock, criarMock, atualizarMock, adjItemMock, adjLoteMock, homologarMock, cancelarMock, excluirMock } = vi.hoisted(() => ({
  listarMock: vi.fn(),
  buscarMock: vi.fn(),
  criarMock: vi.fn(),
  atualizarMock: vi.fn(),
  adjItemMock: vi.fn(),
  adjLoteMock: vi.fn(),
  homologarMock: vi.fn(),
  cancelarMock: vi.fn(),
  excluirMock: vi.fn(),
}))

vi.mock('../../services/processos.js', () => ({
  ProcessosService: class {
    listar = listarMock
    buscarPorId = buscarMock
    criar = criarMock
    atualizar = atualizarMock
    adjudicarItem = adjItemMock
    adjudicarLote = adjLoteMock
    homologar = homologarMock
    cancelar = cancelarMock
    excluir = excluirMock
  },
}))

import { criarApp } from '../../routes/__tests__/helpers/criarApp.js'
import { adminProcessosRoutes } from '../processos.js'
import type { FastifyInstance } from 'fastify'
import type { PrismaMock } from '../../services/__tests__/helpers/prisma-mock.js'

const ENTIDADE = { id: 'ent1', nome: 'Pref', municipio: { nome: 'Curitiba', estado: { sigla: 'PR', nome: 'Paraná' } } }
function procFixture(criterio: string) {
  return {
    id: 'p1', entidadeId: 'ent1', numero: 'PE-001', ano: 2026, objeto: 'Material',
    modalidade: 'PREGAO', criterioJulgamento: criterio, status: 'ABERTO', dataAbertura: null, termoReferenciaId: null,
    _count: { lotes: 1, contratos: 0, atas: 0 },
    lotes: [{
      id: 'l1', numero: '1', descricao: null, fornecedorVencedor: null,
      itens: [{ id: 'ip1', precoEstimadoUnitario: '5.00', precoAdjudicadoUnitario: null, fornecedorVencedor: null, itemCatalogo: { codigo: '123', descricao: 'Caneta' } }],
    }],
  }
}
const FORNECEDORES = [{ id: 'f1', razaoSocial: 'ACME', tipoPessoa: 'PJ' }]

function form(obj: Record<string, string>) {
  return { payload: new URLSearchParams(obj).toString(), headers: { 'content-type': 'application/x-www-form-urlencoded' } }
}

describe('adminProcessosRoutes', () => {
  let app: FastifyInstance
  let prisma: PrismaMock

  beforeEach(async () => {
    ;[listarMock, buscarMock, criarMock, atualizarMock, adjItemMock, adjLoteMock, homologarMock, cancelarMock, excluirMock].forEach((m) => m.mockReset())
    ;({ app, prisma } = await criarApp({ registrar: adminProcessosRoutes, comView: true, simularAdmin: { sub: 'a1', email: 'a@x.com' } }))
  })

  it('GET / lista por entidade', async () => {
    prisma.estado.findMany.mockResolvedValue([])
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    listarMock.mockResolvedValue([procFixture('POR_ITEM')])
    const res = await app.inject({ method: 'GET', url: '/?estadoId=e1&municipioId=mun1&entidadeId=ent1' })
    expect(listarMock).toHaveBeenCalledWith('ent1')
    expect(res.body).toContain('PE-001')
    expect(res.body).toContain('Aberto')
  })

  it('GET /form sem entidadeId → 400', async () => {
    const res = await app.inject({ method: 'GET', url: '/form' })
    expect(res.statusCode).toBe(400)
  })

  it('GET /form renderiza', async () => {
    const res = await app.inject({ method: 'GET', url: '/form?entidadeId=ent1' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('Novo Processo')
  })

  it('POST / cria com lotesJson', async () => {
    criarMock.mockResolvedValue({ id: 'p1' })
    const lotesJson = JSON.stringify([{ numero: '1', descricao: '', itens: [{ itemCatalogoId: 'c1', quantidade: '10', precoEstimadoUnitario: '5' }] }])
    const res = await app.inject({
      method: 'POST', url: '/',
      ...form({ entidadeId: 'ent1', ano: '2026', numero: 'PE-001', modalidade: 'PREGAO', criterioJulgamento: 'POR_ITEM', objeto: 'Material', lotesJson }),
    })
    expect(res.statusCode).toBe(204)
    expect(criarMock.mock.calls[0][0]).toBe('ent1')
    expect(criarMock.mock.calls[0][1]).toMatchObject({ ano: 2026, numero: 'PE-001', modalidade: 'PREGAO', criterioJulgamento: 'POR_ITEM' })
    expect(criarMock.mock.calls[0][1].lotes[0].itens[0]).toMatchObject({ itemCatalogoId: 'c1' })
  })

  it('GET /:id/julgar (POR_ITEM) renderiza formulários por item', async () => {
    buscarMock.mockResolvedValue(procFixture('POR_ITEM'))
    prisma.fornecedor.findMany.mockResolvedValue(FORNECEDORES)
    const res = await app.inject({ method: 'GET', url: '/p1/julgar' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('Julgamento')
    expect(res.body).toContain('Por item')
    expect(res.body).toContain('/admin/processos/itens/ip1/adjudicar')
  })

  it('GET /:id/julgar (POR_LOTE) renderiza forms por lote', async () => {
    buscarMock.mockResolvedValue(procFixture('POR_LOTE'))
    prisma.fornecedor.findMany.mockResolvedValue(FORNECEDORES)
    const res = await app.inject({ method: 'GET', url: '/p1/julgar' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('/admin/processos/lotes/l1/adjudicar')
  })

  it('POST /itens/:id/adjudicar chama service e re-renderiza', async () => {
    adjItemMock.mockResolvedValue({ id: 'ip1' })
    buscarMock.mockResolvedValue(procFixture('POR_ITEM'))
    prisma.fornecedor.findMany.mockResolvedValue(FORNECEDORES)
    const res = await app.inject({ method: 'POST', url: '/itens/ip1/adjudicar', ...form({ processoId: 'p1', fornecedorId: 'f1', preco: '5.00' }) })
    expect(res.statusCode).toBe(200)
    expect(adjItemMock).toHaveBeenCalledWith('ip1', 'f1', '5.00')
  })

  it('POST /itens/:id/adjudicar erro (REGRA 3) re-renderiza com mensagem', async () => {
    adjItemMock.mockRejectedValue(new Error('Preço adjudicado excede o estimado'))
    buscarMock.mockResolvedValue(procFixture('POR_ITEM'))
    prisma.fornecedor.findMany.mockResolvedValue(FORNECEDORES)
    const res = await app.inject({ method: 'POST', url: '/itens/ip1/adjudicar', ...form({ processoId: 'p1', fornecedorId: 'f1', preco: '999' }) })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('excede o estimado')
  })

  it('POST /lotes/:id/adjudicar parseia itensJson', async () => {
    adjLoteMock.mockResolvedValue({ id: 'l1' })
    buscarMock.mockResolvedValue(procFixture('POR_LOTE'))
    prisma.fornecedor.findMany.mockResolvedValue(FORNECEDORES)
    const itensJson = JSON.stringify([{ itemProcessoId: 'ip1', precoAdjudicadoUnitario: '4.00' }])
    const res = await app.inject({ method: 'POST', url: '/lotes/l1/adjudicar', ...form({ processoId: 'p1', fornecedorId: 'f1', itensJson }) })
    expect(res.statusCode).toBe(200)
    expect(adjLoteMock).toHaveBeenCalledWith('l1', 'f1', [{ itemProcessoId: 'ip1', precoAdjudicadoUnitario: '4.00' }])
  })

  it('POST /:id/homologar', async () => {
    prisma.processo.findUnique.mockResolvedValue({ entidadeId: 'ent1' })
    homologarMock.mockResolvedValue({ id: 'p1' })
    const res = await app.inject({ method: 'POST', url: '/p1/homologar' })
    expect(res.statusCode).toBe(204)
    expect(homologarMock).toHaveBeenCalledWith('p1')
  })

  it('DELETE /:id erro vira 400', async () => {
    excluirMock.mockRejectedValue(new Error('possui contratos'))
    const res = await app.inject({ method: 'DELETE', url: '/p1' })
    expect(res.statusCode).toBe(400)
  })
})
