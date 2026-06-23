import { describe, it, expect, beforeEach, vi } from 'vitest'

const { listarMock, criarMock, atualizarMock, excluirMock } = vi.hoisted(() => ({
  listarMock: vi.fn(),
  criarMock: vi.fn(),
  atualizarMock: vi.fn(),
  excluirMock: vi.fn(),
}))

vi.mock('../../services/unidades-orcamentaria.js', () => ({
  UnidadesOrcamentariaService: class {
    listar = listarMock
    criar = criarMock
    atualizar = atualizarMock
    excluir = excluirMock
  },
}))

import { criarApp } from '../../routes/__tests__/helpers/criarApp.js'
import { adminUnidadesOrcamentariaRoutes } from '../unidades-orcamentaria.js'
import type { FastifyInstance } from 'fastify'
import type { PrismaMock } from '../../services/__tests__/helpers/prisma-mock.js'

const ESTADO = { id: 'e1', sigla: 'PR', nome: 'Paraná' }
const MUNICIPIO = { id: 'mun1', nome: 'Curitiba', estado: ESTADO }
const ENTIDADE = {
  id: 'ent1', nome: 'Prefeitura', tipo: 'PREFEITURA', municipioId: 'mun1', municipio: MUNICIPIO,
}
const UO = { id: 'uo1', entidadeId: 'ent1', codigo: '02.001', nome: 'Educação', ativa: true }

function form(obj: Record<string, string>) {
  return {
    payload: new URLSearchParams(obj).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  }
}

describe('adminUnidadesOrcamentariaRoutes', () => {
  let app: FastifyInstance
  let prisma: PrismaMock

  beforeEach(async () => {
    ;[listarMock, criarMock, atualizarMock, excluirMock].forEach((m) => m.mockReset())
    ;({ app, prisma } = await criarApp({
      registrar: adminUnidadesOrcamentariaRoutes,
      comView: true,
      simularAdmin: { sub: 'a1', email: 'a@x.com' },
    }))
  })

  describe('GET /', () => {
    it('sem filtros mostra picker e instrução', async () => {
      prisma.estado.findMany.mockResolvedValue([ESTADO])
      const res = await app.inject({ method: 'GET', url: '/' })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Selecione estado, município e entidade')
      expect(prisma.municipio.findMany).not.toHaveBeenCalled()
      expect(prisma.entidade.findMany).not.toHaveBeenCalled()
      expect(listarMock).not.toHaveBeenCalled()
    })

    it('com estadoId carrega municípios', async () => {
      prisma.estado.findMany.mockResolvedValue([ESTADO])
      prisma.municipio.findMany.mockResolvedValue([{ id: 'mun1', nome: 'Curitiba' }])
      const res = await app.inject({ method: 'GET', url: '/?estadoId=e1' })
      expect(prisma.municipio.findMany).toHaveBeenCalledWith({
        where: { estadoId: 'e1' },
        orderBy: { nome: 'asc' },
        select: { id: true, nome: true },
      })
      expect(res.body).toContain('Curitiba')
    })

    it('com municipioId carrega entidades ativas', async () => {
      prisma.estado.findMany.mockResolvedValue([])
      prisma.municipio.findMany.mockResolvedValue([])
      prisma.entidade.findMany.mockResolvedValue([{ id: 'ent1', nome: 'Prefeitura', tipo: 'PREFEITURA' }])
      const res = await app.inject({ method: 'GET', url: '/?estadoId=e1&municipioId=mun1' })
      expect(prisma.entidade.findMany).toHaveBeenCalledWith({
        where: { municipioId: 'mun1', ativo: true },
        orderBy: { nome: 'asc' },
        select: { id: true, nome: true, tipo: true },
      })
      expect(res.body).toContain('Prefeitura')
    })

    it('com entidade lista as UOs', async () => {
      prisma.estado.findMany.mockResolvedValue([ESTADO])
      prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
      listarMock.mockResolvedValue([UO])
      const res = await app.inject({ method: 'GET', url: '/?entidadeId=ent1' })
      expect(res.statusCode).toBe(200)
      expect(listarMock).toHaveBeenCalledWith('ent1')
      expect(res.body).toContain('02.001')
      expect(res.body).toContain('Educação')
      expect(res.body).toContain('Ativa')
    })

    it('UO inativa renderiza badge correto', async () => {
      prisma.estado.findMany.mockResolvedValue([])
      prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
      listarMock.mockResolvedValue([{ ...UO, ativa: false }])
      const res = await app.inject({ method: 'GET', url: '/?entidadeId=ent1' })
      expect(res.body).toContain('Inativa')
    })

    it('lista vazia mostra placeholder', async () => {
      prisma.estado.findMany.mockResolvedValue([])
      prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
      listarMock.mockResolvedValue([])
      const res = await app.inject({ method: 'GET', url: '/?entidadeId=ent1' })
      expect(res.body).toContain('Nenhuma unidade orçamentária cadastrada')
    })

    it('entidade inexistente cai no estado vazio', async () => {
      prisma.estado.findMany.mockResolvedValue([])
      prisma.entidade.findUnique.mockResolvedValue(null)
      const res = await app.inject({ method: 'GET', url: '/?entidadeId=xx' })
      expect(res.statusCode).toBe(200)
      expect(listarMock).not.toHaveBeenCalled()
    })
  })

  describe('GET /form (novo)', () => {
    it('400 sem entidadeId', async () => {
      const res = await app.inject({ method: 'GET', url: '/form' })
      expect(res.statusCode).toBe(400)
    })

    it('renderiza form vazio com entidadeId', async () => {
      const res = await app.inject({ method: 'GET', url: '/form?entidadeId=ent1' })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Nova Unidade Orçamentária')
      expect(res.body).toContain('value="ent1"')
    })
  })

  describe('GET /:id/form (editar)', () => {
    it('404 quando UO não existe', async () => {
      prisma.unidadeOrcamentaria.findUnique.mockResolvedValue(null)
      const res = await app.inject({ method: 'GET', url: '/uo1/form' })
      expect(res.statusCode).toBe(404)
    })

    it('renderiza form preenchido', async () => {
      prisma.unidadeOrcamentaria.findUnique.mockResolvedValue(UO)
      const res = await app.inject({ method: 'GET', url: '/uo1/form' })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Editar Unidade Orçamentária')
      expect(res.body).toContain('02.001')
      expect(res.body).toContain('Educação')
    })
  })

  describe('POST /', () => {
    it('cria e devolve HX-Redirect', async () => {
      criarMock.mockResolvedValue({ id: 'uo1' })
      const res = await app.inject({
        method: 'POST', url: '/', ...form({ entidadeId: 'ent1', codigo: 'X', nome: 'Y' }),
      })
      expect(res.statusCode).toBe(204)
      expect(res.headers['hx-redirect']).toBe('/admin/unidades-orcamentaria?entidadeId=ent1')
      expect(criarMock).toHaveBeenCalledWith('ent1', { codigo: 'X', nome: 'Y', ativa: true })
    })

    it('ativa=false quando checkbox vier ativa=false', async () => {
      criarMock.mockResolvedValue({ id: 'uo1' })
      await app.inject({
        method: 'POST', url: '/', ...form({ entidadeId: 'ent1', codigo: 'X', nome: 'Y', ativa: 'false' }),
      })
      expect(criarMock.mock.calls[0][1].ativa).toBe(false)
    })

    it('400 sem entidadeId', async () => {
      const res = await app.inject({
        method: 'POST', url: '/', ...form({ entidadeId: '   ', codigo: 'X', nome: 'Y' }),
      })
      expect(res.statusCode).toBe(400)
      expect(criarMock).not.toHaveBeenCalled()
    })

    it('rejeita código vazio re-renderizando form', async () => {
      const res = await app.inject({
        method: 'POST', url: '/', ...form({ entidadeId: 'ent1', codigo: '   ', nome: 'Y' }),
      })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Código é obrigatório')
      expect(criarMock).not.toHaveBeenCalled()
    })

    it('rejeita nome vazio', async () => {
      const res = await app.inject({
        method: 'POST', url: '/', ...form({ entidadeId: 'ent1', codigo: 'X', nome: '   ' }),
      })
      expect(res.body).toContain('Nome é obrigatório')
    })

    it('erro do service vira mensagem na view', async () => {
      criarMock.mockRejectedValue(new Error('Já existe UO com esse código.'))
      const res = await app.inject({
        method: 'POST', url: '/', ...form({ entidadeId: 'ent1', codigo: 'X', nome: 'Y' }),
      })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Já existe UO')
    })

    it('erro não-Error usa mensagem default', async () => {
      criarMock.mockRejectedValue('boom')
      const res = await app.inject({
        method: 'POST', url: '/', ...form({ entidadeId: 'ent1', codigo: 'X', nome: 'Y' }),
      })
      expect(res.body).toContain('Erro ao criar unidade orçamentária')
    })
  })

  describe('PUT /:id', () => {
    it('atualiza e devolve HX-Redirect', async () => {
      prisma.unidadeOrcamentaria.findUnique.mockResolvedValue(UO)
      atualizarMock.mockResolvedValue(UO)
      const res = await app.inject({
        method: 'PUT', url: '/uo1', ...form({ codigo: 'Z', nome: 'W' }),
      })
      expect(res.statusCode).toBe(204)
      expect(res.headers['hx-redirect']).toBe('/admin/unidades-orcamentaria?entidadeId=ent1')
      expect(atualizarMock).toHaveBeenCalledWith('uo1', { codigo: 'Z', nome: 'W', ativa: true, orgaoId: null })
    })

    it('respeita ativa=false', async () => {
      prisma.unidadeOrcamentaria.findUnique.mockResolvedValue(UO)
      atualizarMock.mockResolvedValue(UO)
      await app.inject({
        method: 'PUT', url: '/uo1', ...form({ codigo: 'Z', nome: 'W', ativa: 'false' }),
      })
      expect(atualizarMock.mock.calls[0][1].ativa).toBe(false)
    })

    it('404 quando UO não existe', async () => {
      prisma.unidadeOrcamentaria.findUnique.mockResolvedValue(null)
      const res = await app.inject({
        method: 'PUT', url: '/uo1', ...form({ codigo: 'Z', nome: 'W' }),
      })
      expect(res.statusCode).toBe(404)
    })

    it('código vazio re-renderiza form', async () => {
      prisma.unidadeOrcamentaria.findUnique.mockResolvedValue(UO)
      const res = await app.inject({
        method: 'PUT', url: '/uo1', ...form({ codigo: '   ', nome: 'W' }),
      })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Código é obrigatório')
    })

    it('nome vazio re-renderiza form', async () => {
      prisma.unidadeOrcamentaria.findUnique.mockResolvedValue(UO)
      const res = await app.inject({
        method: 'PUT', url: '/uo1', ...form({ codigo: 'Z', nome: '   ' }),
      })
      expect(res.body).toContain('Nome é obrigatório')
    })

    it('erro do service vira mensagem na view', async () => {
      prisma.unidadeOrcamentaria.findUnique.mockResolvedValue(UO)
      atualizarMock.mockRejectedValue(new Error('falhou'))
      const res = await app.inject({
        method: 'PUT', url: '/uo1', ...form({ codigo: 'Z', nome: 'W' }),
      })
      expect(res.body).toContain('falhou')
    })

    it('erro não-Error usa mensagem default', async () => {
      prisma.unidadeOrcamentaria.findUnique.mockResolvedValue(UO)
      atualizarMock.mockRejectedValue('boom')
      const res = await app.inject({
        method: 'PUT', url: '/uo1', ...form({ codigo: 'Z', nome: 'W' }),
      })
      expect(res.body).toContain('Erro ao atualizar unidade orçamentária')
    })
  })

  describe('DELETE /:id', () => {
    it('exclui com 200', async () => {
      excluirMock.mockResolvedValue(undefined)
      const res = await app.inject({ method: 'DELETE', url: '/uo1' })
      expect(res.statusCode).toBe(200)
      expect(excluirMock).toHaveBeenCalledWith('uo1')
    })

    it('400 quando service rejeita com Error', async () => {
      excluirMock.mockRejectedValue(new Error('Não encontrado'))
      const res = await app.inject({ method: 'DELETE', url: '/uo1' })
      expect(res.statusCode).toBe(400)
      expect(res.body).toBe('Não encontrado')
    })

    it('400 com mensagem default para erro não-Error', async () => {
      excluirMock.mockRejectedValue('boom')
      const res = await app.inject({ method: 'DELETE', url: '/uo1' })
      expect(res.body).toBe('Erro ao excluir.')
    })
  })
})
