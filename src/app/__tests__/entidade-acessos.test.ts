import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ErroNegocio } from '../../errors.js'

const { pendentesDaEntidadeMock, aprovarMock, rejeitarMock, listarPorEntidadeMock, atualizarMock } =
  vi.hoisted(() => ({
    pendentesDaEntidadeMock: vi.fn(),
    aprovarMock: vi.fn(),
    rejeitarMock: vi.fn(),
    listarPorEntidadeMock: vi.fn(),
    atualizarMock: vi.fn(),
  }))

vi.mock('../../services/solicitacoes-acesso.js', () => ({
  SolicitacoesAcessoService: class {
    listarPendentesDaEntidade = pendentesDaEntidadeMock
    aprovar = aprovarMock
    rejeitar = rejeitarMock
    criar = vi.fn()
    listarMinhas = vi.fn()
    listarPendentes = vi.fn()
    cancelar = vi.fn()
  },
}))

vi.mock('../../services/acessos-entidade.js', () => ({
  AcessosEntidadeService: class {
    listarPorEntidade = listarPorEntidadeMock
    atualizar = atualizarMock
    listarPorUsuario = vi.fn()
    buscarPorId = vi.fn()
    usuarioPodeAcessar = vi.fn()
    conceder = vi.fn()
    revogar = vi.fn()
  },
}))

import { criarApp } from '../../routes/__tests__/helpers/criarApp.js'
import { appEntidadeAcessosRoutes } from '../entidade-acessos.js'
import type { FastifyInstance } from 'fastify'
import type { PrismaMock } from '../../services/__tests__/helpers/prisma-mock.js'

const ENTIDADE = { nome: 'Prefeitura', municipio: { nome: 'Curitiba', estado: { sigla: 'PR' } } }
const ctx = (nivel: 'LEITURA' | 'ESCRITA' | 'ADMIN') => ({ entidadeId: 'ent1', ano: 2026, nivel })

function form(obj: Record<string, string>) {
  return {
    payload: new URLSearchParams(obj).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  }
}

async function appAdmin() {
  return criarApp({
    registrar: appEntidadeAcessosRoutes,
    comView: true,
    simularUsuario: { sub: 'u1', email: 'u@x.com' },
    simularContexto: ctx('ADMIN'),
  })
}

describe('appEntidadeAcessosRoutes', () => {
  let app: FastifyInstance
  let prisma: PrismaMock

  beforeEach(async () => {
    ;[pendentesDaEntidadeMock, aprovarMock, rejeitarMock, listarPorEntidadeMock, atualizarMock].forEach((m) =>
      m.mockReset(),
    )
    ;({ app, prisma } = await appAdmin())
  })

  it('barra quem não é ADMIN do contexto (redireciona /app)', async () => {
    const { app: appLeitura } = await criarApp({
      registrar: appEntidadeAcessosRoutes,
      comView: true,
      simularUsuario: { sub: 'u1', email: 'u@x.com' },
      simularContexto: ctx('LEITURA'),
    })
    const res = await appLeitura.inject({ method: 'GET', url: '/entidade/acessos' })
    expect(res.statusCode).toBe(302)
    expect(res.headers.location).toBe('/app')
  })

  it('GET painel renderiza pendentes + acessos', async () => {
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    pendentesDaEntidadeMock.mockResolvedValue([
      { id: 's1', nivelSolicitado: 'ESCRITA', justificativa: 'preciso', usuario: { id: 'u9', nomeCompleto: 'Novo', emailPrincipal: 'n@x.com' } },
    ])
    listarPorEntidadeMock.mockResolvedValue([
      { id: 'a1', nivel: 'ADMIN', usuario: { id: 'u1', nomeCompleto: 'Eu', emailPrincipal: 'u@x.com' } },
      { id: 'a2', nivel: 'LEITURA', usuario: { id: 'u2', nomeCompleto: 'Outro', emailPrincipal: 'o@x.com' } },
    ])
    const res = await app.inject({ method: 'GET', url: '/entidade/acessos' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('Acessos da entidade')
    expect(res.body).toContain('Novo')
    expect(res.body).toContain('Revogar')
    expect(res.body).toContain('você') // marca o próprio acesso
  })

  it('GET mostra erro por querystring', async () => {
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    pendentesDaEntidadeMock.mockResolvedValue([])
    listarPorEntidadeMock.mockResolvedValue([])
    const res = await app.inject({ method: 'GET', url: '/entidade/acessos?erro=falhou' })
    expect(res.body).toContain('falhou')
  })

  it('aprovar chama o service com escopo da entidade e redireciona', async () => {
    aprovarMock.mockResolvedValue({ id: 's1' })
    const res = await app.inject({
      method: 'POST',
      url: '/entidade/acessos/solicitacoes/s1/aprovar',
      ...form({ nivelConcedido: 'ESCRITA', observacao: 'ok' }),
    })
    expect(res.statusCode).toBe(302)
    expect(res.headers.location).toBe('/app/entidade/acessos')
    expect(aprovarMock).toHaveBeenCalledWith('s1', 'u1', 'ESCRITA', 'ok', 'ent1')
  })

  it('aprovar com erro de negócio volta com mensagem', async () => {
    aprovarMock.mockRejectedValue(new ErroNegocio('NAO_AUTORIZADO', 'Solicitação pertence a outra entidade.'))
    const res = await app.inject({ method: 'POST', url: '/entidade/acessos/solicitacoes/s1/aprovar', ...form({ nivelConcedido: 'LEITURA' }) })
    expect(decodeURIComponent(res.headers.location as string)).toContain('outra entidade')
  })

  it('aprovar com erro inesperado usa fallback', async () => {
    aprovarMock.mockRejectedValue(new Error('boom'))
    const res = await app.inject({ method: 'POST', url: '/entidade/acessos/solicitacoes/s1/aprovar', ...form({ nivelConcedido: 'LEITURA' }) })
    expect(decodeURIComponent(res.headers.location as string)).toContain('Erro ao aprovar')
  })

  it('aprovar sem nivelConcedido manda string vazia (service decide o erro)', async () => {
    aprovarMock.mockResolvedValue({ id: 's1' })
    const res = await app.inject({ method: 'POST', url: '/entidade/acessos/solicitacoes/s1/aprovar', ...form({ observacao: 'x' }) })
    expect(aprovarMock).toHaveBeenCalledWith('s1', 'u1', '', 'x', 'ent1')
  })

  it('rejeitar chama o service e redireciona', async () => {
    rejeitarMock.mockResolvedValue({ id: 's1' })
    const res = await app.inject({ method: 'POST', url: '/entidade/acessos/solicitacoes/s1/rejeitar', ...form({ observacao: 'não' }) })
    expect(res.headers.location).toBe('/app/entidade/acessos')
    expect(rejeitarMock).toHaveBeenCalledWith('s1', 'u1', 'não', 'ent1')
  })

  it('rejeitar com erro volta com mensagem', async () => {
    rejeitarMock.mockRejectedValue(new Error('x'))
    const res = await app.inject({ method: 'POST', url: '/entidade/acessos/solicitacoes/s1/rejeitar', ...form({}) })
    expect(decodeURIComponent(res.headers.location as string)).toContain('Erro ao rejeitar')
  })

  it('muda o nível de um acesso da entidade', async () => {
    prisma.acessoEntidade.findUnique.mockResolvedValue({ id: 'a2', entidadeId: 'ent1', usuarioId: 'u2' })
    atualizarMock.mockResolvedValue({ id: 'a2' })
    const res = await app.inject({ method: 'POST', url: '/entidade/acessos/a2', ...form({ nivel: 'ESCRITA' }) })
    expect(res.headers.location).toBe('/app/entidade/acessos')
    expect(atualizarMock).toHaveBeenCalledWith('a2', { nivel: 'ESCRITA' })
  })

  it('mudar nível sem nivel no corpo manda string vazia', async () => {
    prisma.acessoEntidade.findUnique.mockResolvedValue({ id: 'a2', entidadeId: 'ent1', usuarioId: 'u2' })
    atualizarMock.mockResolvedValue({ id: 'a2' })
    await app.inject({ method: 'POST', url: '/entidade/acessos/a2', ...form({}) })
    expect(atualizarMock).toHaveBeenCalledWith('a2', { nivel: '' })
  })

  it('revoga um acesso (acao=revogar → ativo:false)', async () => {
    prisma.acessoEntidade.findUnique.mockResolvedValue({ id: 'a2', entidadeId: 'ent1', usuarioId: 'u2' })
    atualizarMock.mockResolvedValue({ id: 'a2' })
    const res = await app.inject({ method: 'POST', url: '/entidade/acessos/a2', ...form({ acao: 'revogar' }) })
    expect(atualizarMock).toHaveBeenCalledWith('a2', { ativo: false })
  })

  it('barra acesso de outra entidade', async () => {
    prisma.acessoEntidade.findUnique.mockResolvedValue({ id: 'a3', entidadeId: 'ent2', usuarioId: 'u2' })
    const res = await app.inject({ method: 'POST', url: '/entidade/acessos/a3', ...form({ nivel: 'ESCRITA' }) })
    expect(decodeURIComponent(res.headers.location as string)).toContain('não encontrado nesta entidade')
    expect(atualizarMock).not.toHaveBeenCalled()
  })

  it('barra acesso inexistente', async () => {
    prisma.acessoEntidade.findUnique.mockResolvedValue(null)
    const res = await app.inject({ method: 'POST', url: '/entidade/acessos/xx', ...form({ nivel: 'ESCRITA' }) })
    expect(decodeURIComponent(res.headers.location as string)).toContain('não encontrado nesta entidade')
  })

  it('impede o admin de alterar o próprio acesso', async () => {
    prisma.acessoEntidade.findUnique.mockResolvedValue({ id: 'a1', entidadeId: 'ent1', usuarioId: 'u1' })
    const res = await app.inject({ method: 'POST', url: '/entidade/acessos/a1', ...form({ acao: 'revogar' }) })
    expect(decodeURIComponent(res.headers.location as string)).toContain('seu próprio acesso')
    expect(atualizarMock).not.toHaveBeenCalled()
  })
})
