import { describe, it, expect, beforeEach, vi } from 'vitest'

const { listarMock, buscarMock, criarMock, dotListarMock } = vi.hoisted(() => ({
  listarMock: vi.fn(),
  buscarMock: vi.fn(),
  criarMock: vi.fn(),
  dotListarMock: vi.fn(),
}))

vi.mock('../../services/creditos-adicionais.js', () => ({
  CreditosAdicionaisService: class {
    listar = listarMock
    buscarPorId = buscarMock
    criar = criarMock
  },
}))
vi.mock('../../services/dotacoes-despesa.js', () => ({
  DotacoesDespesaService: class {
    listar = dotListarMock
  },
}))

import { criarApp } from '../../routes/__tests__/helpers/criarApp.js'
import { appCreditosAdicionaisRoutes } from '../creditos-adicionais.js'
import { ErroNegocio } from '../../errors.js'
import type { FastifyInstance } from 'fastify'
import type { PrismaMock } from '../../services/__tests__/helpers/prisma-mock.js'

const ENTIDADE = { id: 'ent1', nome: 'Prefeitura', municipio: { nome: 'Curitiba', estado: { sigla: 'PR', nome: 'Paraná' } } }
const ORC = { id: 'o1', entidadeId: 'ent1', ano: 2026, status: 'EM_EXECUCAO' }
const DOTACAO = { id: 'dA', unidadeOrcamentaria: { codigo: '02.001' }, contaDespesa: { codigo: '3.3.90.30' }, fonteRecurso: { codigo: '500' } }

async function montar(contexto = { entidadeId: 'ent1', ano: 2026, nivel: 'ESCRITA' as const }) {
  return criarApp({ registrar: appCreditosAdicionaisRoutes, comView: true, simularUsuario: { sub: 'u1', email: 'u@x.com' }, simularContexto: contexto })
}

describe('appCreditosAdicionaisRoutes', () => {
  let app: FastifyInstance
  let prisma: PrismaMock

  beforeEach(async () => {
    ;[listarMock, buscarMock, criarMock, dotListarMock].forEach((m) => m.mockReset())
    listarMock.mockResolvedValue([])
    dotListarMock.mockResolvedValue([DOTACAO])
    ;({ app, prisma } = await montar())
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    prisma.orcamento.findUnique.mockResolvedValue(ORC)
  })

  it('hub lista créditos do exercício', async () => {
    listarMock.mockResolvedValue([{ id: 'cr1', numero: '1/2026', tipo: 'SUPLEMENTAR', data: '2026-06-01T00:00:00Z', atoLegal: 'Lei 1/2026', valorTotal: '5000', _count: { itens: 2 } }])
    const res = await app.inject({ method: 'GET', url: '/orcamento/creditos' })
    expect(res.statusCode).toBe(200)
    expect(listarMock).toHaveBeenCalledWith('o1')
    expect(res.body).toContain('Créditos Adicionais')
    expect(res.body).toContain('1/2026')
    expect(res.body).toContain('Suplementar')
  })

  it('GET /novo renderiza o form com as dotações (ESCRITA)', async () => {
    const res = await app.inject({ method: 'GET', url: '/orcamento/creditos/novo' })
    expect(res.statusCode).toBe(200)
    expect(dotListarMock).toHaveBeenCalledWith('o1')
    expect(res.body).toContain('Novo Crédito Adicional')
    expect(res.body).toContain('3.3.90.30')
  })

  it('GET /novo bloqueia LEITURA com 403', async () => {
    ;({ app, prisma } = await montar({ entidadeId: 'ent1', ano: 2026, nivel: 'LEITURA' }))
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    prisma.orcamento.findUnique.mockResolvedValue(ORC)
    const res = await app.inject({ method: 'GET', url: '/orcamento/creditos/novo' })
    expect(res.statusCode).toBe(403)
    expect(res.body).toContain('apenas leitura')
    expect(dotListarMock).not.toHaveBeenCalled()
  })

  it('POST cria o crédito e redireciona', async () => {
    criarMock.mockResolvedValue({ id: 'cr1' })
    const res = await app.inject({
      method: 'POST',
      url: '/orcamento/creditos',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'tipo=SUPLEMENTAR&numero=1%2F2026&data=2026-06-01&atoLegal=Lei&dotacaoId=dA&operacao=REFORCO&valor=300',
    })
    expect(res.statusCode).toBe(302)
    expect(res.headers.location).toBe('/app/orcamento/creditos')
    expect(criarMock).toHaveBeenCalledWith('o1', expect.objectContaining({
      tipo: 'SUPLEMENTAR', numero: '1/2026',
      itens: [{ dotacaoId: 'dA', operacao: 'REFORCO', valor: '300' }],
    }))
  })

  it('POST re-renderiza o form com a mensagem em ErroNegocio', async () => {
    criarMock.mockRejectedValue(new ErroNegocio('ENTIDADE_NAO_PROCESSAVEL', 'Saldo insuficiente.'))
    const res = await app.inject({
      method: 'POST',
      url: '/orcamento/creditos',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'tipo=SUPLEMENTAR&numero=1&data=2026-06-01&atoLegal=Lei&dotacaoId=dA&operacao=ANULACAO&valor=99999',
    })
    expect(res.statusCode).toBe(422)
    expect(res.body).toContain('Saldo insuficiente.')
    expect(res.body).toContain('Novo Crédito Adicional')
  })

  it('detalhe carrega o crédito da entidade do contexto', async () => {
    buscarMock.mockResolvedValue({
      id: 'cr1', numero: '1/2026', tipo: 'SUPLEMENTAR', data: '2026-06-01T00:00:00Z', atoLegal: 'Lei 1/2026', justificativa: null, valorTotal: '300',
      orcamento: { entidadeId: 'ent1' },
      itens: [{ operacao: 'REFORCO', valor: '300', dotacaoDespesa: DOTACAO }],
    })
    const res = await app.inject({ method: 'GET', url: '/orcamento/creditos/cr1' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('Itens aplicados')
    expect(res.body).toContain('Reforço')
  })

  it('detalhe 404 quando o crédito é de outra entidade', async () => {
    buscarMock.mockResolvedValue({ id: 'cr1', orcamento: { entidadeId: 'OUTRA' }, itens: [] })
    const res = await app.inject({ method: 'GET', url: '/orcamento/creditos/cr1' })
    expect(res.statusCode).toBe(404)
    expect(res.body).toContain('não encontrado')
  })

  it('redireciona para /app/contexto se a entidade sumiu', async () => {
    prisma.entidade.findUnique.mockResolvedValue(null)
    const res = await app.inject({ method: 'GET', url: '/orcamento/creditos' })
    expect(res.statusCode).toBe(302)
    expect(res.headers.location).toBe('/app/contexto')
  })
})
