import { describe, it, expect, beforeEach, vi } from 'vitest'

const { listarMock, buscarPorIdMock, criarMock, atualizarMock, excluirMock } = vi.hoisted(() => ({
  listarMock: vi.fn(),
  buscarPorIdMock: vi.fn(),
  criarMock: vi.fn(),
  atualizarMock: vi.fn(),
  excluirMock: vi.fn(),
}))

vi.mock('../../services/eventos-contabeis.js', () => ({
  EventosContabeisService: class {
    listar = listarMock
    buscarPorId = buscarPorIdMock
    criar = criarMock
    atualizar = atualizarMock
    excluir = excluirMock
  },
}))

import { criarApp } from '../../routes/__tests__/helpers/criarApp.js'
import { adminEventosContabeisRoutes } from '../eventos-contabeis.js'
import type { FastifyInstance } from 'fastify'
import type { PrismaMock } from '../../services/__tests__/helpers/prisma-mock.js'

const MODELO = { id: 'm1', descricao: 'PARANÁ', ativo: true }
const EVENTO = {
  id: 'ev1',
  modeloContabilId: 'm1',
  codigo: '100001',
  descricao: 'PREVISÃO INICIAL DA RECEITA',
  tipoInscricao: '11 - Natureza da Receita',
  classificacaoContabilMascara: '521920100',
  classificacaoOrcamentariaMascara: 'YYYYYYY',
  ativo: true,
  lancamentos: [
    { id: 'l1', ordem: 1, contaDebitoMascara: '521920100', contaCreditoMascara: '521929900' },
    { id: 'l2', ordem: 2, contaDebitoMascara: '521919900', contaCreditoMascara: '621100000' },
  ],
}

function form(obj: Record<string, string | string[]>) {
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(obj)) {
    if (Array.isArray(v)) v.forEach((x) => params.append(k, x))
    else params.append(k, v)
  }
  return {
    payload: params.toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  }
}

describe('adminEventosContabeisRoutes', () => {
  let app: FastifyInstance
  let prisma: PrismaMock

  beforeEach(async () => {
    ;[listarMock, buscarPorIdMock, criarMock, atualizarMock, excluirMock].forEach((m) => m.mockReset())
    ;({ app, prisma } = await criarApp({
      registrar: adminEventosContabeisRoutes,
      comView: true,
      simularAdmin: { sub: 'a1', email: 'a@x.com' },
    }))
  })

  describe('GET /', () => {
    it('sem modelo mostra picker', async () => {
      prisma.modeloContabil.findMany.mockResolvedValue([MODELO])
      const res = await app.inject({ method: 'GET', url: '/' })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Selecione um modelo')
      expect(listarMock).not.toHaveBeenCalled()
    })

    it('com modelo lista eventos', async () => {
      prisma.modeloContabil.findMany.mockResolvedValue([MODELO])
      listarMock.mockResolvedValue([EVENTO])
      const res = await app.inject({ method: 'GET', url: '/?modeloContabilId=m1' })
      expect(listarMock).toHaveBeenCalledWith('m1')
      expect(res.body).toContain('100001')
      expect(res.body).toContain('PREVISÃO INICIAL')
      expect(res.body).toContain('Inscrição: 11')
    })

    it('evento inativo renderiza badge correto', async () => {
      prisma.modeloContabil.findMany.mockResolvedValue([])
      listarMock.mockResolvedValue([{ ...EVENTO, ativo: false }])
      const res = await app.inject({ method: 'GET', url: '/?modeloContabilId=m1' })
      expect(res.body).toContain('Inativo')
    })

    it('lista vazia mostra placeholder', async () => {
      prisma.modeloContabil.findMany.mockResolvedValue([])
      listarMock.mockResolvedValue([])
      const res = await app.inject({ method: 'GET', url: '/?modeloContabilId=m1' })
      expect(res.body).toContain('Nenhum evento cadastrado')
    })

    it('ignora modeloContabilId whitespace', async () => {
      prisma.modeloContabil.findMany.mockResolvedValue([])
      await app.inject({ method: 'GET', url: '/?modeloContabilId=%20' })
      expect(listarMock).not.toHaveBeenCalled()
    })
  })

  describe('GET /novo', () => {
    it('sem modeloContabilId redireciona', async () => {
      const res = await app.inject({ method: 'GET', url: '/novo' })
      expect(res.statusCode).toBe(302)
      expect(res.headers.location).toBe('/admin/eventos-contabeis')
    })

    it('404 quando modelo não existe', async () => {
      prisma.modeloContabil.findUnique.mockResolvedValue(null)
      const res = await app.inject({ method: 'GET', url: '/novo?modeloContabilId=xx' })
      expect(res.statusCode).toBe(404)
    })

    it('renderiza form vazio', async () => {
      prisma.modeloContabil.findUnique.mockResolvedValue({ id: 'm1', descricao: 'PARANÁ' })
      const res = await app.inject({ method: 'GET', url: '/novo?modeloContabilId=m1' })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Novo Evento Contábil')
      expect(res.body).toContain('PARANÁ')
    })
  })

  describe('GET /:id/editar', () => {
    it('404 quando evento não existe', async () => {
      buscarPorIdMock.mockResolvedValue(null)
      const res = await app.inject({ method: 'GET', url: '/ev1/editar' })
      expect(res.statusCode).toBe(404)
    })

    it('renderiza form preenchido', async () => {
      buscarPorIdMock.mockResolvedValue(EVENTO)
      prisma.modeloContabil.findUnique.mockResolvedValue({ id: 'm1', descricao: 'PARANÁ' })
      const res = await app.inject({ method: 'GET', url: '/ev1/editar' })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Editar Evento Contábil')
      expect(res.body).toContain('100001')
      expect(res.body).toContain('521920100')
    })
  })

  describe('POST /', () => {
    it('cria e devolve HX-Redirect', async () => {
      prisma.modeloContabil.findUnique.mockResolvedValue({ id: 'm1', descricao: 'PARANÁ' })
      criarMock.mockResolvedValue({ id: 'ev1' })
      const res = await app.inject({
        method: 'POST',
        url: '/',
        ...form({
          modeloContabilId: 'm1',
          codigo: '100001',
          descricao: 'PREVISÃO',
          tipoInscricao: '11 - Natureza',
          classificacaoContabilMascara: '521920100',
          classificacaoOrcamentariaMascara: 'YYYYYYY',
          ativo: 'true',
          contaDebito: ['521920100', '521919900'],
          contaCredito: ['521929900', '621100000'],
        }),
      })
      expect(res.statusCode).toBe(204)
      expect(res.headers['hx-redirect']).toBe('/admin/eventos-contabeis?modeloContabilId=m1')
      expect(criarMock).toHaveBeenCalledWith('m1', expect.objectContaining({
        codigo: '100001',
        descricao: 'PREVISÃO',
        lancamentos: [
          { contaDebitoMascara: '521920100', contaCreditoMascara: '521929900' },
          { contaDebitoMascara: '521919900', contaCreditoMascara: '621100000' },
        ],
      }))
    })

    it('ativo=false quando explícito', async () => {
      prisma.modeloContabil.findUnique.mockResolvedValue({ id: 'm1', descricao: 'X' })
      criarMock.mockResolvedValue({ id: 'ev1' })
      await app.inject({
        method: 'POST',
        url: '/',
        ...form({
          modeloContabilId: 'm1',
          codigo: '100001',
          descricao: 'X',
          ativo: 'false',
          contaDebito: '111',
          contaCredito: '222',
        }),
      })
      expect(criarMock.mock.calls[0][1].ativo).toBe(false)
    })

    it('arrays de tamanhos diferentes preenchem com vazio (que vai cair na validação do service)', async () => {
      prisma.modeloContabil.findUnique.mockResolvedValue({ id: 'm1', descricao: 'X' })
      criarMock.mockResolvedValue({ id: 'ev1' })
      // Cobre os dois branches em montarLancamentos: créditos > débitos
      // (debitos[i] ?? '') e débitos > créditos (creditos[i] ?? '').
      await app.inject({
        method: 'POST',
        url: '/',
        ...form({
          modeloContabilId: 'm1',
          codigo: '100001',
          descricao: 'X',
          contaDebito: ['111', '222'],
          contaCredito: ['333'],
        }),
      })
      expect(criarMock.mock.calls[0][1].lancamentos).toEqual([
        { contaDebitoMascara: '111', contaCreditoMascara: '333' },
        { contaDebitoMascara: '222', contaCreditoMascara: '' },
      ])
      criarMock.mockClear()

      await app.inject({
        method: 'POST',
        url: '/',
        ...form({
          modeloContabilId: 'm1',
          codigo: '100001',
          descricao: 'X',
          contaDebito: ['111'],
          contaCredito: ['333', '444'],
        }),
      })
      expect(criarMock.mock.calls[0][1].lancamentos).toEqual([
        { contaDebitoMascara: '111', contaCreditoMascara: '333' },
        { contaDebitoMascara: '', contaCreditoMascara: '444' },
      ])
    })

    it('400 sem modeloContabilId', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/',
        ...form({ modeloContabilId: '   ', codigo: '1', descricao: 'X', contaDebito: '1', contaCredito: '2' }),
      })
      expect(res.statusCode).toBe(400)
      expect(criarMock).not.toHaveBeenCalled()
    })

    it('404 quando modelo não existe', async () => {
      prisma.modeloContabil.findUnique.mockResolvedValue(null)
      const res = await app.inject({
        method: 'POST',
        url: '/',
        ...form({ modeloContabilId: 'xx', codigo: '1', descricao: 'X', contaDebito: '1', contaCredito: '2' }),
      })
      expect(res.statusCode).toBe(404)
    })

    it('erro do service vira mensagem na view', async () => {
      prisma.modeloContabil.findUnique.mockResolvedValue({ id: 'm1', descricao: 'X' })
      criarMock.mockRejectedValue(new Error('Já existe esse código.'))
      const res = await app.inject({
        method: 'POST',
        url: '/',
        ...form({
          modeloContabilId: 'm1',
          codigo: '100001',
          descricao: 'X',
          contaDebito: '111',
          contaCredito: '222',
        }),
      })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Já existe esse código')
    })

    it('erro não-Error usa mensagem default', async () => {
      prisma.modeloContabil.findUnique.mockResolvedValue({ id: 'm1', descricao: 'X' })
      criarMock.mockRejectedValue('boom')
      const res = await app.inject({
        method: 'POST',
        url: '/',
        ...form({
          modeloContabilId: 'm1',
          codigo: '100001',
          descricao: 'X',
          contaDebito: '111',
          contaCredito: '222',
        }),
      })
      expect(res.body).toContain('Erro ao criar evento')
    })

    it('sem listas de débito/crédito gera array vazio (service rejeitará)', async () => {
      prisma.modeloContabil.findUnique.mockResolvedValue({ id: 'm1', descricao: 'X' })
      criarMock.mockResolvedValue({ id: 'ev1' })
      await app.inject({
        method: 'POST',
        url: '/',
        ...form({ modeloContabilId: 'm1', codigo: '1', descricao: 'X' }),
      })
      expect(criarMock.mock.calls[0][1].lancamentos).toEqual([])
    })

    it('reRender com body sem codigo/descricao usa string vazia', async () => {
      prisma.modeloContabil.findUnique.mockResolvedValue({ id: 'm1', descricao: 'X' })
      criarMock.mockRejectedValue(new Error('boom'))
      // POST sem codigo e sem descricao no body → reRender com '' nos campos.
      const res = await app.inject({
        method: 'POST',
        url: '/',
        ...form({ modeloContabilId: 'm1', contaDebito: '1', contaCredito: '2' }),
      })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('boom')
    })
  })

  describe('PUT /:id', () => {
    it('atualiza e devolve HX-Redirect', async () => {
      buscarPorIdMock.mockResolvedValue(EVENTO)
      prisma.modeloContabil.findUnique.mockResolvedValue({ id: 'm1', descricao: 'PARANÁ' })
      atualizarMock.mockResolvedValue(EVENTO)
      const res = await app.inject({
        method: 'PUT',
        url: '/ev1',
        ...form({
          codigo: '100002',
          descricao: 'NOVA DESCRIÇÃO',
          contaDebito: '111',
          contaCredito: '222',
        }),
      })
      expect(res.statusCode).toBe(204)
      expect(res.headers['hx-redirect']).toBe('/admin/eventos-contabeis?modeloContabilId=m1')
      expect(atualizarMock).toHaveBeenCalledWith('ev1', expect.objectContaining({
        codigo: '100002',
        descricao: 'NOVA DESCRIÇÃO',
      }))
    })

    it('404 quando evento não existe', async () => {
      buscarPorIdMock.mockResolvedValue(null)
      const res = await app.inject({
        method: 'PUT',
        url: '/ev1',
        ...form({ codigo: '1', descricao: 'X', contaDebito: '1', contaCredito: '2' }),
      })
      expect(res.statusCode).toBe(404)
    })

    it('erro do service vira mensagem na view', async () => {
      buscarPorIdMock.mockResolvedValue(EVENTO)
      prisma.modeloContabil.findUnique.mockResolvedValue({ id: 'm1', descricao: 'X' })
      atualizarMock.mockRejectedValue(new Error('falhou'))
      const res = await app.inject({
        method: 'PUT',
        url: '/ev1',
        ...form({ codigo: '1', descricao: 'X', contaDebito: '1', contaCredito: '2' }),
      })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('falhou')
    })

    it('erro não-Error usa mensagem default', async () => {
      buscarPorIdMock.mockResolvedValue(EVENTO)
      prisma.modeloContabil.findUnique.mockResolvedValue({ id: 'm1', descricao: 'X' })
      atualizarMock.mockRejectedValue('boom')
      const res = await app.inject({
        method: 'PUT',
        url: '/ev1',
        ...form({ codigo: '1', descricao: 'X', contaDebito: '1', contaCredito: '2' }),
      })
      expect(res.body).toContain('Erro ao atualizar evento')
    })

    it('reRender com body sem codigo/descricao usa string vazia', async () => {
      buscarPorIdMock.mockResolvedValue(EVENTO)
      prisma.modeloContabil.findUnique.mockResolvedValue({ id: 'm1', descricao: 'X' })
      atualizarMock.mockRejectedValue(new Error('falhou'))
      const res = await app.inject({
        method: 'PUT',
        url: '/ev1',
        ...form({ contaDebito: '1', contaCredito: '2' }),
      })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('falhou')
    })
  })

  describe('DELETE /:id', () => {
    it('exclui com 200', async () => {
      excluirMock.mockResolvedValue(undefined)
      const res = await app.inject({ method: 'DELETE', url: '/ev1' })
      expect(res.statusCode).toBe(200)
      expect(excluirMock).toHaveBeenCalledWith('ev1')
    })

    it('400 quando service rejeita com Error', async () => {
      excluirMock.mockRejectedValue(new Error('Não encontrado'))
      const res = await app.inject({ method: 'DELETE', url: '/ev1' })
      expect(res.statusCode).toBe(400)
      expect(res.body).toBe('Não encontrado')
    })

    it('400 com mensagem default para erro não-Error', async () => {
      excluirMock.mockRejectedValue('boom')
      const res = await app.inject({ method: 'DELETE', url: '/ev1' })
      expect(res.body).toBe('Erro ao excluir.')
    })
  })
})
