import { describe, it, expect, beforeEach, vi } from 'vitest'

const m = vi.hoisted(() => ({ listar: vi.fn(), criar: vi.fn(), excluir: vi.fn(), trilha: vi.fn(), prevListar: vi.fn() }))

vi.mock('../../services/lancamento-tributario.js', () => ({
  LancamentoTributarioService: class {
    listar = m.listar
    criar = m.criar
    excluir = m.excluir
    trilhaDoLancamento = m.trilha
  },
}))
vi.mock('../../services/previsoes-receita.js', () => ({
  PrevisoesReceitaService: class {
    listar = m.prevListar
  },
}))

import { criarApp } from '../../routes/__tests__/helpers/criarApp.js'
import { appLancamentoTributarioRoutes } from '../lancamento-tributario.js'
import type { FastifyInstance } from 'fastify'
import type { PrismaMock } from '../../services/__tests__/helpers/prisma-mock.js'

const ENTIDADE = { id: 'ent1', nome: 'Prefeitura', municipio: { nome: 'Maringá', estado: { sigla: 'PR', nome: 'Paraná' } } }
const ORC = { id: 'o1', entidadeId: 'ent1', ano: 2026, status: 'EM_EXECUCAO' }
const PREV = { id: 'p1', contaReceita: { codigo: '1.1.1.2.50.0.1', descricao: 'IPTU' }, fonteRecurso: { codigo: '1000' } }
const PREV_NAO_TRIB = { id: 'p2', contaReceita: { codigo: '1.3.2.1', descricao: 'Rendimentos' }, fonteRecurso: { codigo: '1000' } }
const LANC = { id: 'lt1', data: '2026-06-10T00:00:00Z', valor: '500', vencimento: null, devedorNome: 'Fulano', devedorDocumento: null, previsao: { contaReceita: { codigo: '1.1.1.2.50.0.1', descricao: 'IPTU' }, fonteRecurso: { codigo: '1000' } } }
const form = (o: Record<string, string>) => Object.entries(o).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')
const POST = (url: string, body: Record<string, string>) => ({ method: 'POST' as const, url, payload: form(body), headers: { 'content-type': 'application/x-www-form-urlencoded' } })

async function montar(contexto = { entidadeId: 'ent1', ano: 2026, nivel: 'ESCRITA' as const }) {
  return criarApp({ registrar: appLancamentoTributarioRoutes, comView: true, simularUsuario: { sub: 'u1', email: 'u@x.com' }, simularContexto: contexto })
}

describe('appLancamentoTributarioRoutes', () => {
  let app: FastifyInstance
  let prisma: PrismaMock
  beforeEach(async () => {
    Object.values(m).forEach((fn) => fn.mockReset())
    m.listar.mockResolvedValue([LANC])
    m.prevListar.mockResolvedValue([PREV, PREV_NAO_TRIB])
    ;({ app, prisma } = await montar())
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    prisma.orcamento.findUnique.mockResolvedValue(ORC)
  })

  it('GET mostra o form (só naturezas tributárias) e a lista', async () => {
    const res = await app.inject({ method: 'GET', url: '/orcamento/lancamento-tributario' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('Constituir crédito')
    expect(res.body).toContain('1.1.1.2.50.0.1') // tributária no select
    expect(res.body).not.toContain('1.3.2.1') // não-tributária filtrada do select
    expect(res.body).toContain('Fulano') // lançamento na lista
  })

  it('POST constitui o crédito e redireciona', async () => {
    m.criar.mockResolvedValue({ id: 'lt1' })
    const res = await app.inject(POST('/orcamento/lancamento-tributario', { previsaoId: 'p1', data: '2026-06-10', valor: '500' }))
    expect(res.statusCode).toBe(302)
    expect(m.criar).toHaveBeenCalledWith('o1', expect.objectContaining({ previsaoId: 'p1', valor: '500', criadoPorId: 'u1' }))
  })

  it('POST excluir reverte e redireciona', async () => {
    const res = await app.inject(POST('/orcamento/lancamento-tributario/lt1/excluir', {}))
    expect(res.statusCode).toBe(302)
    expect(m.excluir).toHaveBeenCalledWith('lt1', 'ent1')
  })

  it('GET trilha mostra os lançamentos contábeis', async () => {
    m.trilha.mockResolvedValue({
      lancamento: { data: '2026-06-10T00:00:00Z', valor: '500', vencimento: null, devedorNome: null, devedorDocumento: null, previsao: { contaReceita: { codigo: '1.1.1.2.50.0.1', descricao: 'IPTU' }, fonteRecurso: { codigo: '1000', nomenclatura: 'Livres' } } },
      eventos: [{ eventoCodigo: '550', historico: 'Lançamento', itens: [{ tipo: 'DEBITO', valor: '500', naturezaReceitaCodigo: '1.1.1.2.50.0.1', conta: { codigo: '1.1.2.1.1.01.05', descricao: 'IPTU' } }] }],
    })
    const res = await app.inject({ method: 'GET', url: '/orcamento/lancamento-tributario/lt1/lancamentos' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('E550')
    expect(res.body).toContain('1.1.2.1.1.01.05')
  })

  it('LEITURA não pode lançar (403)', async () => {
    ;({ app, prisma } = await montar({ entidadeId: 'ent1', ano: 2026, nivel: 'LEITURA' }))
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    prisma.orcamento.findUnique.mockResolvedValue(ORC)
    const res = await app.inject(POST('/orcamento/lancamento-tributario', { previsaoId: 'p1', data: '2026-06-10', valor: '500' }))
    expect(res.statusCode).toBe(403)
    expect(m.criar).not.toHaveBeenCalled()
  })
})
