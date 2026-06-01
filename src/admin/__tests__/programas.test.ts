import { describe, it, expect, beforeEach, vi } from 'vitest'

const { progListarMock, progBuscarMock, progCriarMock, progAtualizarMock, progExcluirMock } = vi.hoisted(() => ({
  progListarMock: vi.fn(),
  progBuscarMock: vi.fn(),
  progCriarMock: vi.fn(),
  progAtualizarMock: vi.fn(),
  progExcluirMock: vi.fn(),
}))

const { acaoBuscarMock, acaoCriarMock, acaoAtualizarMock, acaoExcluirMock } = vi.hoisted(() => ({
  acaoBuscarMock: vi.fn(),
  acaoCriarMock: vi.fn(),
  acaoAtualizarMock: vi.fn(),
  acaoExcluirMock: vi.fn(),
}))

vi.mock('../../services/programas.js', () => ({
  ProgramasService: class {
    listar = progListarMock
    buscarPorId = progBuscarMock
    criar = progCriarMock
    atualizar = progAtualizarMock
    excluir = progExcluirMock
  },
}))

vi.mock('../../services/acoes.js', () => ({
  AcoesService: class {
    listar = vi.fn()
    buscarPorId = acaoBuscarMock
    criar = acaoCriarMock
    atualizar = acaoAtualizarMock
    excluir = acaoExcluirMock
  },
}))

import { criarApp } from '../../routes/__tests__/helpers/criarApp.js'
import { adminProgramasRoutes } from '../programas.js'
import type { FastifyInstance } from 'fastify'
import type { PrismaMock } from '../../services/__tests__/helpers/prisma-mock.js'

const ESTADO = { id: 'e1', sigla: 'PR', nome: 'Paraná' }
const MUNICIPIO = { id: 'mun1', nome: 'Curitiba', estado: { sigla: 'PR', nome: 'Paraná' } }
const ENTIDADE = {
  id: 'ent1', nome: 'Prefeitura', tipo: 'PREFEITURA', municipioId: 'mun1', municipio: MUNICIPIO,
}
const PROGRAMA = {
  id: 'p1', entidadeId: 'ent1', ano: 2026, codigo: '0001', nome: 'EDUCAÇÃO',
  objetivo: 'Universalizar acesso', tipo: 'FINALISTICO', ativo: true,
  _count: { acoes: 3 },
  acoes: [
    { id: 'a1', programaId: 'p1', codigo: '2001', nome: 'MANUTENÇÃO ESCOLAS', tipo: 'ATIVIDADE', unidadeMedida: 'escola', metaFisica: 25, ativa: true },
  ],
}
const ACAO = { id: 'a1', programaId: 'p1', codigo: '2001', nome: 'X', tipo: 'ATIVIDADE', unidadeMedida: null, metaFisica: null, ativa: true }

function form(obj: Record<string, string>) {
  return {
    payload: new URLSearchParams(obj).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  }
}

describe('adminProgramasRoutes', () => {
  let app: FastifyInstance
  let prisma: PrismaMock

  beforeEach(async () => {
    ;[progListarMock, progBuscarMock, progCriarMock, progAtualizarMock, progExcluirMock,
      acaoBuscarMock, acaoCriarMock, acaoAtualizarMock, acaoExcluirMock].forEach((m) => m.mockReset())
    ;({ app, prisma } = await criarApp({
      registrar: adminProgramasRoutes,
      comView: true,
      simularAdmin: { sub: 'a1', email: 'a@x.com' },
    }))
  })

  describe('GET /', () => {
    it('sem filtros mostra picker e instrução', async () => {
      prisma.estado.findMany.mockResolvedValue([ESTADO])
      const res = await app.inject({ method: 'GET', url: '/' })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Selecione estado')
      expect(progListarMock).not.toHaveBeenCalled()
    })

    it('com estadoId carrega municípios', async () => {
      prisma.estado.findMany.mockResolvedValue([])
      prisma.municipio.findMany.mockResolvedValue([{ id: 'mun1', nome: 'Curitiba' }])
      const res = await app.inject({ method: 'GET', url: '/?estadoId=e1' })
      expect(prisma.municipio.findMany).toHaveBeenCalled()
      expect(res.body).toContain('Curitiba')
    })

    it('com municipioId carrega entidades ativas', async () => {
      prisma.estado.findMany.mockResolvedValue([])
      prisma.entidade.findMany.mockResolvedValue([{ id: 'ent1', nome: 'Prefeitura', tipo: 'PREFEITURA' }])
      await app.inject({ method: 'GET', url: '/?estadoId=e1&municipioId=mun1' })
      expect(prisma.entidade.findMany).toHaveBeenCalledWith({
        where: { municipioId: 'mun1', ativo: true },
        orderBy: { nome: 'asc' },
        select: { id: true, nome: true, tipo: true },
      })
    })

    it('com entidade lista programas do ano', async () => {
      prisma.estado.findMany.mockResolvedValue([])
      prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
      progListarMock.mockResolvedValue([PROGRAMA])
      const res = await app.inject({ method: 'GET', url: '/?entidadeId=ent1&ano=2026' })
      expect(progListarMock).toHaveBeenCalledWith('ent1', 2026)
      expect(res.body).toContain('EDUCAÇÃO')
      expect(res.body).toContain('Finalístico')
      expect(res.body).toContain('Ativo')
    })

    it('renderiza tipo GESTAO e OPERACOES_ESPECIAIS', async () => {
      prisma.estado.findMany.mockResolvedValue([])
      prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
      progListarMock.mockResolvedValue([
        { ...PROGRAMA, id: 'p2', tipo: 'GESTAO', ativo: false },
        { ...PROGRAMA, id: 'p3', tipo: 'OPERACOES_ESPECIAIS', objetivo: null },
      ])
      const res = await app.inject({ method: 'GET', url: '/?entidadeId=ent1' })
      expect(res.body).toContain('Gestão')
      expect(res.body).toContain('Op. Especiais')
      expect(res.body).toContain('Inativo')
    })

    it('ano não-numérico cai no ano atual (parseAno fallback)', async () => {
      prisma.estado.findMany.mockResolvedValue([])
      prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
      progListarMock.mockResolvedValue([])
      await app.inject({ method: 'GET', url: '/?entidadeId=ent1&ano=abc' })
      const ano = progListarMock.mock.calls[0][1]
      expect(ano).toBe(new Date().getUTCFullYear())
    })

    it('lista vazia mostra placeholder', async () => {
      prisma.estado.findMany.mockResolvedValue([])
      prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
      progListarMock.mockResolvedValue([])
      const res = await app.inject({ method: 'GET', url: '/?entidadeId=ent1' })
      expect(res.body).toContain('Nenhum programa cadastrado')
    })

    it('entidade inexistente cai no estado vazio', async () => {
      prisma.estado.findMany.mockResolvedValue([])
      prisma.entidade.findUnique.mockResolvedValue(null)
      const res = await app.inject({ method: 'GET', url: '/?entidadeId=xx' })
      expect(res.statusCode).toBe(200)
      expect(progListarMock).not.toHaveBeenCalled()
    })
  })

  describe('GET /form (novo)', () => {
    it('400 sem entidadeId', async () => {
      const res = await app.inject({ method: 'GET', url: '/form' })
      expect(res.statusCode).toBe(400)
    })

    it('renderiza form vazio', async () => {
      const res = await app.inject({ method: 'GET', url: '/form?entidadeId=ent1&ano=2026' })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Novo Programa')
    })
  })

  describe('GET /:id/form (editar)', () => {
    it('404 quando não existe', async () => {
      prisma.programa.findUnique.mockResolvedValue(null)
      const res = await app.inject({ method: 'GET', url: '/p1/form' })
      expect(res.statusCode).toBe(404)
    })

    it('renderiza form preenchido', async () => {
      prisma.programa.findUnique.mockResolvedValue(PROGRAMA)
      const res = await app.inject({ method: 'GET', url: '/p1/form' })
      expect(res.body).toContain('Editar Programa')
      expect(res.body).toContain('0001')
    })
  })

  describe('POST /', () => {
    it('cria e devolve HX-Redirect', async () => {
      progCriarMock.mockResolvedValue({ id: 'p1' })
      const res = await app.inject({
        method: 'POST',
        url: '/',
        ...form({
          entidadeId: 'ent1', ano: '2026', codigo: '0001', nome: 'X',
          objetivo: 'Y', tipo: 'FINALISTICO', ativo: 'true',
        }),
      })
      expect(res.statusCode).toBe(204)
      expect(res.headers['hx-redirect']).toBe('/admin/programas?entidadeId=ent1&ano=2026')
      expect(progCriarMock).toHaveBeenCalledWith('ent1', 2026, expect.objectContaining({
        codigo: '0001', nome: 'X', tipo: 'FINALISTICO', ativo: true,
      }))
    })

    it('ativo=false quando explícito', async () => {
      progCriarMock.mockResolvedValue({ id: 'p1' })
      await app.inject({
        method: 'POST',
        url: '/',
        ...form({ entidadeId: 'ent1', ano: '2026', codigo: '0001', nome: 'X', tipo: 'GESTAO', ativo: 'false' }),
      })
      expect(progCriarMock.mock.calls[0][2].ativo).toBe(false)
    })

    it('400 sem entidadeId', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/',
        ...form({ entidadeId: '   ', ano: '2026', codigo: '0001', nome: 'X', tipo: 'FINALISTICO' }),
      })
      expect(res.statusCode).toBe(400)
      expect(progCriarMock).not.toHaveBeenCalled()
    })

    it('erro do service vira mensagem na view', async () => {
      progCriarMock.mockRejectedValue(new Error('Já existe esse código.'))
      const res = await app.inject({
        method: 'POST',
        url: '/',
        ...form({ entidadeId: 'ent1', ano: '2026', codigo: '0001', nome: 'X', tipo: 'FINALISTICO' }),
      })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Já existe')
    })

    it('erro não-Error usa mensagem default', async () => {
      progCriarMock.mockRejectedValue('boom')
      const res = await app.inject({
        method: 'POST',
        url: '/',
        ...form({ entidadeId: 'ent1', ano: '2026', codigo: '0001', nome: 'X', tipo: 'FINALISTICO' }),
      })
      expect(res.body).toContain('Erro ao criar programa')
    })
  })

  describe('PUT /:id', () => {
    it('atualiza e devolve HX-Redirect', async () => {
      prisma.programa.findUnique.mockResolvedValue(PROGRAMA)
      progAtualizarMock.mockResolvedValue(PROGRAMA)
      const res = await app.inject({
        method: 'PUT',
        url: '/p1',
        ...form({ codigo: '0002', nome: 'Y', tipo: 'GESTAO' }),
      })
      expect(res.statusCode).toBe(204)
      expect(res.headers['hx-redirect']).toBe('/admin/programas?entidadeId=ent1&ano=2026')
      expect(progAtualizarMock).toHaveBeenCalledWith('p1', expect.objectContaining({
        codigo: '0002', nome: 'Y', tipo: 'GESTAO',
      }))
    })

    it('404 quando não existe', async () => {
      prisma.programa.findUnique.mockResolvedValue(null)
      const res = await app.inject({
        method: 'PUT',
        url: '/p1',
        ...form({ codigo: '0001', nome: 'X', tipo: 'FINALISTICO' }),
      })
      expect(res.statusCode).toBe(404)
    })

    it('erro do service vira mensagem na view', async () => {
      prisma.programa.findUnique.mockResolvedValue(PROGRAMA)
      progAtualizarMock.mockRejectedValue(new Error('falhou'))
      const res = await app.inject({
        method: 'PUT',
        url: '/p1',
        ...form({ codigo: '0001', nome: 'X', tipo: 'FINALISTICO' }),
      })
      expect(res.body).toContain('falhou')
    })

    it('erro não-Error usa mensagem default', async () => {
      prisma.programa.findUnique.mockResolvedValue(PROGRAMA)
      progAtualizarMock.mockRejectedValue('boom')
      const res = await app.inject({
        method: 'PUT',
        url: '/p1',
        ...form({ codigo: '0001', nome: 'X', tipo: 'FINALISTICO' }),
      })
      expect(res.body).toContain('Erro ao atualizar programa')
    })
  })

  describe('DELETE /:id', () => {
    it('exclui com 200', async () => {
      progExcluirMock.mockResolvedValue(undefined)
      const res = await app.inject({ method: 'DELETE', url: '/p1' })
      expect(res.statusCode).toBe(200)
      expect(progExcluirMock).toHaveBeenCalledWith('p1')
    })

    it('400 com erro', async () => {
      progExcluirMock.mockRejectedValue(new Error('Tem ações'))
      const res = await app.inject({ method: 'DELETE', url: '/p1' })
      expect(res.statusCode).toBe(400)
      expect(res.body).toBe('Tem ações')
    })

    it('400 com mensagem default', async () => {
      progExcluirMock.mockRejectedValue('boom')
      const res = await app.inject({ method: 'DELETE', url: '/p1' })
      expect(res.body).toBe('Erro ao excluir.')
    })
  })

  describe('GET /:id/acoes (drill)', () => {
    it('404 quando programa não existe', async () => {
      progBuscarMock.mockResolvedValue(null)
      const res = await app.inject({ method: 'GET', url: '/p1/acoes' })
      expect(res.statusCode).toBe(404)
    })

    it('renderiza com ações', async () => {
      progBuscarMock.mockResolvedValue(PROGRAMA)
      prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
      const res = await app.inject({ method: 'GET', url: '/p1/acoes' })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Ações do Programa')
      expect(res.body).toContain('MANUTENÇÃO ESCOLAS')
      expect(res.body).toContain('Atividade')
    })

    it('renderiza tipos PROJETO e OPERACAO_ESPECIAL + ação sem meta', async () => {
      progBuscarMock.mockResolvedValue({
        ...PROGRAMA,
        acoes: [
          { ...PROGRAMA.acoes[0], id: 'a2', tipo: 'PROJETO', metaFisica: null, unidadeMedida: null, ativa: false },
          { ...PROGRAMA.acoes[0], id: 'a3', tipo: 'OPERACAO_ESPECIAL', metaFisica: 10, unidadeMedida: null },
        ],
      })
      prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
      const res = await app.inject({ method: 'GET', url: '/p1/acoes' })
      expect(res.body).toContain('Projeto')
      expect(res.body).toContain('Op. Especial')
      expect(res.body).toContain('Inativa')
    })

    it('renderiza com entidade null', async () => {
      progBuscarMock.mockResolvedValue({ ...PROGRAMA, acoes: [] })
      prisma.entidade.findUnique.mockResolvedValue(null)
      const res = await app.inject({ method: 'GET', url: '/p1/acoes' })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Nenhuma ação')
    })
  })

  describe('GET /acoes/form (novo)', () => {
    it('400 sem programaId', async () => {
      const res = await app.inject({ method: 'GET', url: '/acoes/form' })
      expect(res.statusCode).toBe(400)
    })

    it('renderiza form vazio', async () => {
      const res = await app.inject({ method: 'GET', url: '/acoes/form?programaId=p1' })
      expect(res.body).toContain('Nova Ação')
    })
  })

  describe('GET /acoes/:id/form (editar)', () => {
    it('404 quando não existe', async () => {
      acaoBuscarMock.mockResolvedValue(null)
      const res = await app.inject({ method: 'GET', url: '/acoes/a1/form' })
      expect(res.statusCode).toBe(404)
    })

    it('renderiza form preenchido', async () => {
      acaoBuscarMock.mockResolvedValue(ACAO)
      const res = await app.inject({ method: 'GET', url: '/acoes/a1/form' })
      expect(res.body).toContain('Editar Ação')
    })
  })

  describe('POST /acoes', () => {
    it('cria e devolve HX-Redirect', async () => {
      acaoCriarMock.mockResolvedValue({ id: 'a1' })
      const res = await app.inject({
        method: 'POST',
        url: '/acoes',
        ...form({
          programaId: 'p1', codigo: '2001', nome: 'X', tipo: 'ATIVIDADE',
          unidadeMedida: 'escola', metaFisica: '25', ativa: 'true',
        }),
      })
      expect(res.statusCode).toBe(204)
      expect(res.headers['hx-redirect']).toBe('/admin/programas/p1/acoes')
      expect(acaoCriarMock).toHaveBeenCalledWith('p1', expect.objectContaining({
        codigo: '2001', nome: 'X', tipo: 'ATIVIDADE',
      }))
    })

    it('ativa=false explicit', async () => {
      acaoCriarMock.mockResolvedValue({ id: 'a1' })
      await app.inject({
        method: 'POST',
        url: '/acoes',
        ...form({ programaId: 'p1', codigo: '2001', nome: 'X', tipo: 'ATIVIDADE', ativa: 'false' }),
      })
      expect(acaoCriarMock.mock.calls[0][1].ativa).toBe(false)
    })

    it('400 sem programaId', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/acoes',
        ...form({ programaId: '   ', codigo: '2001', nome: 'X', tipo: 'ATIVIDADE' }),
      })
      expect(res.statusCode).toBe(400)
    })

    it('erro do service vira mensagem na view', async () => {
      acaoCriarMock.mockRejectedValue(new Error('Já existe.'))
      const res = await app.inject({
        method: 'POST',
        url: '/acoes',
        ...form({ programaId: 'p1', codigo: '2001', nome: 'X', tipo: 'ATIVIDADE' }),
      })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Já existe')
    })

    it('erro não-Error usa mensagem default', async () => {
      acaoCriarMock.mockRejectedValue('boom')
      const res = await app.inject({
        method: 'POST',
        url: '/acoes',
        ...form({ programaId: 'p1', codigo: '2001', nome: 'X', tipo: 'ATIVIDADE' }),
      })
      expect(res.body).toContain('Erro ao criar ação')
    })
  })

  describe('PUT /acoes/:id', () => {
    it('atualiza e devolve HX-Redirect', async () => {
      acaoBuscarMock.mockResolvedValue(ACAO)
      acaoAtualizarMock.mockResolvedValue(ACAO)
      const res = await app.inject({
        method: 'PUT',
        url: '/acoes/a1',
        ...form({ codigo: '2002', nome: 'Y', tipo: 'PROJETO' }),
      })
      expect(res.statusCode).toBe(204)
      expect(res.headers['hx-redirect']).toBe('/admin/programas/p1/acoes')
    })

    it('404 quando não existe', async () => {
      acaoBuscarMock.mockResolvedValue(null)
      const res = await app.inject({
        method: 'PUT',
        url: '/acoes/a1',
        ...form({ codigo: '2001', nome: 'X', tipo: 'ATIVIDADE' }),
      })
      expect(res.statusCode).toBe(404)
    })

    it('erro do service vira mensagem na view', async () => {
      acaoBuscarMock.mockResolvedValue(ACAO)
      acaoAtualizarMock.mockRejectedValue(new Error('falhou'))
      const res = await app.inject({
        method: 'PUT',
        url: '/acoes/a1',
        ...form({ codigo: '2001', nome: 'X', tipo: 'ATIVIDADE' }),
      })
      expect(res.body).toContain('falhou')
    })

    it('erro não-Error usa mensagem default', async () => {
      acaoBuscarMock.mockResolvedValue(ACAO)
      acaoAtualizarMock.mockRejectedValue('boom')
      const res = await app.inject({
        method: 'PUT',
        url: '/acoes/a1',
        ...form({ codigo: '2001', nome: 'X', tipo: 'ATIVIDADE' }),
      })
      expect(res.body).toContain('Erro ao atualizar ação')
    })
  })

  describe('DELETE /acoes/:id', () => {
    it('exclui com 200', async () => {
      acaoExcluirMock.mockResolvedValue(undefined)
      const res = await app.inject({ method: 'DELETE', url: '/acoes/a1' })
      expect(res.statusCode).toBe(200)
      expect(acaoExcluirMock).toHaveBeenCalledWith('a1')
    })

    it('400 com erro', async () => {
      acaoExcluirMock.mockRejectedValue(new Error('boom'))
      const res = await app.inject({ method: 'DELETE', url: '/acoes/a1' })
      expect(res.statusCode).toBe(400)
      expect(res.body).toBe('boom')
    })

    it('400 com mensagem default', async () => {
      acaoExcluirMock.mockRejectedValue('boom')
      const res = await app.inject({ method: 'DELETE', url: '/acoes/a1' })
      expect(res.body).toBe('Erro ao excluir.')
    })
  })
})
