import { describe, it, expect, beforeEach, vi } from 'vitest'

const { listarMock, criarMock, atualizarMock, excluirMock } = vi.hoisted(() => ({
  listarMock: vi.fn(),
  criarMock: vi.fn(),
  atualizarMock: vi.fn(),
  excluirMock: vi.fn(),
}))

vi.mock('../../services/orgaos.js', () => ({
  OrgaosService: class {
    listar = listarMock
    criar = criarMock
    atualizar = atualizarMock
    excluir = excluirMock
  },
}))

import { criarApp } from '../../routes/__tests__/helpers/criarApp.js'
import { adminOrgaosRoutes } from '../orgaos.js'
import type { FastifyInstance } from 'fastify'
import type { PrismaMock } from '../../services/__tests__/helpers/prisma-mock.js'

const ENTIDADE = { id: 'ent1', nome: 'Prefeitura', municipio: { nome: 'Curitiba', estado: { sigla: 'PR', nome: 'Paraná' } } }
const ORGAO = { id: 'o1', entidadeId: 'ent1', codigo: '02', nome: 'Educação', ativo: true }

function form(obj: Record<string, string>) {
  return { payload: new URLSearchParams(obj).toString(), headers: { 'content-type': 'application/x-www-form-urlencoded' } }
}

describe('adminOrgaosRoutes', () => {
  let app: FastifyInstance
  let prisma: PrismaMock
  beforeEach(async () => {
    ;[listarMock, criarMock, atualizarMock, excluirMock].forEach((m) => m.mockReset())
    ;({ app, prisma } = await criarApp({ registrar: adminOrgaosRoutes, comView: true, simularAdmin: { sub: 'a1', email: 'a@x.com' } }))
  })

  it('GET / lista por entidade', async () => {
    prisma.estado.findMany.mockResolvedValue([])
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE as never)
    listarMock.mockResolvedValue([ORGAO])
    const res = await app.inject({ method: 'GET', url: '/?estadoId=e&municipioId=m&entidadeId=ent1' })
    expect(listarMock).toHaveBeenCalledWith('ent1')
    expect(res.body).toContain('Educação')
  })
  it('GET /form (novo) renderiza', async () => {
    const res = await app.inject({ method: 'GET', url: '/form?entidadeId=ent1' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('Novo Órgão')
  })
  it('POST / cria e redireciona', async () => {
    criarMock.mockResolvedValue(ORGAO)
    const res = await app.inject({ method: 'POST', url: '/', ...form({ entidadeId: 'ent1', codigo: '02', nome: 'Educação' }) })
    expect(res.statusCode).toBe(204)
    expect(criarMock).toHaveBeenCalledWith('ent1', { codigo: '02', nome: 'Educação', ativo: true })
  })
  it('POST / sem código re-renderiza com erro', async () => {
    const res = await app.inject({ method: 'POST', url: '/', ...form({ entidadeId: 'ent1', codigo: '', nome: 'X' }) })
    expect(res.body).toContain('Código é obrigatório')
    expect(criarMock).not.toHaveBeenCalled()
  })
  it('PUT /:id atualiza', async () => {
    prisma.orgao.findUnique.mockResolvedValue(ORGAO as never)
    atualizarMock.mockResolvedValue(ORGAO)
    const res = await app.inject({ method: 'PUT', url: '/o1', ...form({ codigo: '03', nome: 'Saúde' }) })
    expect(res.statusCode).toBe(204)
    expect(atualizarMock).toHaveBeenCalledWith('o1', { codigo: '03', nome: 'Saúde', ativo: true })
  })
  it('DELETE /:id exclui; erro vira 400 com a mensagem', async () => {
    excluirMock.mockResolvedValue(undefined)
    expect((await app.inject({ method: 'DELETE', url: '/o1' })).statusCode).toBe(200)
    excluirMock.mockRejectedValue(new Error('Órgão com 2 unidade(s) vinculada(s) não pode ser excluído.'))
    const r = await app.inject({ method: 'DELETE', url: '/o1' })
    expect(r.statusCode).toBe(400)
    expect(r.body).toContain('unidade')
  })
})
