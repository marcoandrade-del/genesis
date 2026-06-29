import { describe, it, expect, beforeEach, vi } from 'vitest'

const { buscarAnoMock, dotListarMock, prevListarMock, saldoCalcularMock, execucaoCalcularMock, execMensalMock, execLancMock } = vi.hoisted(() => ({
  buscarAnoMock: vi.fn(),
  dotListarMock: vi.fn(),
  prevListarMock: vi.fn(),
  saldoCalcularMock: vi.fn(),
  execucaoCalcularMock: vi.fn(),
  execMensalMock: vi.fn(),
  execLancMock: vi.fn(),
}))

vi.mock('../../services/orcamentos.js', () => ({
  OrcamentosService: class {
    buscarPorEntidadeAno = buscarAnoMock
  },
}))
vi.mock('../../services/dotacoes-despesa.js', () => ({
  DotacoesDespesaService: class {
    listar = dotListarMock
  },
}))
vi.mock('../../services/previsoes-receita.js', () => ({
  PrevisoesReceitaService: class {
    listar = prevListarMock
  },
}))
vi.mock('../../services/saldo-orcamentario.js', () => ({
  SaldoOrcamentarioService: class {
    calcular = saldoCalcularMock
  },
}))
vi.mock('../../services/execucao-despesa.js', () => ({
  ExecucaoDespesaService: class {
    calcular = execucaoCalcularMock
    mensal = execMensalMock
    lancamentos = execLancMock
  },
}))

import { criarApp } from '../../routes/__tests__/helpers/criarApp.js'
import { appOrcamentoRoutes } from '../orcamento.js'
import type { FastifyInstance } from 'fastify'
import type { PrismaMock } from '../../services/__tests__/helpers/prisma-mock.js'

const ENTIDADE = { id: 'ent1', nome: 'Prefeitura', municipio: { nome: 'Curitiba', estado: { sigla: 'PR', nome: 'Paraná' } } }
const DOTACAO = {
  valorAutorizado: '1000', unidadeOrcamentaria: { codigo: '02.001' }, funcao: { codigo: '04' }, subfuncao: { codigo: '122' },
  programa: { codigo: '0001' }, acao: { codigo: '2001' }, contaDespesa: { codigo: '3.3.90.30' }, fonteRecurso: { codigo: '500' },
}
const PREVISAO = { valorPrevisto: '1000', contaReceita: { codigo: '1.1.1', descricao: 'IPTU' }, fonteRecurso: { codigo: '500' } }

async function montar(contexto = { entidadeId: 'ent1', ano: 2026, nivel: 'ESCRITA' as const }) {
  return criarApp({ registrar: appOrcamentoRoutes, comView: true, simularUsuario: { sub: 'u1', email: 'u@x.com' }, simularContexto: contexto })
}

describe('appOrcamentoRoutes', () => {
  let app: FastifyInstance
  let prisma: PrismaMock

  beforeEach(async () => {
    ;[buscarAnoMock, dotListarMock, prevListarMock, saldoCalcularMock, execucaoCalcularMock, execMensalMock, execLancMock].forEach((m) => m.mockReset())
    ;({ app, prisma } = await montar())
  })

  it('usa entidade+ano do req.contexto (sem query string)', async () => {
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    buscarAnoMock.mockResolvedValue({ id: 'o1', status: 'EM_EXECUCAO' })
    dotListarMock.mockResolvedValue([DOTACAO])
    prevListarMock.mockResolvedValue([PREVISAO])
    const res = await app.inject({ method: 'GET', url: '/orcamento' })
    expect(res.statusCode).toBe(200)
    expect(buscarAnoMock).toHaveBeenCalledWith('ent1', 2026)
    expect(res.body).toContain('Orçamento (LOA)')
    expect(res.body).toContain('3.3.90.30')
    expect(res.body).toContain('IPTU')
    expect(res.body).toContain('Em Execução')
  })

  it('mostra estado vazio quando não há orçamento no exercício', async () => {
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    buscarAnoMock.mockResolvedValue(null)
    const res = await app.inject({ method: 'GET', url: '/orcamento' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('Não há orçamento cadastrado')
    expect(dotListarMock).not.toHaveBeenCalled()
  })

  it('redireciona para /app/contexto se a entidade não existe mais', async () => {
    prisma.entidade.findUnique.mockResolvedValue(null)
    const res = await app.inject({ method: 'GET', url: '/orcamento' })
    expect(res.statusCode).toBe(302)
    expect(res.headers.location).toBe('/app/contexto')
  })

  it('respeita um ano diferente no contexto', async () => {
    ;({ app, prisma } = await montar({ entidadeId: 'ent9', ano: 2024, nivel: 'LEITURA' }))
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    buscarAnoMock.mockResolvedValue(null)
    await app.inject({ method: 'GET', url: '/orcamento' })
    expect(buscarAnoMock).toHaveBeenCalledWith('ent9', 2024)
  })

  it('GET /orcamento/saldo renderiza o saldo do contexto', async () => {
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    saldoCalcularMock.mockResolvedValue({
      temOrcamento: true,
      resumo: { autorizado: 1800, reservado: 100, empenhado: 250, disponivel: 1450 },
      porUnidade: [{ id: 'u1', codigo: '02.001', rotulo: 'Saúde', nivel: 1, autorizado: 1500, reservado: 100, empenhado: 250, disponivel: 1150 }],
      porFonte: [], porFuncao: [],
      porConta: [{ id: 'c3', codigo: '3.1.90', rotulo: 'Vencimentos', nivel: 3, autorizado: 1000, reservado: 100, empenhado: 200, disponivel: 700 }],
    })
    const res = await app.inject({ method: 'GET', url: '/orcamento/saldo' })
    expect(res.statusCode).toBe(200)
    expect(saldoCalcularMock).toHaveBeenCalledWith('ent1', 2026, undefined) // sem ?data= → posição atual
    expect(res.body).toContain('Saldo Orçamentário')
    expect(res.body).toContain('Por Unidade Orçamentária')
    expect(res.body).toContain('Vencimentos')
    expect(res.body).toContain('1.450,00')
    expect(res.body).toContain('Posição em') // seletor de data presente
    // PR E: colapsar por nível + filtro de texto por conta na tabela de saldo
    expect(res.body).toContain('filtrar conta')
    expect(res.body).toContain('data-nivel="3"')
  })

  it('GET /orcamento/despesa/execucao renderiza a árvore de dotações (codificação completa)', async () => {
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    execucaoCalcularMock.mockResolvedValue({
      temOrcamento: true,
      resumo: { autorizado: 1000, empenhado: 500, liquidado: 400, pago: 300 },
      totalDotacoes: 1,
      dotacoes: [
        { path: '02.001', parentPath: '', nivel: 1, uo: '02.001', funcaoSubf: '', programaAcao: '', natureza: '', fonte: '', rotulo: 'Chefia', temFilhos: true, autorizado: 1000, empenhado: 500, aEmpenhar: 500, liquidado: 400, aLiquidar: 100, pago: 300, aPagar: 100 },
        { path: '02.001|04.122|0001.2001|3.3.90.30#100', parentPath: '02.001|04.122|0001.2001', nivel: 4, uo: '', funcaoSubf: '', programaAcao: '', natureza: '3.3.90.30', fonte: '100', rotulo: 'Material', temFilhos: false, autorizado: 1000, empenhado: 500, aEmpenhar: 500, liquidado: 400, aLiquidar: 100, pago: 300, aPagar: 100 },
      ],
    })
    const res = await app.inject({ method: 'GET', url: '/orcamento/despesa/execucao' })
    expect(res.statusCode).toBe(200)
    expect(execucaoCalcularMock).toHaveBeenCalledWith('ent1', 2026, undefined)
    expect(res.body).toContain('Execução da Despesa')
    expect(res.body).toContain('Dotações de despesa')
    expect(res.body).toContain('Unid. Orç.')
    expect(res.body).toContain('a empenhar') // sub-rótulo das colunas (2 linhas)
    expect(res.body).toContain('3.3.90.30') // natureza da folha
    expect(res.body).toContain('toggleExecRow') // desdobrar por linha
    expect(res.body).toContain('Posição em') // seletor de data
  })

  it('GET /orcamento/despesa/execucao?data= calcula a posição até a data', async () => {
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    execucaoCalcularMock.mockResolvedValue({ temOrcamento: true, resumo: { autorizado: 0, empenhado: 0, liquidado: 0, pago: 0 }, dotacoes: [], totalDotacoes: 0 })
    const res = await app.inject({ method: 'GET', url: '/orcamento/despesa/execucao?data=2026-03-15' })
    expect(res.statusCode).toBe(200)
    const arg = execucaoCalcularMock.mock.calls.at(-1)
    expect((arg?.[2] as Date).toISOString()).toContain('2026-03')
  })

  it('GET /orcamento/despesa/execucao/mensal?path= devolve a série mensal do nó (JSON)', async () => {
    execMensalMock.mockResolvedValue({ empenhadoMensal: [500], liquidadoMensal: [0], pagoMensal: [0] })
    const res = await app.inject({ method: 'GET', url: '/orcamento/despesa/execucao/mensal?path=02.001' })
    expect(res.statusCode).toBe(200)
    expect(res.json().empenhadoMensal[0]).toBe(500)
    expect(execMensalMock).toHaveBeenCalledWith('ent1', 2026, '02.001')
  })

  it('GET /orcamento/despesa/execucao/mensal sem path → 400; nó inexistente → 404', async () => {
    expect((await app.inject({ method: 'GET', url: '/orcamento/despesa/execucao/mensal' })).statusCode).toBe(400)
    execMensalMock.mockResolvedValue(null)
    expect((await app.inject({ method: 'GET', url: '/orcamento/despesa/execucao/mensal?path=x' })).statusCode).toBe(404)
  })

  it('GET /orcamento/despesa/execucao/:dotacaoId/lancamentos renderiza o ledger', async () => {
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    execLancMock.mockResolvedValue({
      dotacao: { codigo: '02.001 · 04 · 3.3.90.30', natureza: 'Material', orgao: 'Chefia', fonte: '100 - Tesouro' },
      movimentos: [{ data: new Date(Date.UTC(2026, 2, 10)), tipo: 'EMPENHO', valor: 600, documento: 'Emp 123' }],
    })
    const res = await app.inject({ method: 'GET', url: '/orcamento/despesa/execucao/d1/lancamentos' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('Material')
    expect(res.body).toContain('Empenho')
    expect(res.body).toContain('Emp 123')
    expect(execLancMock).toHaveBeenCalledWith('ent1', 'd1')
  })

  it('GET …/lancamentos 404 quando a dotação não é da entidade', async () => {
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    execLancMock.mockResolvedValue(null)
    const res = await app.inject({ method: 'GET', url: '/orcamento/despesa/execucao/x/lancamentos' })
    expect(res.statusCode).toBe(404)
  })

  it('GET /orcamento/saldo?data= calcula a posição até a data', async () => {
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    saldoCalcularMock.mockResolvedValue({
      temOrcamento: true,
      resumo: { autorizado: 1800, reservado: 0, empenhado: 250, disponivel: 1550 },
      porUnidade: [], porFonte: [], porFuncao: [], porConta: [],
    })
    const res = await app.inject({ method: 'GET', url: '/orcamento/saldo?data=2026-03-15' })
    expect(res.statusCode).toBe(200)
    const arg = saldoCalcularMock.mock.calls.at(-1)
    expect(arg?.[2]).toBeInstanceOf(Date)
    expect((arg?.[2] as Date).toISOString()).toContain('2026-03')
    expect(res.body).toContain('posição em') // badge da posição
  })

  it('GET /orcamento/despesa/diario aplica filtros de período e conta', async () => {
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    prisma.orcamento.findUnique.mockResolvedValue({ id: 'o1' })
    prisma.dotacaoDespesa.aggregate.mockResolvedValue({ _sum: { valorAutorizado: null } })
    prisma.movimentoEmpenho.groupBy.mockResolvedValue([])
    prisma.contaDespesaEntidade.findMany.mockResolvedValue([{ id: 'd1', codigo: '3.1.90', descricao: 'Pessoal' }])
    const res = await app.inject({
      method: 'GET',
      url: '/orcamento/despesa/diario?de=2026-02-01&ate=2026-02-28&contas=d1',
    })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('Pessoal') // opção da conta no seletor
    const where = prisma.movimentoEmpenho.groupBy.mock.calls[0]![0].where
    expect(where.empenho.dotacaoDespesa.contaDespesaEntidadeId).toEqual({ in: ['d1'] })
    expect(where.data).toEqual({ gte: expect.any(Date), lte: expect.any(Date) })
  })

  it('GET /orcamento/saldo redireciona se a entidade sumiu', async () => {
    prisma.entidade.findUnique.mockResolvedValue(null)
    const res = await app.inject({ method: 'GET', url: '/orcamento/saldo' })
    expect(res.statusCode).toBe(302)
    expect(res.headers.location).toBe('/app/contexto')
    expect(saldoCalcularMock).not.toHaveBeenCalled()
  })

  it('GET /orcamento/saldo mostra vazio quando não há orçamento', async () => {
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    saldoCalcularMock.mockResolvedValue({
      temOrcamento: false,
      resumo: { autorizado: 0, reservado: 0, empenhado: 0, disponivel: 0 },
      porUnidade: [], porFonte: [], porFuncao: [], porConta: [],
    })
    const res = await app.inject({ method: 'GET', url: '/orcamento/saldo' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('Não há orçamento')
  })
})
