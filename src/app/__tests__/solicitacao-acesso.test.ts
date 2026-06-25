import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ErroNegocio } from '../../errors.js'

const { criarMock, listarMinhasMock, cancelarMock } = vi.hoisted(() => ({
  criarMock: vi.fn(),
  listarMinhasMock: vi.fn(),
  cancelarMock: vi.fn(),
}))

vi.mock('../../services/solicitacoes-acesso.js', () => ({
  SolicitacoesAcessoService: class {
    criar = criarMock
    listarMinhas = listarMinhasMock
    cancelar = cancelarMock
  },
}))

import { criarApp } from '../../routes/__tests__/helpers/criarApp.js'
import { appSolicitacaoAcessoRoutes } from '../solicitacao-acesso.js'
import type { FastifyInstance } from 'fastify'
import type { PrismaMock } from '../../services/__tests__/helpers/prisma-mock.js'

function form(obj: Record<string, string>) {
  return {
    payload: new URLSearchParams(obj).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  }
}

describe('appSolicitacaoAcessoRoutes', () => {
  let app: FastifyInstance
  let prisma: PrismaMock

  beforeEach(async () => {
    criarMock.mockReset()
    listarMinhasMock.mockReset()
    cancelarMock.mockReset()
    ;({ app, prisma } = await criarApp({
      registrar: appSolicitacaoAcessoRoutes,
      comView: true,
      simularUsuario: { sub: 'u1', email: 'u@x.com' },
    }))
  })

  describe('GET /solicitar-acesso', () => {
    it('sem busca (q curto) não consulta entidades', async () => {
      const res = await app.inject({ method: 'GET', url: '/solicitar-acesso?q=a' })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Solicitar acesso')
      expect(prisma.entidade.findMany).not.toHaveBeenCalled()
    })

    it('busca e classifica disponível / com acesso / pendente', async () => {
      prisma.entidade.findMany.mockResolvedValue([
        { id: 'e1', nome: 'Prefeitura A', municipio: { nome: 'Curitiba', estado: { sigla: 'PR' } } },
        { id: 'e2', nome: 'Câmara B', municipio: { nome: 'Curitiba', estado: { sigla: 'PR' } } },
        { id: 'e3', nome: 'Prefeitura C', municipio: { nome: 'Maringá', estado: { sigla: 'PR' } } },
      ])
      prisma.acessoEntidade.findMany.mockResolvedValue([{ entidadeId: 'e2' }])
      prisma.solicitacaoAcessoEntidade.findMany.mockResolvedValue([{ entidadeId: 'e3' }])
      const res = await app.inject({ method: 'GET', url: '/solicitar-acesso?q=pref' })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Prefeitura A')
      expect(res.body).toContain('Você já tem acesso')
      expect(res.body).toContain('Solicitação pendente')
    })

    it('busca sem resultados mostra aviso', async () => {
      prisma.entidade.findMany.mockResolvedValue([])
      const res = await app.inject({ method: 'GET', url: '/solicitar-acesso?q=zzz' })
      expect(res.body).toContain('Nenhuma entidade ativa encontrada')
    })

    it('mostra erro vindo por querystring', async () => {
      const res = await app.inject({ method: 'GET', url: '/solicitar-acesso?erro=Voc%C3%AA%20j%C3%A1%20tem%20acesso' })
      expect(res.body).toContain('Você já tem acesso')
    })
  })

  describe('POST /solicitar-acesso', () => {
    it('sucesso redireciona para minhas-solicitações', async () => {
      criarMock.mockResolvedValue({ id: 's1' })
      const res = await app.inject({
        method: 'POST',
        url: '/solicitar-acesso',
        ...form({ entidadeId: 'e1', nivelSolicitado: 'LEITURA', justificativa: 'oi' }),
      })
      expect(res.statusCode).toBe(302)
      expect(res.headers.location).toBe('/app/minhas-solicitacoes')
      expect(criarMock).toHaveBeenCalledWith({
        usuarioId: 'u1',
        entidadeId: 'e1',
        nivelSolicitado: 'LEITURA',
        justificativa: 'oi',
      })
    })

    it('erro de negócio volta ao form com a mensagem', async () => {
      criarMock.mockRejectedValue(new ErroNegocio('CONFLITO', 'Você já tem acesso a esta entidade.'))
      const res = await app.inject({
        method: 'POST',
        url: '/solicitar-acesso',
        ...form({ entidadeId: 'e1', nivelSolicitado: 'LEITURA' }),
      })
      expect(res.headers.location).toContain('/app/solicitar-acesso?erro=')
      expect(decodeURIComponent(res.headers.location as string)).toContain('já tem acesso')
    })

    it('campos ausentes viram string vazia (delegado ao service)', async () => {
      criarMock.mockResolvedValue({ id: 's1' })
      const res = await app.inject({ method: 'POST', url: '/solicitar-acesso', ...form({}) })
      expect(res.statusCode).toBe(302)
      expect(criarMock).toHaveBeenCalledWith({
        usuarioId: 'u1',
        entidadeId: '',
        nivelSolicitado: '',
        justificativa: undefined,
      })
    })

    it('erro inesperado usa mensagem genérica', async () => {
      criarMock.mockRejectedValue(new Error('boom'))
      const res = await app.inject({
        method: 'POST',
        url: '/solicitar-acesso',
        ...form({ entidadeId: 'e1', nivelSolicitado: 'LEITURA' }),
      })
      expect(decodeURIComponent(res.headers.location as string)).toContain('Erro ao solicitar acesso.')
    })
  })

  describe('GET /minhas-solicitacoes', () => {
    it('renderiza a lista', async () => {
      listarMinhasMock.mockResolvedValue([
        {
          id: 's1',
          nivelSolicitado: 'ESCRITA',
          status: 'APROVADA',
          nivelConcedido: 'LEITURA',
          observacaoDecisao: 'liberado parcial',
          entidade: { nome: 'Prefeitura A', municipio: { nome: 'Curitiba', estado: { sigla: 'PR' } } },
        },
        {
          id: 's2',
          nivelSolicitado: 'LEITURA',
          status: 'PENDENTE',
          entidade: { nome: 'Câmara B', municipio: { nome: 'Curitiba', estado: { sigla: 'PR' } } },
        },
      ])
      const res = await app.inject({ method: 'GET', url: '/minhas-solicitacoes' })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Prefeitura A')
      expect(res.body).toContain('Cancelar')
    })

    it('estado vazio', async () => {
      listarMinhasMock.mockResolvedValue([])
      const res = await app.inject({ method: 'GET', url: '/minhas-solicitacoes' })
      expect(res.body).toContain('ainda não fez nenhuma solicitação')
    })
  })

  describe('POST /minhas-solicitacoes/:id/cancelar', () => {
    it('cancela e redireciona', async () => {
      cancelarMock.mockResolvedValue({ id: 's1' })
      const res = await app.inject({ method: 'POST', url: '/minhas-solicitacoes/s1/cancelar' })
      expect(res.statusCode).toBe(302)
      expect(res.headers.location).toBe('/app/minhas-solicitacoes')
      expect(cancelarMock).toHaveBeenCalledWith('s1', 'u1')
    })

    it('erro ao cancelar ainda redireciona (idempotente)', async () => {
      cancelarMock.mockRejectedValue(new ErroNegocio('CONFLITO', 'já decidida'))
      const res = await app.inject({ method: 'POST', url: '/minhas-solicitacoes/s1/cancelar' })
      expect(res.statusCode).toBe(302)
      expect(res.headers.location).toBe('/app/minhas-solicitacoes')
    })
  })
})
