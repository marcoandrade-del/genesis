import { describe, it, expect, beforeEach, vi } from 'vitest'

const {
  orcListarMock,
  orcBuscarMock,
  orcBuscarAnoMock,
  orcCriarMock,
  orcAtualizarMock,
  orcAlterarStatusMock,
  orcExcluirMock,
} = vi.hoisted(() => ({
  orcListarMock: vi.fn(),
  orcBuscarMock: vi.fn(),
  orcBuscarAnoMock: vi.fn(),
  orcCriarMock: vi.fn(),
  orcAtualizarMock: vi.fn(),
  orcAlterarStatusMock: vi.fn(),
  orcExcluirMock: vi.fn(),
}))

const { dotListarMock, dotCriarMock, dotAtualizarMock, dotExcluirMock } = vi.hoisted(() => ({
  dotListarMock: vi.fn(),
  dotCriarMock: vi.fn(),
  dotAtualizarMock: vi.fn(),
  dotExcluirMock: vi.fn(),
}))

const { prevListarMock, prevCriarMock, prevAtualizarMock, prevExcluirMock } = vi.hoisted(() => ({
  prevListarMock: vi.fn(),
  prevCriarMock: vi.fn(),
  prevAtualizarMock: vi.fn(),
  prevExcluirMock: vi.fn(),
}))

vi.mock('../../services/orcamentos.js', () => ({
  OrcamentosService: class {
    listar = orcListarMock
    buscarPorId = orcBuscarMock
    buscarPorEntidadeAno = orcBuscarAnoMock
    criar = orcCriarMock
    atualizar = orcAtualizarMock
    alterarStatus = orcAlterarStatusMock
    excluir = orcExcluirMock
  },
}))
vi.mock('../../services/dotacoes-despesa.js', () => ({
  DotacoesDespesaService: class {
    listar = dotListarMock
    buscarPorId = vi.fn()
    criar = dotCriarMock
    atualizar = dotAtualizarMock
    excluir = dotExcluirMock
  },
}))
vi.mock('../../services/previsoes-receita.js', () => ({
  PrevisoesReceitaService: class {
    listar = prevListarMock
    buscarPorId = vi.fn()
    criar = prevCriarMock
    atualizar = prevAtualizarMock
    excluir = prevExcluirMock
  },
}))

import { criarApp } from '../../routes/__tests__/helpers/criarApp.js'
import { adminOrcamentosRoutes } from '../orcamentos.js'
import type { FastifyInstance } from 'fastify'
import type { PrismaMock } from '../../services/__tests__/helpers/prisma-mock.js'

const ENTIDADE = {
  id: 'ent1',
  nome: 'Prefeitura',
  municipioId: 'mun1',
  municipio: { id: 'mun1', nome: 'Curitiba', estado: { sigla: 'PR', nome: 'Paraná' } },
}

const ORCAMENTO = {
  id: 'o1',
  entidadeId: 'ent1',
  ano: 2026,
  status: 'RASCUNHO',
  leiNumero: 'Lei 1234',
  dataAprovacao: null,
  observacoes: null,
  _count: { dotacoes: 0, previsoes: 0 },
  entidade: ENTIDADE,
}

function form(obj: Record<string, string>) {
  return {
    payload: new URLSearchParams(obj).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  }
}

describe('adminOrcamentosRoutes', () => {
  let app: FastifyInstance
  let prisma: PrismaMock

  beforeEach(async () => {
    ;[
      orcListarMock,
      orcBuscarMock,
      orcBuscarAnoMock,
      orcCriarMock,
      orcAtualizarMock,
      orcAlterarStatusMock,
      orcExcluirMock,
      dotListarMock,
      dotCriarMock,
      dotAtualizarMock,
      dotExcluirMock,
      prevListarMock,
      prevCriarMock,
      prevAtualizarMock,
      prevExcluirMock,
    ].forEach((m) => m.mockReset())
    ;({ app, prisma } = await criarApp({
      registrar: adminOrcamentosRoutes,
      comView: true,
      simularAdmin: { sub: 'a1', email: 'a@x.com' },
    }))
  })

  describe('GET /', () => {
    it('sem filtros mostra picker', async () => {
      prisma.estado.findMany.mockResolvedValue([])
      const res = await app.inject({ method: 'GET', url: '/' })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Selecione estado')
      expect(orcListarMock).not.toHaveBeenCalled()
    })

    it('com estadoId carrega municípios', async () => {
      prisma.estado.findMany.mockResolvedValue([])
      prisma.municipio.findMany.mockResolvedValue([{ id: 'mun1', nome: 'Curitiba' }])
      await app.inject({ method: 'GET', url: '/?estadoId=e1' })
      expect(prisma.municipio.findMany).toHaveBeenCalled()
    })

    it('com municipioId carrega entidades ativas', async () => {
      prisma.estado.findMany.mockResolvedValue([])
      prisma.entidade.findMany.mockResolvedValue([])
      await app.inject({ method: 'GET', url: '/?estadoId=e1&municipioId=mun1' })
      expect(prisma.entidade.findMany).toHaveBeenCalledWith({
        where: { municipioId: 'mun1', ativo: true },
        orderBy: { nome: 'asc' },
        select: { id: true, nome: true },
      })
    })

    it('com entidadeId lista orçamentos', async () => {
      prisma.estado.findMany.mockResolvedValue([])
      prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
      orcListarMock.mockResolvedValue([ORCAMENTO])
      const res = await app.inject({
        method: 'GET',
        url: '/?estadoId=e1&municipioId=mun1&entidadeId=ent1',
      })
      expect(orcListarMock).toHaveBeenCalledWith('ent1')
      expect(res.body).toContain('Rascunho')
      expect(res.body).toContain('Lei 1234')
    })
  })

  describe('GET /form e /:id/form', () => {
    it('GET /form sem entidadeId → 400', async () => {
      const res = await app.inject({ method: 'GET', url: '/form' })
      expect(res.statusCode).toBe(400)
    })

    it('GET /form com entidadeId renderiza', async () => {
      const res = await app.inject({ method: 'GET', url: '/form?entidadeId=ent1' })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Novo Orçamento')
    })

    it('GET /:id/form 404 quando não existe', async () => {
      prisma.orcamento.findUnique.mockResolvedValue(null)
      const res = await app.inject({ method: 'GET', url: '/xx/form' })
      expect(res.statusCode).toBe(404)
    })

    it('GET /:id/form renderiza com dados', async () => {
      prisma.orcamento.findUnique.mockResolvedValue(ORCAMENTO)
      const res = await app.inject({ method: 'GET', url: '/o1/form' })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Editar Orçamento')
    })
  })

  describe('POST /', () => {
    it('400 sem entidadeId', async () => {
      const res = await app.inject({ method: 'POST', url: '/', ...form({ ano: '2026' }) })
      expect(res.statusCode).toBe(400)
    })

    it('cria com sucesso e devolve HX-Redirect', async () => {
      orcCriarMock.mockResolvedValue(ORCAMENTO)
      const res = await app.inject({
        method: 'POST',
        url: '/',
        ...form({ entidadeId: 'ent1', ano: '2026', leiNumero: 'Lei 1', observacoes: 'obs' }),
      })
      expect(res.statusCode).toBe(204)
      expect(res.headers['hx-redirect']).toContain('/admin/orcamentos')
      expect(orcCriarMock).toHaveBeenCalledWith('ent1', 2026, {
        leiNumero: 'Lei 1',
        dataAprovacao: undefined,
        observacoes: 'obs',
      })
    })

    it('re-renderiza form com erro quando service falha', async () => {
      orcCriarMock.mockRejectedValue(new Error('Ano inválido.'))
      const res = await app.inject({
        method: 'POST',
        url: '/',
        ...form({ entidadeId: 'ent1', ano: '2026' }),
      })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Ano inválido.')
    })

    it('re-renderiza com mensagem genérica quando erro não-Error', async () => {
      orcCriarMock.mockRejectedValue('boom')
      const res = await app.inject({
        method: 'POST',
        url: '/',
        ...form({ entidadeId: 'ent1', ano: '2026' }),
      })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Erro ao criar')
    })

    it('aceita ano ausente (NaN repassado ao service)', async () => {
      orcCriarMock.mockRejectedValue(new Error('Ano inválido.'))
      const res = await app.inject({
        method: 'POST',
        url: '/',
        ...form({ entidadeId: 'ent1' }),
      })
      expect(res.statusCode).toBe(200)
      expect(orcCriarMock).toHaveBeenCalled()
      const anoArg = orcCriarMock.mock.calls[0]?.[1] as number
      expect(Number.isNaN(anoArg)).toBe(true)
    })
  })

  describe('PUT /:id', () => {
    it('404 quando não existe', async () => {
      prisma.orcamento.findUnique.mockResolvedValue(null)
      const res = await app.inject({ method: 'PUT', url: '/xx', ...form({}) })
      expect(res.statusCode).toBe(404)
    })

    it('atualiza com sucesso', async () => {
      prisma.orcamento.findUnique.mockResolvedValue(ORCAMENTO)
      orcAtualizarMock.mockResolvedValue(ORCAMENTO)
      const res = await app.inject({
        method: 'PUT',
        url: '/o1',
        ...form({ leiNumero: 'Lei 9', observacoes: '' }),
      })
      expect(res.statusCode).toBe(204)
      expect(res.headers['hx-redirect']).toContain('/admin/orcamentos')
    })

    it('re-renderiza com erro Error', async () => {
      prisma.orcamento.findUnique.mockResolvedValue(ORCAMENTO)
      orcAtualizarMock.mockRejectedValue(new Error('falha'))
      const res = await app.inject({ method: 'PUT', url: '/o1', ...form({}) })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('falha')
    })

    it('re-renderiza com mensagem genérica quando erro não-Error', async () => {
      prisma.orcamento.findUnique.mockResolvedValue(ORCAMENTO)
      orcAtualizarMock.mockRejectedValue('boom')
      const res = await app.inject({ method: 'PUT', url: '/o1', ...form({}) })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Erro ao atualizar')
    })
  })

  describe('POST /:id/status', () => {
    it('400 com status inválido', async () => {
      const res = await app.inject({ method: 'POST', url: '/o1/status', ...form({ status: 'XX' }) })
      expect(res.statusCode).toBe(400)
    })

    it('altera status com sucesso', async () => {
      orcAlterarStatusMock.mockResolvedValue(ORCAMENTO)
      const res = await app.inject({
        method: 'POST',
        url: '/o1/status',
        ...form({ status: 'APROVADO' }),
      })
      expect(res.statusCode).toBe(204)
      expect(res.headers['hx-redirect']).toBe('/admin/orcamentos/o1')
    })

    it('400 quando service rejeita (Error)', async () => {
      orcAlterarStatusMock.mockRejectedValue(new Error('transição inválida'))
      const res = await app.inject({
        method: 'POST',
        url: '/o1/status',
        ...form({ status: 'APROVADO' }),
      })
      expect(res.statusCode).toBe(400)
      expect(res.body).toContain('transição inválida')
    })

    it('400 com mensagem genérica quando erro não-Error', async () => {
      orcAlterarStatusMock.mockRejectedValue('boom')
      const res = await app.inject({
        method: 'POST',
        url: '/o1/status',
        ...form({ status: 'APROVADO' }),
      })
      expect(res.statusCode).toBe(400)
      expect(res.body).toContain('Erro ao alterar')
    })
  })

  describe('DELETE /:id', () => {
    it('exclui com sucesso', async () => {
      orcExcluirMock.mockResolvedValue(undefined)
      const res = await app.inject({ method: 'DELETE', url: '/o1' })
      expect(res.statusCode).toBe(200)
    })

    it('400 quando service rejeita (Error)', async () => {
      orcExcluirMock.mockRejectedValue(new Error('falha'))
      const res = await app.inject({ method: 'DELETE', url: '/o1' })
      expect(res.statusCode).toBe(400)
    })

    it('400 com mensagem genérica quando erro não-Error', async () => {
      orcExcluirMock.mockRejectedValue('boom')
      const res = await app.inject({ method: 'DELETE', url: '/o1' })
      expect(res.statusCode).toBe(400)
      expect(res.body).toContain('Erro ao excluir')
    })
  })

  describe('GET /:id (drill)', () => {
    it('404 quando não existe', async () => {
      orcBuscarMock.mockResolvedValue(null)
      const res = await app.inject({ method: 'GET', url: '/xx' })
      expect(res.statusCode).toBe(404)
    })

    it('renderiza detalhe com listas', async () => {
      orcBuscarMock.mockResolvedValue(ORCAMENTO)
      dotListarMock.mockResolvedValue([])
      prevListarMock.mockResolvedValue([])
      const res = await app.inject({ method: 'GET', url: '/o1' })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Orçamento')
      expect(dotListarMock).toHaveBeenCalledWith('o1')
      expect(prevListarMock).toHaveBeenCalledWith('o1')
    })

    it('totais somam valor e marcam diferença', async () => {
      orcBuscarMock.mockResolvedValue(ORCAMENTO)
      dotListarMock.mockResolvedValue([
        {
          id: 'd1',
          valorAutorizado: '1000',
          unidadeOrcamentaria: { codigo: '01' },
          funcao: { codigo: '04' },
          subfuncao: { codigo: '122', nome: 'X' },
          programa: { codigo: '0001' },
          acao: { codigo: '2001', nome: 'Y' },
          contaDespesa: { codigo: '3.1' },
          fonteRecurso: { codigo: '500' },
        },
      ])
      prevListarMock.mockResolvedValue([
        {
          id: 'p1',
          valorPrevisto: '900',
          contaReceita: { codigo: '1.1', descricao: 'IPTU' },
          fonteRecurso: { codigo: '500', nomenclatura: 'Livre' },
        },
      ])
      const res = await app.inject({ method: 'GET', url: '/o1' })
      expect(res.body).toContain('1.000,00')
      expect(res.body).toContain('900,00')
      expect(res.body).toContain('Diferença')
    })
  })

  describe('Dotação — FORM, CREATE, UPDATE, DELETE', () => {
    it('GET /dotacoes/form sem orcamentoId → 400', async () => {
      const res = await app.inject({ method: 'GET', url: '/dotacoes/form' })
      expect(res.statusCode).toBe(400)
    })

    it('GET /dotacoes/form orçamento inexistente → 404', async () => {
      prisma.orcamento.findUnique.mockResolvedValue(null)
      const res = await app.inject({ method: 'GET', url: '/dotacoes/form?orcamentoId=o1' })
      expect(res.statusCode).toBe(404)
    })

    it('GET /dotacoes/form renderiza com lookups', async () => {
      prisma.orcamento.findUnique.mockResolvedValue({ id: 'o1', entidadeId: 'ent1', ano: 2026 })
      prisma.unidadeOrcamentaria.findMany.mockResolvedValue([])
      prisma.funcao.findMany.mockResolvedValue([])
      prisma.programa.findMany.mockResolvedValue([])
      prisma.contaDespesaEntidade.findMany.mockResolvedValue([])
      prisma.fonteRecursoEntidade.findMany.mockResolvedValue([])
      const res = await app.inject({ method: 'GET', url: '/dotacoes/form?orcamentoId=o1' })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Nova Dotação')
    })

    it('GET /dotacoes/:id/form 404 quando dotação não existe', async () => {
      prisma.dotacaoDespesa.findUnique.mockResolvedValue(null)
      const res = await app.inject({ method: 'GET', url: '/dotacoes/xx/form' })
      expect(res.statusCode).toBe(404)
    })

    it('GET /dotacoes/:id/form 404 quando orçamento não existe', async () => {
      prisma.dotacaoDespesa.findUnique.mockResolvedValue({ id: 'd1', orcamentoId: 'o1' })
      prisma.orcamento.findUnique.mockResolvedValue(null)
      const res = await app.inject({ method: 'GET', url: '/dotacoes/d1/form' })
      expect(res.statusCode).toBe(404)
    })

    it('GET /dotacoes/:id/form renderiza para edição', async () => {
      prisma.dotacaoDespesa.findUnique.mockResolvedValue({ id: 'd1', orcamentoId: 'o1' })
      prisma.orcamento.findUnique.mockResolvedValue({ id: 'o1', entidadeId: 'ent1', ano: 2026 })
      prisma.unidadeOrcamentaria.findMany.mockResolvedValue([])
      prisma.funcao.findMany.mockResolvedValue([])
      prisma.programa.findMany.mockResolvedValue([])
      prisma.contaDespesaEntidade.findMany.mockResolvedValue([])
      prisma.fonteRecursoEntidade.findMany.mockResolvedValue([])
      const res = await app.inject({ method: 'GET', url: '/dotacoes/d1/form' })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Editar Dotação')
    })

    it('POST /dotacoes cria com sucesso', async () => {
      dotCriarMock.mockResolvedValue({ id: 'd1' })
      const res = await app.inject({
        method: 'POST',
        url: '/dotacoes',
        ...form({
          orcamentoId: 'o1',
          unidadeOrcamentariaId: 'uo1',
          funcaoId: 'f1',
          subfuncaoId: 's1',
          programaId: 'p1',
          acaoId: 'a1',
          contaDespesaEntidadeId: 'cd1',
          fonteRecursoEntidadeId: 'fr1',
          valorAutorizado: '1000',
        }),
      })
      expect(res.statusCode).toBe(204)
      expect(res.headers['hx-redirect']).toBe('/admin/orcamentos/o1')
    })

    it('POST /dotacoes 400 quando service rejeita (Error)', async () => {
      dotCriarMock.mockRejectedValue(new Error('falha'))
      const res = await app.inject({
        method: 'POST',
        url: '/dotacoes',
        ...form({ orcamentoId: 'o1', unidadeOrcamentariaId: 'uo1', funcaoId: 'f1', subfuncaoId: 's1', programaId: 'p1', acaoId: 'a1', contaDespesaEntidadeId: 'cd1', fonteRecursoEntidadeId: 'fr1', valorAutorizado: '1' }),
      })
      expect(res.statusCode).toBe(400)
      expect(res.body).toContain('falha')
    })

    it('POST /dotacoes 400 com mensagem genérica quando erro não-Error', async () => {
      dotCriarMock.mockRejectedValue('boom')
      const res = await app.inject({
        method: 'POST',
        url: '/dotacoes',
        ...form({ orcamentoId: 'o1', unidadeOrcamentariaId: 'uo1', funcaoId: 'f1', subfuncaoId: 's1', programaId: 'p1', acaoId: 'a1', contaDespesaEntidadeId: 'cd1', fonteRecursoEntidadeId: 'fr1', valorAutorizado: '1' }),
      })
      expect(res.statusCode).toBe(400)
      expect(res.body).toContain('Erro ao criar')
    })

    it('PUT /dotacoes/:id 404 quando não existe', async () => {
      prisma.dotacaoDespesa.findUnique.mockResolvedValue(null)
      const res = await app.inject({ method: 'PUT', url: '/dotacoes/xx', ...form({}) })
      expect(res.statusCode).toBe(404)
    })

    it('PUT /dotacoes/:id atualiza', async () => {
      prisma.dotacaoDespesa.findUnique.mockResolvedValue({ id: 'd1', orcamentoId: 'o1' })
      dotAtualizarMock.mockResolvedValue({ id: 'd1' })
      const res = await app.inject({
        method: 'PUT',
        url: '/dotacoes/d1',
        ...form({ unidadeOrcamentariaId: 'uo1', funcaoId: 'f1', subfuncaoId: 's1', programaId: 'p1', acaoId: 'a1', contaDespesaEntidadeId: 'cd1', fonteRecursoEntidadeId: 'fr1', valorAutorizado: '2000' }),
      })
      expect(res.statusCode).toBe(204)
      expect(res.headers['hx-redirect']).toBe('/admin/orcamentos/o1')
    })

    it('PUT /dotacoes/:id 400 quando service rejeita Error', async () => {
      prisma.dotacaoDespesa.findUnique.mockResolvedValue({ id: 'd1', orcamentoId: 'o1' })
      dotAtualizarMock.mockRejectedValue(new Error('falha'))
      const res = await app.inject({ method: 'PUT', url: '/dotacoes/d1', ...form({}) })
      expect(res.statusCode).toBe(400)
      expect(res.body).toContain('falha')
    })

    it('PUT /dotacoes/:id 400 com mensagem genérica quando erro não-Error', async () => {
      prisma.dotacaoDespesa.findUnique.mockResolvedValue({ id: 'd1', orcamentoId: 'o1' })
      dotAtualizarMock.mockRejectedValue('boom')
      const res = await app.inject({ method: 'PUT', url: '/dotacoes/d1', ...form({}) })
      expect(res.statusCode).toBe(400)
      expect(res.body).toContain('Erro ao atualizar')
    })

    it('DELETE /dotacoes/:id exclui', async () => {
      dotExcluirMock.mockResolvedValue(undefined)
      const res = await app.inject({ method: 'DELETE', url: '/dotacoes/d1' })
      expect(res.statusCode).toBe(200)
    })

    it('DELETE /dotacoes/:id 400 quando service rejeita Error', async () => {
      dotExcluirMock.mockRejectedValue(new Error('falha'))
      const res = await app.inject({ method: 'DELETE', url: '/dotacoes/d1' })
      expect(res.statusCode).toBe(400)
    })

    it('DELETE /dotacoes/:id 400 com mensagem genérica quando erro não-Error', async () => {
      dotExcluirMock.mockRejectedValue('boom')
      const res = await app.inject({ method: 'DELETE', url: '/dotacoes/d1' })
      expect(res.statusCode).toBe(400)
      expect(res.body).toContain('Erro ao excluir')
    })
  })

  describe('Previsão — FORM, CREATE, UPDATE, DELETE', () => {
    it('GET /previsoes/form sem orcamentoId → 400', async () => {
      const res = await app.inject({ method: 'GET', url: '/previsoes/form' })
      expect(res.statusCode).toBe(400)
    })

    it('GET /previsoes/form orçamento inexistente → 404', async () => {
      prisma.orcamento.findUnique.mockResolvedValue(null)
      const res = await app.inject({ method: 'GET', url: '/previsoes/form?orcamentoId=o1' })
      expect(res.statusCode).toBe(404)
    })

    it('GET /previsoes/form renderiza', async () => {
      prisma.orcamento.findUnique.mockResolvedValue({ id: 'o1', entidadeId: 'ent1', ano: 2026 })
      prisma.contaReceitaEntidade.findMany.mockResolvedValue([])
      prisma.fonteRecursoEntidade.findMany.mockResolvedValue([])
      const res = await app.inject({ method: 'GET', url: '/previsoes/form?orcamentoId=o1' })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Nova Previsão')
    })

    it('GET /previsoes/:id/form 404 quando previsão não existe', async () => {
      prisma.previsaoReceita.findUnique.mockResolvedValue(null)
      const res = await app.inject({ method: 'GET', url: '/previsoes/xx/form' })
      expect(res.statusCode).toBe(404)
    })

    it('GET /previsoes/:id/form 404 quando orçamento não existe', async () => {
      prisma.previsaoReceita.findUnique.mockResolvedValue({ id: 'p1', orcamentoId: 'o1' })
      prisma.orcamento.findUnique.mockResolvedValue(null)
      const res = await app.inject({ method: 'GET', url: '/previsoes/p1/form' })
      expect(res.statusCode).toBe(404)
    })

    it('GET /previsoes/:id/form renderiza', async () => {
      prisma.previsaoReceita.findUnique.mockResolvedValue({ id: 'p1', orcamentoId: 'o1' })
      prisma.orcamento.findUnique.mockResolvedValue({ id: 'o1', entidadeId: 'ent1', ano: 2026 })
      prisma.contaReceitaEntidade.findMany.mockResolvedValue([])
      prisma.fonteRecursoEntidade.findMany.mockResolvedValue([])
      const res = await app.inject({ method: 'GET', url: '/previsoes/p1/form' })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Editar Previsão')
    })

    it('POST /previsoes cria com sucesso', async () => {
      prevCriarMock.mockResolvedValue({ id: 'p1' })
      const res = await app.inject({
        method: 'POST',
        url: '/previsoes',
        ...form({ orcamentoId: 'o1', contaReceitaEntidadeId: 'cr1', fonteRecursoEntidadeId: 'fr1', valorPrevisto: '5000' }),
      })
      expect(res.statusCode).toBe(204)
      expect(res.headers['hx-redirect']).toBe('/admin/orcamentos/o1')
    })

    it('POST /previsoes 400 quando service rejeita Error', async () => {
      prevCriarMock.mockRejectedValue(new Error('falha'))
      const res = await app.inject({
        method: 'POST',
        url: '/previsoes',
        ...form({ orcamentoId: 'o1', contaReceitaEntidadeId: 'cr1', fonteRecursoEntidadeId: 'fr1', valorPrevisto: '1' }),
      })
      expect(res.statusCode).toBe(400)
      expect(res.body).toContain('falha')
    })

    it('POST /previsoes 400 com mensagem genérica quando erro não-Error', async () => {
      prevCriarMock.mockRejectedValue('boom')
      const res = await app.inject({
        method: 'POST',
        url: '/previsoes',
        ...form({ orcamentoId: 'o1', contaReceitaEntidadeId: 'cr1', fonteRecursoEntidadeId: 'fr1', valorPrevisto: '1' }),
      })
      expect(res.statusCode).toBe(400)
      expect(res.body).toContain('Erro ao criar')
    })

    it('PUT /previsoes/:id 404 quando não existe', async () => {
      prisma.previsaoReceita.findUnique.mockResolvedValue(null)
      const res = await app.inject({ method: 'PUT', url: '/previsoes/xx', ...form({}) })
      expect(res.statusCode).toBe(404)
    })

    it('PUT /previsoes/:id atualiza', async () => {
      prisma.previsaoReceita.findUnique.mockResolvedValue({ id: 'p1', orcamentoId: 'o1' })
      prevAtualizarMock.mockResolvedValue({ id: 'p1' })
      const res = await app.inject({
        method: 'PUT',
        url: '/previsoes/p1',
        ...form({ contaReceitaEntidadeId: 'cr1', fonteRecursoEntidadeId: 'fr1', valorPrevisto: '6000' }),
      })
      expect(res.statusCode).toBe(204)
      expect(res.headers['hx-redirect']).toBe('/admin/orcamentos/o1')
    })

    it('PUT /previsoes/:id 400 quando service rejeita Error', async () => {
      prisma.previsaoReceita.findUnique.mockResolvedValue({ id: 'p1', orcamentoId: 'o1' })
      prevAtualizarMock.mockRejectedValue(new Error('falha'))
      const res = await app.inject({ method: 'PUT', url: '/previsoes/p1', ...form({}) })
      expect(res.statusCode).toBe(400)
    })

    it('PUT /previsoes/:id 400 com mensagem genérica quando erro não-Error', async () => {
      prisma.previsaoReceita.findUnique.mockResolvedValue({ id: 'p1', orcamentoId: 'o1' })
      prevAtualizarMock.mockRejectedValue('boom')
      const res = await app.inject({ method: 'PUT', url: '/previsoes/p1', ...form({}) })
      expect(res.statusCode).toBe(400)
      expect(res.body).toContain('Erro ao atualizar')
    })

    it('DELETE /previsoes/:id exclui', async () => {
      prevExcluirMock.mockResolvedValue(undefined)
      const res = await app.inject({ method: 'DELETE', url: '/previsoes/p1' })
      expect(res.statusCode).toBe(200)
    })

    it('DELETE /previsoes/:id 400 quando service rejeita Error', async () => {
      prevExcluirMock.mockRejectedValue(new Error('falha'))
      const res = await app.inject({ method: 'DELETE', url: '/previsoes/p1' })
      expect(res.statusCode).toBe(400)
    })

    it('DELETE /previsoes/:id 400 com mensagem genérica quando erro não-Error', async () => {
      prevExcluirMock.mockRejectedValue('boom')
      const res = await app.inject({ method: 'DELETE', url: '/previsoes/p1' })
      expect(res.statusCode).toBe(400)
      expect(res.body).toContain('Erro ao excluir')
    })
  })
})
