import { describe, it, expect, beforeEach, vi } from 'vitest'

const {
  listarPorUsuarioMock,
  concederMock,
  atualizarMock,
  revogarMock,
  listarPendentesMock,
  aprovarMock,
  rejeitarMock,
} = vi.hoisted(() => ({
  listarPorUsuarioMock: vi.fn(),
  concederMock: vi.fn(),
  atualizarMock: vi.fn(),
  revogarMock: vi.fn(),
  listarPendentesMock: vi.fn(),
  aprovarMock: vi.fn(),
  rejeitarMock: vi.fn(),
}))

vi.mock('../../services/acessos-entidade.js', () => ({
  AcessosEntidadeService: class {
    listarPorUsuario = listarPorUsuarioMock
    listarPorEntidade = vi.fn()
    buscarPorId = vi.fn()
    usuarioPodeAcessar = vi.fn()
    conceder = concederMock
    atualizar = atualizarMock
    revogar = revogarMock
  },
}))

vi.mock('../../services/solicitacoes-acesso.js', () => ({
  SolicitacoesAcessoService: class {
    listarPendentes = listarPendentesMock
    aprovar = aprovarMock
    rejeitar = rejeitarMock
    criar = vi.fn()
    listarMinhas = vi.fn()
    cancelar = vi.fn()
  },
}))

import { criarApp } from '../../routes/__tests__/helpers/criarApp.js'
import { adminAcessosEntidadeRoutes } from '../acessos-entidade.js'
import type { FastifyInstance } from 'fastify'
import type { PrismaMock } from '../../services/__tests__/helpers/prisma-mock.js'

const USUARIO = { id: 'u1', nomeCompleto: 'Fulano', emailPrincipal: 'fulano@ex.com' }
const ACESSO = {
  id: 'a1',
  usuarioId: 'u1',
  entidadeId: 'ent1',
  nivel: 'LEITURA',
  ativo: true,
  entidade: {
    id: 'ent1',
    nome: 'Prefeitura',
    municipio: { nome: 'Curitiba', estado: { sigla: 'PR' } },
  },
}

function form(obj: Record<string, string>) {
  return {
    payload: new URLSearchParams(obj).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  }
}

describe('adminAcessosEntidadeRoutes', () => {
  let app: FastifyInstance
  let prisma: PrismaMock

  beforeEach(async () => {
    ;[
      listarPorUsuarioMock,
      concederMock,
      atualizarMock,
      revogarMock,
      listarPendentesMock,
      aprovarMock,
      rejeitarMock,
    ].forEach((m) => m.mockReset())
    ;({ app, prisma } = await criarApp({
      registrar: adminAcessosEntidadeRoutes,
      comView: true,
      simularAdmin: { sub: 'a1', email: 'a@x.com' },
    }))
  })

  describe('GET /usuario/:usuarioId', () => {
    it('404 quando usuário não existe', async () => {
      prisma.usuario.findUnique.mockResolvedValue(null)
      const res = await app.inject({ method: 'GET', url: '/usuario/xx' })
      expect(res.statusCode).toBe(404)
    })

    it('renderiza lista vazia sem cascade', async () => {
      prisma.usuario.findUnique.mockResolvedValue(USUARIO)
      listarPorUsuarioMock.mockResolvedValue([])
      prisma.estado.findMany.mockResolvedValue([])
      const res = await app.inject({ method: 'GET', url: '/usuario/u1' })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Fulano')
      expect(res.body).toContain('Nenhum acesso concedido')
      expect(res.body).toContain('Selecione um estado')
    })

    it('renderiza com acesso existente', async () => {
      prisma.usuario.findUnique.mockResolvedValue(USUARIO)
      listarPorUsuarioMock.mockResolvedValue([ACESSO])
      prisma.estado.findMany.mockResolvedValue([])
      const res = await app.inject({ method: 'GET', url: '/usuario/u1' })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Prefeitura')
      expect(res.body).toContain('Curitiba')
      expect(res.body).toContain('Leitura')
    })

    it('com estadoId carrega municípios', async () => {
      prisma.usuario.findUnique.mockResolvedValue(USUARIO)
      listarPorUsuarioMock.mockResolvedValue([])
      prisma.estado.findMany.mockResolvedValue([])
      prisma.municipio.findMany.mockResolvedValue([{ id: 'mun1', nome: 'Curitiba' }])
      await app.inject({ method: 'GET', url: '/usuario/u1?estadoId=e1' })
      expect(prisma.municipio.findMany).toHaveBeenCalled()
    })

    it('com municipioId mostra entidades disponíveis (excluindo já concedidas)', async () => {
      prisma.usuario.findUnique.mockResolvedValue(USUARIO)
      listarPorUsuarioMock.mockResolvedValue([ACESSO]) // ent1 já concedida
      prisma.estado.findMany.mockResolvedValue([])
      prisma.entidade.findMany.mockResolvedValue([
        { id: 'ent1', nome: 'Prefeitura', tipo: 'PREFEITURA' },
        { id: 'ent2', nome: 'Câmara', tipo: 'CAMARA' },
      ])
      const res = await app.inject({ method: 'GET', url: '/usuario/u1?estadoId=e1&municipioId=mun1' })
      // ent2 disponível, ent1 não (filtrada por jaConcedidasIds)
      expect(res.body).toContain('Câmara')
    })

    it('avisa quando todas as entidades do município já foram concedidas', async () => {
      prisma.usuario.findUnique.mockResolvedValue(USUARIO)
      listarPorUsuarioMock.mockResolvedValue([ACESSO])
      prisma.estado.findMany.mockResolvedValue([])
      prisma.entidade.findMany.mockResolvedValue([{ id: 'ent1', nome: 'Prefeitura', tipo: 'PREFEITURA' }])
      const res = await app.inject({ method: 'GET', url: '/usuario/u1?estadoId=e1&municipioId=mun1' })
      expect(res.body).toContain('Nenhuma entidade disponível')
    })
  })

  describe('POST /', () => {
    it('concede com sucesso', async () => {
      concederMock.mockResolvedValue(ACESSO)
      const res = await app.inject({
        method: 'POST',
        url: '/',
        ...form({ usuarioId: 'u1', entidadeId: 'ent1', nivel: 'ESCRITA' }),
      })
      expect(res.statusCode).toBe(204)
      expect(res.headers['hx-redirect']).toBe('/admin/acessos-entidade/usuario/u1')
      expect(concederMock).toHaveBeenCalledWith({
        usuarioId: 'u1',
        entidadeId: 'ent1',
        nivel: 'ESCRITA',
      })
    })

    it('400 quando service rejeita Error', async () => {
      concederMock.mockRejectedValue(new Error('Entidade não encontrada.'))
      const res = await app.inject({
        method: 'POST',
        url: '/',
        ...form({ usuarioId: 'u1', entidadeId: 'xx', nivel: 'LEITURA' }),
      })
      expect(res.statusCode).toBe(400)
      expect(res.body).toContain('Entidade não encontrada')
    })

    it('400 com mensagem genérica quando erro não-Error', async () => {
      concederMock.mockRejectedValue('boom')
      const res = await app.inject({
        method: 'POST',
        url: '/',
        ...form({ usuarioId: 'u1', entidadeId: 'ent1', nivel: 'LEITURA' }),
      })
      expect(res.statusCode).toBe(400)
      expect(res.body).toContain('Erro ao conceder')
    })
  })

  describe('GET /:id/form', () => {
    it('404 quando não existe', async () => {
      prisma.acessoEntidade.findUnique.mockResolvedValue(null)
      const res = await app.inject({ method: 'GET', url: '/xx/form' })
      expect(res.statusCode).toBe(404)
    })

    it('renderiza form', async () => {
      prisma.acessoEntidade.findUnique.mockResolvedValue(ACESSO)
      const res = await app.inject({ method: 'GET', url: '/a1/form' })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Editar Acesso')
      expect(res.body).toContain('Prefeitura')
    })
  })

  describe('PUT /:id', () => {
    it('404 quando não existe', async () => {
      prisma.acessoEntidade.findUnique.mockResolvedValue(null)
      const res = await app.inject({ method: 'PUT', url: '/xx', ...form({ nivel: 'ADMIN' }) })
      expect(res.statusCode).toBe(404)
    })

    it('atualiza ativo=true quando checkbox marcado', async () => {
      prisma.acessoEntidade.findUnique.mockResolvedValue({ id: 'a1', usuarioId: 'u1' })
      atualizarMock.mockResolvedValue(ACESSO)
      const res = await app.inject({
        method: 'PUT',
        url: '/a1',
        ...form({ nivel: 'ESCRITA', ativo: 'true' }),
      })
      expect(res.statusCode).toBe(204)
      expect(res.headers['hx-redirect']).toBe('/admin/acessos-entidade/usuario/u1')
      expect(atualizarMock).toHaveBeenCalledWith('a1', { nivel: 'ESCRITA', ativo: true })
    })

    it('atualiza ativo=false quando checkbox ausente', async () => {
      prisma.acessoEntidade.findUnique.mockResolvedValue({ id: 'a1', usuarioId: 'u1' })
      atualizarMock.mockResolvedValue(ACESSO)
      await app.inject({ method: 'PUT', url: '/a1', ...form({ nivel: 'LEITURA' }) })
      expect(atualizarMock).toHaveBeenCalledWith('a1', { nivel: 'LEITURA', ativo: false })
    })

    it('aceita PUT sem nível (só toggle de ativo)', async () => {
      prisma.acessoEntidade.findUnique.mockResolvedValue({ id: 'a1', usuarioId: 'u1' })
      atualizarMock.mockResolvedValue(ACESSO)
      await app.inject({ method: 'PUT', url: '/a1', ...form({ ativo: 'true' }) })
      expect(atualizarMock).toHaveBeenCalledWith('a1', { ativo: true })
    })

    it('400 quando service rejeita Error', async () => {
      prisma.acessoEntidade.findUnique.mockResolvedValue({ id: 'a1', usuarioId: 'u1' })
      atualizarMock.mockRejectedValue(new Error('falha'))
      const res = await app.inject({ method: 'PUT', url: '/a1', ...form({ nivel: 'ADMIN' }) })
      expect(res.statusCode).toBe(400)
      expect(res.body).toContain('falha')
    })

    it('400 com mensagem genérica quando erro não-Error', async () => {
      prisma.acessoEntidade.findUnique.mockResolvedValue({ id: 'a1', usuarioId: 'u1' })
      atualizarMock.mockRejectedValue('boom')
      const res = await app.inject({ method: 'PUT', url: '/a1', ...form({ nivel: 'ADMIN' }) })
      expect(res.statusCode).toBe(400)
      expect(res.body).toContain('Erro ao atualizar')
    })
  })

  describe('DELETE /:id', () => {
    it('revoga com sucesso', async () => {
      revogarMock.mockResolvedValue(undefined)
      const res = await app.inject({ method: 'DELETE', url: '/a1' })
      expect(res.statusCode).toBe(200)
    })

    it('400 quando service rejeita Error', async () => {
      revogarMock.mockRejectedValue(new Error('falha'))
      const res = await app.inject({ method: 'DELETE', url: '/a1' })
      expect(res.statusCode).toBe(400)
    })

    it('400 com mensagem genérica quando erro não-Error', async () => {
      revogarMock.mockRejectedValue('boom')
      const res = await app.inject({ method: 'DELETE', url: '/a1' })
      expect(res.statusCode).toBe(400)
      expect(res.body).toContain('Erro ao revogar')
    })
  })

  describe('fila de solicitações', () => {
    const PEND = {
      id: 's1',
      nivelSolicitado: 'ESCRITA',
      justificativa: 'preciso lançar',
      usuario: { id: 'u1', nomeCompleto: 'Fulano', emailPrincipal: 'f@x.com' },
      entidade: { nome: 'Prefeitura', municipio: { nome: 'Curitiba', estado: { sigla: 'PR' } } },
    }

    it('GET /solicitacoes renderiza pendentes', async () => {
      listarPendentesMock.mockResolvedValue([PEND])
      const res = await app.inject({ method: 'GET', url: '/solicitacoes' })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Solicitações de acesso')
      expect(res.body).toContain('Fulano')
      expect(res.body).toContain('Aprovar')
    })

    it('GET /solicitacoes estado vazio', async () => {
      listarPendentesMock.mockResolvedValue([])
      const res = await app.inject({ method: 'GET', url: '/solicitacoes' })
      expect(res.body).toContain('Nenhuma solicitação pendente')
    })

    it('aprovar: HX-Redirect e chama o service com o nível decidido', async () => {
      aprovarMock.mockResolvedValue({ id: 's1' })
      const res = await app.inject({
        method: 'POST',
        url: '/solicitacoes/s1/aprovar',
        ...form({ nivelConcedido: 'LEITURA', observacao: 'ok' }),
      })
      expect(res.statusCode).toBe(204)
      expect(res.headers['hx-redirect']).toBe('/admin/acessos-entidade/solicitacoes')
      expect(aprovarMock).toHaveBeenCalledWith('s1', 'a1', 'LEITURA', 'ok')
    })

    it('aprovar: 400 quando service lança Error', async () => {
      aprovarMock.mockRejectedValue(new Error('nível inválido'))
      const res = await app.inject({
        method: 'POST',
        url: '/solicitacoes/s1/aprovar',
        ...form({ nivelConcedido: 'LEITURA' }),
      })
      expect(res.statusCode).toBe(400)
      expect(res.body).toContain('nível inválido')
    })

    it('aprovar: 400 genérico quando erro não-Error (e nível ausente)', async () => {
      aprovarMock.mockRejectedValue('boom')
      const res = await app.inject({ method: 'POST', url: '/solicitacoes/s1/aprovar', ...form({}) })
      expect(res.statusCode).toBe(400)
      expect(res.body).toContain('Erro ao aprovar')
      expect(aprovarMock).toHaveBeenCalledWith('s1', 'a1', '', undefined)
    })

    it('rejeitar: HX-Redirect e chama o service', async () => {
      rejeitarMock.mockResolvedValue({ id: 's1' })
      const res = await app.inject({
        method: 'POST',
        url: '/solicitacoes/s1/rejeitar',
        ...form({ observacao: 'fora do escopo' }),
      })
      expect(res.statusCode).toBe(204)
      expect(res.headers['hx-redirect']).toBe('/admin/acessos-entidade/solicitacoes')
      expect(rejeitarMock).toHaveBeenCalledWith('s1', 'a1', 'fora do escopo')
    })

    it('rejeitar: 400 quando service lança Error', async () => {
      rejeitarMock.mockRejectedValue(new Error('xx'))
      const res = await app.inject({ method: 'POST', url: '/solicitacoes/s1/rejeitar', ...form({}) })
      expect(res.statusCode).toBe(400)
    })

    it('rejeitar: 400 genérico quando erro não-Error', async () => {
      rejeitarMock.mockRejectedValue('boom')
      const res = await app.inject({ method: 'POST', url: '/solicitacoes/s1/rejeitar', ...form({}) })
      expect(res.statusCode).toBe(400)
      expect(res.body).toContain('Erro ao rejeitar')
    })
  })
})
