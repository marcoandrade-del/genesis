import { describe, it, expect, beforeEach, vi } from 'vitest'

const {
  catalogoContar, catalogoPaginado, pcaListar, pcaBuscar, dodListar, reservaListar,
  fornecedorListar, processoListar, contratoListar, ataListar,
  empenhoListar, liquidacaoListar, ordemListar,
} = vi.hoisted(() => ({
  catalogoContar: vi.fn(),
  catalogoPaginado: vi.fn(),
  pcaListar: vi.fn(),
  pcaBuscar: vi.fn(),
  dodListar: vi.fn(),
  reservaListar: vi.fn(),
  fornecedorListar: vi.fn(),
  processoListar: vi.fn(),
  contratoListar: vi.fn(),
  ataListar: vi.fn(),
  empenhoListar: vi.fn(),
  liquidacaoListar: vi.fn(),
  ordemListar: vi.fn(),
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
vi.mock('../../services/fornecedores.js', () => ({
  FornecedoresService: class {
    listar = fornecedorListar
  },
}))
vi.mock('../../services/processos.js', () => ({
  ProcessosService: class {
    listar = processoListar
  },
}))
vi.mock('../../services/contratos.js', () => ({
  ContratosService: class {
    listar = contratoListar
  },
}))
vi.mock('../../services/atas-registro-preco.js', () => ({
  AtasRegistroPrecoService: class {
    listar = ataListar
  },
}))
vi.mock('../../services/empenhos.js', () => ({
  EmpenhosService: class {
    listar = empenhoListar
  },
}))
vi.mock('../../services/liquidacoes.js', () => ({
  LiquidacoesService: class {
    listar = liquidacaoListar
  },
}))
vi.mock('../../services/ordens-pagamento.js', () => ({
  OrdensPagamentoService: class {
    listar = ordemListar
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

// ── Fixtures Seleção/Execução ──────────────────────────────────────────────
const FORNECEDOR = { id: 'f1', tipoPessoa: 'PJ', cnpj: '12.345.678/0001-90', cpf: null, razaoSocial: 'Papelaria Central LTDA', nomeFantasia: 'PapelCentral', ativo: true }
const PROCESSO = { id: 'pr1', numero: '001', ano: 2026, modalidade: 'PREGAO', criterioJulgamento: 'POR_ITEM', objeto: 'Material de escritório', status: 'ABERTO', _count: { lotes: 2, contratos: 0, atas: 0 } }
const CONTRATO = { id: 'ct1', numero: 'CT-1/2026', objeto: 'Fornecimento de canetas', vigenciaInicio: '2026-01-01T00:00:00.000Z', vigenciaFim: '2026-12-31T00:00:00.000Z', valorTotal: '15000.00', status: 'VIGENTE', fornecedor: { razaoSocial: 'Papelaria Central LTDA' }, _count: { itens: 3 } }
const ATA = { id: 'at1', numero: 'ARP-1/2026', objeto: 'Registro de preços de papel', vigenciaInicio: '2026-01-01T00:00:00.000Z', vigenciaFim: '2026-12-31T00:00:00.000Z', status: 'VIGENTE', fornecedor: { razaoSocial: 'Papelaria Central LTDA' }, _count: { itens: 5 } }
const EMPENHO = {
  id: 'e1', numero: 'EMP-1', tipo: 'ORDINARIO', data: '2026-04-01T00:00:00.000Z', valor: '15000.00', valorLiquidado: '5000.00', status: 'ATIVO',
  fornecedor: { razaoSocial: 'Papelaria Central LTDA' },
  dotacaoDespesa: { unidadeOrcamentaria: { codigo: '02.001' }, contaDespesa: { codigo: '3.3.90.30' }, fonteRecurso: { codigo: '500' } },
  _count: { liquidacoes: 1 },
}
const LIQUIDACAO = { id: 'l1', numero: 'LIQ-1', data: '2026-05-01T00:00:00.000Z', valor: '5000.00', valorPago: '0.00', notaFiscal: 'NF-998', status: 'ATIVA', empenho: { numero: 'EMP-1', fornecedor: { razaoSocial: 'Papelaria Central LTDA' } }, _count: { ordensPagamento: 0 } }
const ORDEM = { id: 'o1', numero: 'OP-1', data: '2026-05-10T00:00:00.000Z', valor: '5000.00', contaBancaria: 'BB 1234-5', status: 'EMITIDA', liquidacao: { numero: 'LIQ-1', empenho: { numero: 'EMP-1' } } }

async function montar(contexto = { entidadeId: 'ent1', ano: 2026, nivel: 'ESCRITA' as const }) {
  return criarApp({ registrar: appComprasRoutes, comView: true, simularUsuario: { sub: 'u1', email: 'u@x.com' }, simularContexto: contexto })
}

describe('appComprasRoutes (operador, read-only)', () => {
  let app: FastifyInstance
  let prisma: PrismaMock

  beforeEach(async () => {
    ;[
      catalogoContar, catalogoPaginado, pcaListar, pcaBuscar, dodListar, reservaListar,
      fornecedorListar, processoListar, contratoListar, ataListar,
      empenhoListar, liquidacaoListar, ordemListar,
    ].forEach((m) => m.mockReset())
    catalogoContar.mockResolvedValue(0)
    catalogoPaginado.mockResolvedValue(pagina([]))
    pcaListar.mockResolvedValue([])
    dodListar.mockResolvedValue([])
    reservaListar.mockResolvedValue([])
    ;[fornecedorListar, processoListar, contratoListar, ataListar, empenhoListar, liquidacaoListar, ordemListar].forEach((m) => m.mockResolvedValue([]))
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
    expect(catalogoContar).toHaveBeenCalledWith({ apenasAtivos: true })
    expect(pcaListar).toHaveBeenCalledWith('ent1')
    expect(reservaListar).toHaveBeenCalledWith('ent1')
    expect(res.body).toContain('Somente leitura')
  })

  it('hub mostra as três fases e usa a entidade do contexto nas listagens', async () => {
    fornecedorListar.mockResolvedValue([FORNECEDOR])
    processoListar.mockResolvedValue([PROCESSO])
    contratoListar.mockResolvedValue([CONTRATO])
    ataListar.mockResolvedValue([ATA])
    empenhoListar.mockResolvedValue([EMPENHO])
    liquidacaoListar.mockResolvedValue([LIQUIDACAO])
    ordemListar.mockResolvedValue([ORDEM])
    const res = await app.inject({ method: 'GET', url: '/compras' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('Planejamento')
    expect(res.body).toContain('Seleção do fornecedor')
    expect(res.body).toContain('Execução financeira')
    // seleção/execução escopadas à entidade do contexto; fornecedores é global (sem arg)
    expect(fornecedorListar).toHaveBeenCalledWith()
    expect(processoListar).toHaveBeenCalledWith('ent1')
    expect(empenhoListar).toHaveBeenCalledWith('ent1')
    expect(ordemListar).toHaveBeenCalledWith('ent1')
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

  // ── Fase 2: Seleção ──────────────────────────────────────────────────────
  it('fornecedores: lista o cadastro global (sem arg de entidade)', async () => {
    fornecedorListar.mockResolvedValue([FORNECEDOR])
    const res = await app.inject({ method: 'GET', url: '/compras/fornecedores' })
    expect(res.statusCode).toBe(200)
    expect(fornecedorListar).toHaveBeenCalledWith()
    expect(res.body).toContain('Papelaria Central LTDA')
    expect(res.body).toContain('12.345.678/0001-90')
    expect(res.body).toContain('Ativo')
  })

  it('processos: lista os da entidade do contexto', async () => {
    processoListar.mockResolvedValue([PROCESSO])
    const res = await app.inject({ method: 'GET', url: '/compras/processos' })
    expect(res.statusCode).toBe(200)
    expect(processoListar).toHaveBeenCalledWith('ent1')
    expect(res.body).toContain('001/2026')
    expect(res.body).toContain('Material de escritório')
    expect(res.body).toContain('Aberto')
  })

  it('contratos: lista os da entidade com fornecedor e valor', async () => {
    contratoListar.mockResolvedValue([CONTRATO])
    const res = await app.inject({ method: 'GET', url: '/compras/contratos' })
    expect(res.statusCode).toBe(200)
    expect(contratoListar).toHaveBeenCalledWith('ent1')
    expect(res.body).toContain('CT-1/2026')
    expect(res.body).toContain('Papelaria Central LTDA')
    expect(res.body).toContain('15.000,00')
    expect(res.body).toContain('Vigente')
  })

  it('atas: lista as da entidade', async () => {
    ataListar.mockResolvedValue([ATA])
    const res = await app.inject({ method: 'GET', url: '/compras/atas' })
    expect(res.statusCode).toBe(200)
    expect(ataListar).toHaveBeenCalledWith('ent1')
    expect(res.body).toContain('ARP-1/2026')
    expect(res.body).toContain('Vigente')
  })

  // ── Fase 3: Execução ─────────────────────────────────────────────────────
  it('empenhos: lista os da entidade com dotação e valores', async () => {
    empenhoListar.mockResolvedValue([EMPENHO])
    const res = await app.inject({ method: 'GET', url: '/compras/empenhos' })
    expect(res.statusCode).toBe(200)
    expect(empenhoListar).toHaveBeenCalledWith('ent1')
    expect(res.body).toContain('EMP-1')
    expect(res.body).toContain('Ordinario')
    expect(res.body).toContain('3.3.90.30')
    expect(res.body).toContain('15.000,00')
    expect(res.body).toContain('Ativo')
  })

  it('liquidações: lista as da entidade com empenho e nota fiscal', async () => {
    liquidacaoListar.mockResolvedValue([LIQUIDACAO])
    const res = await app.inject({ method: 'GET', url: '/compras/liquidacoes' })
    expect(res.statusCode).toBe(200)
    expect(liquidacaoListar).toHaveBeenCalledWith('ent1')
    expect(res.body).toContain('LIQ-1')
    expect(res.body).toContain('EMP-1')
    expect(res.body).toContain('NF-998')
    expect(res.body).toContain('Ativa')
  })

  it('ordens de pagamento: lista as da entidade com liquidação e conta', async () => {
    ordemListar.mockResolvedValue([ORDEM])
    const res = await app.inject({ method: 'GET', url: '/compras/ordens-pagamento' })
    expect(res.statusCode).toBe(200)
    expect(ordemListar).toHaveBeenCalledWith('ent1')
    expect(res.body).toContain('OP-1')
    expect(res.body).toContain('LIQ-1')
    expect(res.body).toContain('BB 1234-5')
    expect(res.body).toContain('Emitida')
  })

  it('escopa as listagens à entidade do contexto (entidade diferente)', async () => {
    ;({ app, prisma } = await montar({ entidadeId: 'ent9', ano: 2025, nivel: 'LEITURA' }))
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    processoListar.mockResolvedValue([PROCESSO])
    const res = await app.inject({ method: 'GET', url: '/compras/processos' })
    expect(res.statusCode).toBe(200)
    expect(processoListar).toHaveBeenCalledWith('ent9')
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
