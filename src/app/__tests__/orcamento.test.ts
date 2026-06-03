import { describe, it, expect, beforeEach, vi } from 'vitest'

const { buscarAnoMock, dotListarMock, prevListarMock } = vi.hoisted(() => ({
  buscarAnoMock: vi.fn(),
  dotListarMock: vi.fn(),
  prevListarMock: vi.fn(),
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
    ;[buscarAnoMock, dotListarMock, prevListarMock].forEach((m) => m.mockReset())
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
})
