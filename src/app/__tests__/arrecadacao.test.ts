import { describe, it, expect, beforeEach, vi } from 'vitest'

const { listarMock, criarMock, resumoMock, prevListarMock, trilhaMock } = vi.hoisted(() => ({
  listarMock: vi.fn(),
  criarMock: vi.fn(),
  resumoMock: vi.fn(),
  prevListarMock: vi.fn(),
  trilhaMock: vi.fn(),
}))

vi.mock('../../services/arrecadacoes.js', () => ({
  ArrecadacoesService: class {
    listar = listarMock
    criar = criarMock
    resumo = resumoMock
    trilhaDoMovimento = trilhaMock
  },
}))
vi.mock('../../services/contas-bancarias.js', () => ({
  ContasBancariasService: class {
    listar = vi.fn().mockResolvedValue([])
  },
}))
vi.mock('../../services/previsoes-receita.js', () => ({
  PrevisoesReceitaService: class {
    listar = prevListarMock
  },
}))

import { criarApp } from '../../routes/__tests__/helpers/criarApp.js'
import { appArrecadacaoRoutes } from '../arrecadacao.js'
import { ErroNegocio } from '../../errors.js'
import type { FastifyInstance } from 'fastify'
import type { PrismaMock } from '../../services/__tests__/helpers/prisma-mock.js'

const ENTIDADE = { id: 'ent1', nome: 'Prefeitura', municipio: { nome: 'Curitiba', estado: { sigla: 'PR', nome: 'Paraná' } } }
const ORC = { id: 'o1', entidadeId: 'ent1', ano: 2026, status: 'EM_EXECUCAO' }
const RESUMO = {
  temOrcamento: true,
  resumo: { previsto: 1000, arrecadado: 150, saldo: 850 },
  porFonte: [{ id: 'f1', codigo: '500', rotulo: 'Recursos livres', nivel: 0, previsto: 1000, arrecadado: 150, saldo: 850 }],
  porConta: [{ id: 'c1', codigo: '1.1', rotulo: 'Impostos', nivel: 2, previsto: 600, arrecadado: 100, saldo: 500 }],
}
const PREVISAO = {
  id: 'p1',
  contaReceita: { codigo: '1.1.1', descricao: 'IPTU' },
  fonteRecurso: { codigo: '500', nomenclatura: 'Recursos livres' },
}
const MOV = {
  id: 'a1', tipo: 'ARRECADACAO', data: '2026-06-11T00:00:00Z', valor: '150.50', historico: 'IPTU cota única',
  previsao: PREVISAO,
}

const form = (o: Record<string, string>) =>
  Object.entries(o).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')
const POST = (body: Record<string, string>) => ({
  method: 'POST' as const,
  url: '/orcamento/arrecadacao',
  payload: form(body),
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
})
const DADOS = { previsaoId: 'p1', tipo: 'ARRECADACAO', data: '2026-06-11', valor: '150.50', historico: 'IPTU' }

async function montar(contexto = { entidadeId: 'ent1', ano: 2026, nivel: 'ESCRITA' as const }) {
  return criarApp({ registrar: appArrecadacaoRoutes, comView: true, simularUsuario: { sub: 'u1', email: 'u@x.com' }, simularContexto: contexto })
}

describe('appArrecadacaoRoutes', () => {
  let app: FastifyInstance
  let prisma: PrismaMock

  beforeEach(async () => {
    ;[listarMock, criarMock, resumoMock, prevListarMock, trilhaMock].forEach((m) => m.mockReset())
    listarMock.mockResolvedValue([MOV])
    resumoMock.mockResolvedValue(RESUMO)
    prevListarMock.mockResolvedValue([PREVISAO])
    ;({ app, prisma } = await montar())
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    prisma.orcamento.findUnique.mockResolvedValue(ORC)
  })

  it('GET mostra resumo (totais, por fonte, por conta), form e movimentos', async () => {
    const res = await app.inject({ method: 'GET', url: '/orcamento/arrecadacao' })
    expect(res.statusCode).toBe(200)
    expect(resumoMock).toHaveBeenCalledWith('ent1', 2026)
    expect(listarMock).toHaveBeenCalledWith('o1')
    expect(res.body).toContain('Arrecadação da Receita')
    expect(res.body).toContain('Recursos livres') // por fonte
    expect(res.body).toContain('Impostos') // por conta
    expect(res.body).toContain('IPTU cota única') // movimento
    expect(res.body).toContain('Registrar movimento') // form (ESCRITA)
    expect(res.body).toContain('1.1.1') // previsão no select
  })

  it('GET para LEITURA mostra a consulta sem o form', async () => {
    ;({ app, prisma } = await montar({ entidadeId: 'ent1', ano: 2026, nivel: 'LEITURA' }))
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    prisma.orcamento.findUnique.mockResolvedValue(ORC)
    const res = await app.inject({ method: 'GET', url: '/orcamento/arrecadacao' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('Arrecadação da Receita')
    expect(res.body).not.toContain('Registrar movimento')
  })

  it('GET sem orçamento avisa que não há LOA', async () => {
    prisma.orcamento.findUnique.mockResolvedValue(null)
    resumoMock.mockResolvedValue({ ...RESUMO, temOrcamento: false })
    const res = await app.inject({ method: 'GET', url: '/orcamento/arrecadacao' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('Não há orçamento (LOA)')
    expect(listarMock).not.toHaveBeenCalled()
  })

  it('GET redireciona se a entidade sumiu', async () => {
    prisma.entidade.findUnique.mockResolvedValue(null)
    const res = await app.inject({ method: 'GET', url: '/orcamento/arrecadacao' })
    expect(res.statusCode).toBe(302)
    expect(res.headers.location).toBe('/app/contexto')
  })

  it('GET /:id/lancamentos mostra a trilha contábil do movimento', async () => {
    trilhaMock.mockResolvedValue({
      movimento: {
        tipo: 'ARRECADACAO', data: '2026-06-19T00:00:00Z', valor: '100', historico: 'FPM',
        previsao: { contaReceita: { codigo: '1.7', descricao: 'FPM' }, fonteRecurso: { codigo: '1000', nomenclatura: 'Livres' } },
        contaBancaria: null,
      },
      eventos: [
        { eventoCodigo: '100', historico: 'E100', itens: [{ tipo: 'CREDITO', valor: '100', naturezaReceitaCodigo: '1.7', fonteCodigo: null, conta: { codigo: '6.2.1.2', descricao: 'Realizada' } }] },
      ],
    })
    const res = await app.inject({ method: 'GET', url: '/orcamento/arrecadacao/a1/lancamentos' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('Trilha contábil')
    expect(res.body).toContain('E100')
    expect(res.body).toContain('6.2.1.2')
    expect(trilhaMock).toHaveBeenCalledWith('a1', 'ent1')
  })

  it('GET /:id/lancamentos → 404 quando o movimento não é da entidade', async () => {
    trilhaMock.mockRejectedValue(new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'não encontrado'))
    const res = await app.inject({ method: 'GET', url: '/orcamento/arrecadacao/zzz/lancamentos' })
    expect(res.statusCode).toBe(404)
  })

  it('POST registra o movimento e redireciona', async () => {
    criarMock.mockResolvedValue({ id: 'a1' })
    const res = await app.inject(POST(DADOS))
    expect(res.statusCode).toBe(302)
    expect(res.headers.location).toBe('/app/orcamento/arrecadacao')
    expect(criarMock).toHaveBeenCalledWith('o1', { ...DADOS, criadoPorId: 'u1', contaBancariaId: '' })
  })

  it('POST com ErroNegocio reabre a tela com a mensagem e os valores digitados', async () => {
    criarMock.mockRejectedValue(new ErroNegocio('ENTIDADE_NAO_PROCESSAVEL', 'O estorno excede o valor arrecadado desta previsão.'))
    const res = await app.inject(POST({ ...DADOS, tipo: 'ESTORNO' }))
    expect(res.statusCode).toBe(422)
    expect(res.body).toContain('O estorno excede')
    expect(res.body).toContain('150.50') // valor repreenchido
  })

  it('POST bloqueado para LEITURA (403, sem criar)', async () => {
    ;({ app, prisma } = await montar({ entidadeId: 'ent1', ano: 2026, nivel: 'LEITURA' }))
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    prisma.orcamento.findUnique.mockResolvedValue(ORC)
    const res = await app.inject(POST(DADOS))
    expect(res.statusCode).toBe(403)
    expect(res.body).toContain('apenas leitura')
    expect(criarMock).not.toHaveBeenCalled()
  })

  it('POST sem orçamento avisa e não cria', async () => {
    prisma.orcamento.findUnique.mockResolvedValue(null)
    const res = await app.inject(POST(DADOS))
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('Não há orçamento (LOA)')
    expect(criarMock).not.toHaveBeenCalled()
  })

  it('POST sem corpo monta dados vazios (validação fica no service)', async () => {
    criarMock.mockResolvedValue({ id: 'a1' })
    const res = await app.inject({ method: 'POST', url: '/orcamento/arrecadacao' })
    expect(res.statusCode).toBe(302)
    expect(criarMock).toHaveBeenCalledWith('o1', { previsaoId: '', tipo: '', data: '', valor: '', historico: '', criadoPorId: 'u1', contaBancariaId: '' })
  })

  it('POST redireciona se a entidade sumiu; propaga erro inesperado', async () => {
    prisma.entidade.findUnique.mockResolvedValue(null)
    expect((await app.inject(POST(DADOS))).statusCode).toBe(302)
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    criarMock.mockRejectedValue(new Error('boom'))
    expect((await app.inject(POST(DADOS))).statusCode).toBe(500)
  })

  it('GET sem previsões orienta a cadastrar a LOA antes', async () => {
    prevListarMock.mockResolvedValue([])
    const res = await app.inject({ method: 'GET', url: '/orcamento/arrecadacao' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('cadastre-as na LOA')
  })
})
