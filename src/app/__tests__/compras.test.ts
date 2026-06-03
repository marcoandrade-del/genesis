import { describe, it, expect, beforeEach, vi } from 'vitest'

const { catalogoContar, catalogoPaginado, pcaListar, pcaBuscar, dodListar, reservaListar } = vi.hoisted(() => ({
  catalogoContar: vi.fn(),
  catalogoPaginado: vi.fn(),
  pcaListar: vi.fn(),
  pcaBuscar: vi.fn(),
  dodListar: vi.fn(),
  reservaListar: vi.fn(),
}))

vi.mock('../../services/itens-catalogo.js', () => ({
  ItensCatalogoService: class {
    contar = catalogoContar
    listarPaginado = catalogoPaginado
  },
}))
vi.mock('../../services/planos-contratacao.js', () => ({
  PlanosContratacaoService: class {
    listar = pcaListar
    buscarPorId = pcaBuscar
  },
}))
vi.mock('../../services/documentos-demanda.js', () => ({
  DocumentosDemandaService: class {
    listar = dodListar
  },
}))
vi.mock('../../services/reservas-dotacao.js', () => ({
  ReservasDotacaoService: class {
    listar = reservaListar
  },
}))

import { criarApp } from '../../routes/__tests__/helpers/criarApp.js'
import { appComprasRoutes } from '../compras.js'
import type { FastifyInstance } from 'fastify'
import type { PrismaMock } from '../../services/__tests__/helpers/prisma-mock.js'

const ENTIDADE = { id: 'ent1', nome: 'Prefeitura', municipio: { nome: 'Curitiba', estado: { sigla: 'PR', nome: 'Paraná' } } }
const ITEM = { id: 'i1', tipo: 'MATERIAL', codigo: 'CAT-123', descricao: 'Caneta esferográfica', unidadeMedida: 'UN', ativo: true }
const PCA_2026 = { id: 'p1', ano: 2026, status: 'APROVADO', _count: { itens: 2, demandas: 1 } }
const PCA_DETALHE = {
  id: 'p1', ano: 2026, status: 'APROVADO', observacoes: null,
  itens: [{ itemCatalogo: { codigo: 'CAT-123', descricao: 'Caneta esferográfica' }, quantidadeEstimada: '10', valorUnitarioEstimado: '2.50' }],
}
const DOD_2026 = { id: 'd1', ano: 2026, numero: '1/2026', unidadeOrcamentaria: { codigo: '02.001', nome: 'Secretaria de Saúde' }, status: 'APROVADA', _count: { itens: 3 }, termoReferencia: { id: 'tr1' } }
const DOD_2025 = { id: 'd0', ano: 2025, numero: '9/2025', unidadeOrcamentaria: { codigo: '02.001', nome: 'Secretaria de Saúde' }, status: 'RASCUNHO', _count: { itens: 1 }, termoReferencia: null }
const RESERVA = {
  id: 'r1', numero: 'RES-1', valor: '500.00', status: 'ATIVA', data: '2026-03-01T00:00:00.000Z',
  dotacaoDespesa: { unidadeOrcamentaria: { codigo: '02.001' }, contaDespesa: { codigo: '3.3.90.30' }, fonteRecurso: { codigo: '500' } },
  termoReferencia: { id: 'tr1', objeto: 'Material de escritório' },
}
const pagina = (itens: unknown[], extra = {}) => ({ itens, total: itens.length, pagina: 1, porPagina: 50, totalPaginas: 1, ...extra })

async function montar(contexto = { entidadeId: 'ent1', ano: 2026, nivel: 'ESCRITA' as const }) {
  return criarApp({ registrar: appComprasRoutes, comView: true, simularUsuario: { sub: 'u1', email: 'u@x.com' }, simularContexto: contexto })
}

describe('appComprasRoutes (operador, read-only)', () => {
  let app: FastifyInstance
  let prisma: PrismaMock

  beforeEach(async () => {
    ;[catalogoContar, catalogoPaginado, pcaListar, pcaBuscar, dodListar, reservaListar].forEach((m) => m.mockReset())
    catalogoContar.mockResolvedValue(0)
    catalogoPaginado.mockResolvedValue(pagina([]))
    pcaListar.mockResolvedValue([])
    dodListar.mockResolvedValue([])
    reservaListar.mockResolvedValue([])
    ;({ app, prisma } = await montar())
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
  })

  it('hub conta catálogo ativo (sem carregar linhas) e usa entidade do contexto', async () => {
    catalogoContar.mockResolvedValue(162919)
    pcaListar.mockResolvedValue([PCA_2026])
    dodListar.mockResolvedValue([DOD_2026])
    reservaListar.mockResolvedValue([RESERVA])
    const res = await app.inject({ method: 'GET', url: '/compras' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('Compras — Planejamento')
    expect(catalogoContar).toHaveBeenCalledWith({ apenasAtivos: true })
    expect(pcaListar).toHaveBeenCalledWith('ent1')
    expect(reservaListar).toHaveBeenCalledWith('ent1')
    expect(res.body).toContain('Somente leitura')
  })

  it('catálogo: lista paginada de ativos', async () => {
    catalogoPaginado.mockResolvedValue(pagina([ITEM]))
    const res = await app.inject({ method: 'GET', url: '/compras/catalogo' })
    expect(res.statusCode).toBe(200)
    expect(catalogoPaginado).toHaveBeenCalledWith({ apenasAtivos: true, busca: '', pagina: 1, porPagina: 50 })
    expect(res.body).toContain('Caneta esferográfica')
    expect(res.body).toContain('Material')
  })

  it('catálogo: repassa busca e página da querystring', async () => {
    catalogoPaginado.mockResolvedValue(pagina([ITEM], { total: 120, pagina: 2, totalPaginas: 3 }))
    const res = await app.inject({ method: 'GET', url: '/compras/catalogo?q=caneta&pagina=2' })
    expect(res.statusCode).toBe(200)
    expect(catalogoPaginado).toHaveBeenCalledWith({ apenasAtivos: true, busca: 'caneta', pagina: 2, porPagina: 50 })
    expect(res.body).toContain('Página 2 de 3')
    expect(res.body).toContain('caneta')
  })

  it('PCA do exercício: carrega detalhe quando existe no ano do contexto', async () => {
    pcaListar.mockResolvedValue([PCA_2026])
    pcaBuscar.mockResolvedValue(PCA_DETALHE)
    const res = await app.inject({ method: 'GET', url: '/compras/pca' })
    expect(res.statusCode).toBe(200)
    expect(pcaBuscar).toHaveBeenCalledWith('p1')
    expect(res.body).toContain('Caneta esferográfica')
    expect(res.body).toContain('Aprovado')
  })

  it('PCA: mostra vazio e NÃO busca detalhe quando não há PCA no ano do contexto', async () => {
    pcaListar.mockResolvedValue([{ ...PCA_2026, ano: 2025 }])
    const res = await app.inject({ method: 'GET', url: '/compras/pca' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('Não há PCA cadastrado')
    expect(pcaBuscar).not.toHaveBeenCalled()
  })

  it('demandas: filtra ao ano do contexto', async () => {
    dodListar.mockResolvedValue([DOD_2026, DOD_2025])
    const res = await app.inject({ method: 'GET', url: '/compras/demandas' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('1/2026')
    expect(res.body).not.toContain('9/2025')
  })

  it('reservas lista as da entidade', async () => {
    reservaListar.mockResolvedValue([RESERVA])
    const res = await app.inject({ method: 'GET', url: '/compras/reservas' })
    expect(res.statusCode).toBe(200)
    expect(reservaListar).toHaveBeenCalledWith('ent1')
    expect(res.body).toContain('RES-1')
    expect(res.body).toContain('3.3.90.30')
    expect(res.body).toContain('Ativa')
  })

  it('respeita um ano diferente no contexto (filtro de demandas)', async () => {
    ;({ app, prisma } = await montar({ entidadeId: 'ent9', ano: 2025, nivel: 'LEITURA' }))
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    dodListar.mockResolvedValue([DOD_2026, DOD_2025])
    const res = await app.inject({ method: 'GET', url: '/compras/demandas' })
    expect(res.statusCode).toBe(200)
    expect(dodListar).toHaveBeenCalledWith('ent9')
    expect(res.body).toContain('9/2025')
    expect(res.body).not.toContain('1/2026')
  })

  it('redireciona para /app/contexto se a entidade do contexto sumiu', async () => {
    prisma.entidade.findUnique.mockResolvedValue(null)
    const res = await app.inject({ method: 'GET', url: '/compras' })
    expect(res.statusCode).toBe(302)
    expect(res.headers.location).toBe('/app/contexto')
  })
})
