import { describe, it, expect, beforeEach, vi } from 'vitest'

const { criarMock, atualizarMock, excluirMock } = vi.hoisted(() => ({
  criarMock: vi.fn(),
  atualizarMock: vi.fn(),
  excluirMock: vi.fn(),
}))

vi.mock('../../services/entidades.js', () => ({
  EntidadeService: class {
    criar = criarMock
    atualizar = atualizarMock
    excluir = excluirMock
  },
}))

import { criarApp } from '../../routes/__tests__/helpers/criarApp.js'
import { adminEntidadesRoutes } from '../entidades.js'
import type { FastifyInstance } from 'fastify'
import type { PrismaMock } from '../../services/__tests__/helpers/prisma-mock.js'

const MUNICIPIO = { id: 'mun1', nome: 'Curitiba', estado: { sigla: 'PR' } }
const ENTIDADE = {
  id: 'ent1', nome: 'Prefeitura de Curitiba', tipo: 'PREFEITURA', cnpj: null, municipioId: 'mun1', ativo: true,
  municipio: { nome: 'Curitiba', estado: { sigla: 'PR' } },
}

function form(obj: Record<string, string>) {
  return {
    payload: new URLSearchParams(obj).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  }
}

describe('adminEntidadesRoutes', () => {
  let app: FastifyInstance
  let prisma: PrismaMock

  beforeEach(async () => {
    ;[criarMock, atualizarMock, excluirMock].forEach((m) => m.mockReset())
    ;({ app, prisma } = await criarApp({
      registrar: adminEntidadesRoutes,
      comView: true,
      simularAdmin: { sub: 'admin1', email: 'admin@x.com' },
    }))
    prisma.municipio.findMany.mockResolvedValue([MUNICIPIO])
  })

  describe('GET /', () => {
    it('lista sem filtro', async () => {
      prisma.entidade.findMany.mockResolvedValue([ENTIDADE])
      const res = await app.inject({ method: 'GET', url: '/' })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Prefeitura de Curitiba')
      expect(prisma.entidade.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: undefined }))
    })

    it('filtra por município', async () => {
      prisma.entidade.findMany.mockResolvedValue([])
      await app.inject({ method: 'GET', url: '/?municipioId=mun1' })
      expect(prisma.entidade.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { municipioId: 'mun1' } }))
    })

    it('estado vazio quando não há entidades', async () => {
      prisma.entidade.findMany.mockResolvedValue([])
      const res = await app.inject({ method: 'GET', url: '/' })
      expect(res.body).toContain('Nenhuma entidade cadastrada')
    })
  })

  describe('GET /form', () => {
    it('renderiza form novo com municípios', async () => {
      const res = await app.inject({ method: 'GET', url: '/form' })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Nova Entidade')
      expect(res.body).toContain('copia as árvores')
    })
  })

  describe('GET /:id/form', () => {
    it('404 quando não existe', async () => {
      prisma.entidade.findUnique.mockResolvedValue(null)
      const res = await app.inject({ method: 'GET', url: '/x/form' })
      expect(res.statusCode).toBe(404)
    })

    it('renderiza form de edição com município readonly', async () => {
      prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
      const res = await app.inject({ method: 'GET', url: '/ent1/form' })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Editar Entidade')
      expect(res.body).toContain('não pode ser alterado')
    })
  })

  describe('POST /', () => {
    it('cria e redireciona (dispara cópia)', async () => {
      criarMock.mockResolvedValue(ENTIDADE)
      const res = await app.inject({
        method: 'POST', url: '/',
        ...form({ municipioId: 'mun1', nome: 'Prefeitura', tipo: 'PREFEITURA', ano: '2026', cnpj: '12.345.678/0001-99' }),
      })
      expect(res.statusCode).toBe(204)
      expect(res.headers['hx-redirect']).toBe('/admin/entidades')
      expect(criarMock).toHaveBeenCalledWith({ municipioId: 'mun1', nome: 'Prefeitura', tipo: 'PREFEITURA', ano: 2026, cnpj: '12.345.678/0001-99' })
    })

    it('cria sem cnpj', async () => {
      criarMock.mockResolvedValue(ENTIDADE)
      await app.inject({
        method: 'POST', url: '/',
        ...form({ municipioId: 'mun1', nome: 'Câmara', tipo: 'CAMARA', ano: '2026', cnpj: '' }),
      })
      expect(criarMock).toHaveBeenCalledWith({ municipioId: 'mun1', nome: 'Câmara', tipo: 'CAMARA', ano: 2026 })
    })

    it('erro quando município não selecionado', async () => {
      const res = await app.inject({
        method: 'POST', url: '/', ...form({ municipioId: '', nome: 'X', tipo: 'PREFEITURA', ano: '2026', cnpj: '' }),
      })
      expect(res.body).toContain('Selecione um município')
      expect(criarMock).not.toHaveBeenCalled()
    })

    it('erro quando nome vazio', async () => {
      const res = await app.inject({
        method: 'POST', url: '/', ...form({ municipioId: 'mun1', nome: '  ', tipo: 'PREFEITURA', ano: '2026', cnpj: '' }),
      })
      expect(res.body).toContain('O nome é obrigatório')
    })

    it('erro quando tipo inválido', async () => {
      const res = await app.inject({
        method: 'POST', url: '/', ...form({ municipioId: 'mun1', nome: 'X', tipo: 'FOO', ano: '2026', cnpj: '' }),
      })
      expect(res.body).toContain('Selecione o tipo')
    })

    it('erro quando ano inválido', async () => {
      const res = await app.inject({
        method: 'POST', url: '/', ...form({ municipioId: 'mun1', nome: 'X', tipo: 'PREFEITURA', ano: 'foo', cnpj: '' }),
      })
      expect(res.body).toContain('Ano (exercício) inválido')
    })

    it('re-renderiza erro do service (ex.: sem modelo)', async () => {
      criarMock.mockRejectedValue(new Error('Município (e seu estado) não têm modelo contábil definido.'))
      const res = await app.inject({
        method: 'POST', url: '/', ...form({ municipioId: 'mun1', nome: 'X', tipo: 'PREFEITURA', ano: '2026', cnpj: '' }),
      })
      expect(res.body).toContain('não têm modelo contábil')
    })

    it('mensagem default para erro não-Error', async () => {
      criarMock.mockRejectedValue('boom')
      const res = await app.inject({
        method: 'POST', url: '/', ...form({ municipioId: 'mun1', nome: 'X', tipo: 'PREFEITURA', ano: '2026', cnpj: '' }),
      })
      expect(res.body).toContain('Erro ao criar entidade')
    })
  })

  describe('PUT /:id', () => {
    it('atualiza e redireciona', async () => {
      atualizarMock.mockResolvedValue(ENTIDADE)
      const res = await app.inject({
        method: 'PUT', url: '/ent1', ...form({ nome: 'Novo nome', tipo: 'CAMARA', cnpj: '', ativo: 'true' }),
      })
      expect(res.statusCode).toBe(204)
      expect(res.headers['hx-redirect']).toBe('/admin/entidades')
      expect(atualizarMock).toHaveBeenCalledWith('ent1', { nome: 'Novo nome', tipo: 'CAMARA', cnpj: null, ativo: true })
    })

    it('atualiza com cnpj preenchido', async () => {
      atualizarMock.mockResolvedValue(ENTIDADE)
      await app.inject({
        method: 'PUT', url: '/ent1', ...form({ nome: 'X', tipo: 'PREFEITURA', cnpj: '11.111.111/0001-11' }),
      })
      expect(atualizarMock).toHaveBeenCalledWith('ent1', { nome: 'X', tipo: 'PREFEITURA', cnpj: '11.111.111/0001-11', ativo: false })
    })

    it('erro quando nome vazio', async () => {
      prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
      const res = await app.inject({ method: 'PUT', url: '/ent1', ...form({ nome: '', tipo: 'PREFEITURA', cnpj: '' }) })
      expect(res.body).toContain('O nome é obrigatório')
      expect(atualizarMock).not.toHaveBeenCalled()
    })

    it('erro quando tipo inválido', async () => {
      prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
      const res = await app.inject({ method: 'PUT', url: '/ent1', ...form({ nome: 'X', tipo: 'ZZZ', cnpj: '' }) })
      expect(res.body).toContain('Tipo inválido')
    })

    it('re-renderiza erro do service', async () => {
      prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
      atualizarMock.mockRejectedValue(new Error('Nome ou CNPJ já em uso.'))
      const res = await app.inject({ method: 'PUT', url: '/ent1', ...form({ nome: 'X', tipo: 'PREFEITURA', cnpj: '' }) })
      expect(res.body).toContain('já em uso')
    })

    it('mensagem default para erro não-Error', async () => {
      prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
      atualizarMock.mockRejectedValue('boom')
      const res = await app.inject({ method: 'PUT', url: '/ent1', ...form({ nome: 'X', tipo: 'PREFEITURA', cnpj: '' }) })
      expect(res.body).toContain('Erro ao atualizar entidade')
    })
  })

  describe('DELETE /:id', () => {
    it('exclui com 200', async () => {
      excluirMock.mockResolvedValue(undefined)
      const res = await app.inject({ method: 'DELETE', url: '/ent1' })
      expect(res.statusCode).toBe(200)
      expect(excluirMock).toHaveBeenCalledWith('ent1')
    })

    it('400 quando service rejeita com Error', async () => {
      excluirMock.mockRejectedValue(new Error('Em uso'))
      const res = await app.inject({ method: 'DELETE', url: '/ent1' })
      expect(res.statusCode).toBe(400)
      expect(res.body).toBe('Em uso')
    })

    it('400 com mensagem default para erro não-Error', async () => {
      excluirMock.mockRejectedValue('x')
      const res = await app.inject({ method: 'DELETE', url: '/ent1' })
      expect(res.statusCode).toBe(400)
      expect(res.body).toBe('Erro ao excluir.')
    })
  })
})
