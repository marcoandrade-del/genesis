import { describe, it, expect, beforeEach } from 'vitest'
import { criarApp, tokenJwt } from './helpers/criarApp.js'
import { favoritosRoutes } from '../favoritos.js'
import type { FastifyInstance } from 'fastify'
import type { PrismaMock } from '../../services/__tests__/helpers/prisma-mock.js'

const USUARIO = { id: 'u1', nomeCompleto: 'A', ativo: true }
const PASTA = { id: 'pa1', usuarioId: 'u1', parentId: null, nome: 'Pasta', ordem: 0, criadoEm: new Date(), atualizadoEm: new Date() }
const FAVORITO = {
  id: 'fa1', usuarioId: 'u1', pastaId: null, relatorioFixoId: 'rf1',
  relatorioPersonalizadoId: null, ordem: 0, criadoEm: new Date(),
}
const FIXO = { id: 'rf1', sistemaId: 's1', nome: 'R', descricao: null, rota: '/r', ativo: true }
const UUID_RF = '00000000-0000-0000-0000-000000000001'
const UUID_PA = '00000000-0000-0000-0000-000000000002'

describe('favoritosRoutes', () => {
  let app: FastifyInstance
  let prisma: PrismaMock
  let auth: { authorization: string }

  beforeEach(async () => {
    ({ app, prisma } = await criarApp({ registrar: favoritosRoutes, proteger: true }))
    auth = { authorization: `Bearer ${tokenJwt(app, { sub: 'u1', email: 'a@b.com' })}` }
  })

  it('GET /usuarios/:usuarioId/pastas exige auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/usuarios/u1/pastas' })
    expect(res.statusCode).toBe(401)
  })

  it('GET /usuarios/:usuarioId/pastas retorna 404 quando usuário não existe', async () => {
    prisma.usuario.findUnique.mockResolvedValue(null)
    const res = await app.inject({ method: 'GET', url: '/usuarios/u1/pastas', headers: auth })
    expect(res.statusCode).toBe(404)
  })

  it('POST /usuarios/:usuarioId/pastas retorna 201', async () => {
    prisma.usuario.findUnique.mockResolvedValue(USUARIO)
    prisma.pastaFavorito.create.mockResolvedValue(PASTA)
    const res = await app.inject({
      method: 'POST', url: '/usuarios/u1/pastas', headers: auth,
      payload: { nome: 'Pasta' },
    })
    expect(res.statusCode).toBe(201)
  })

  it('POST /usuarios/:usuarioId/pastas retorna 400 sem nome (schema)', async () => {
    const res = await app.inject({
      method: 'POST', url: '/usuarios/u1/pastas', headers: auth,
      payload: {},
    })
    expect(res.statusCode).toBe(400)
  })

  it('POST /usuarios/:usuarioId/pastas com parentId de outro usuário retorna 400', async () => {
    prisma.usuario.findUnique.mockResolvedValue(USUARIO)
    prisma.pastaFavorito.findUnique.mockResolvedValue({ ...PASTA, id: UUID_PA, usuarioId: 'outro' })
    const res = await app.inject({
      method: 'POST', url: '/usuarios/u1/pastas', headers: auth,
      payload: { nome: 'Pasta', parentId: UUID_PA },
    })
    expect(res.statusCode).toBe(400)
  })

  it('PUT /pastas/:id retorna 404 quando não existe', async () => {
    prisma.pastaFavorito.findUnique.mockResolvedValue(null)
    const res = await app.inject({
      method: 'PUT', url: '/pastas/pa1', headers: auth,
      payload: { nome: 'Nova' },
    })
    expect(res.statusCode).toBe(404)
  })

  it('PUT /pastas/:id atualiza com sucesso', async () => {
    prisma.pastaFavorito.findUnique.mockResolvedValue(PASTA)
    prisma.pastaFavorito.update.mockResolvedValue({ ...PASTA, nome: 'Nova' })
    const res = await app.inject({
      method: 'PUT', url: '/pastas/pa1', headers: auth,
      payload: { nome: 'Nova' },
    })
    expect(res.statusCode).toBe(200)
  })

  it('DELETE /pastas/:id retorna 409 quando há subpastas', async () => {
    prisma.pastaFavorito.findUnique.mockResolvedValue(PASTA)
    prisma.pastaFavorito.count.mockResolvedValue(1)
    const res = await app.inject({ method: 'DELETE', url: '/pastas/pa1', headers: auth })
    expect(res.statusCode).toBe(409)
  })

  it('DELETE /pastas/:id retorna 409 quando há favoritos vinculados', async () => {
    prisma.pastaFavorito.findUnique.mockResolvedValue(PASTA)
    prisma.pastaFavorito.count.mockResolvedValue(0)
    prisma.favoritoRelatorio.count.mockResolvedValue(1)
    const res = await app.inject({ method: 'DELETE', url: '/pastas/pa1', headers: auth })
    expect(res.statusCode).toBe(409)
  })

  it('DELETE /pastas/:id retorna 204 quando vazia', async () => {
    prisma.pastaFavorito.findUnique.mockResolvedValue(PASTA)
    prisma.pastaFavorito.count.mockResolvedValue(0)
    prisma.favoritoRelatorio.count.mockResolvedValue(0)
    prisma.pastaFavorito.delete.mockResolvedValue(PASTA)
    const res = await app.inject({ method: 'DELETE', url: '/pastas/pa1', headers: auth })
    expect(res.statusCode).toBe(204)
  })

  it('GET /usuarios/:usuarioId/favoritos retorna lista', async () => {
    prisma.usuario.findUnique.mockResolvedValue(USUARIO)
    prisma.favoritoRelatorio.findMany.mockResolvedValue([FAVORITO])
    const res = await app.inject({ method: 'GET', url: '/usuarios/u1/favoritos', headers: auth })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toHaveLength(1)
  })

  it('POST /usuarios/:usuarioId/favoritos retorna 400 sem relatorio', async () => {
    prisma.usuario.findUnique.mockResolvedValue(USUARIO)
    const res = await app.inject({
      method: 'POST', url: '/usuarios/u1/favoritos', headers: auth,
      payload: {},
    })
    expect(res.statusCode).toBe(400)
  })

  it('POST /usuarios/:usuarioId/favoritos retorna 400 com ambos relatorioFixoId e relatorioPersonalizadoId', async () => {
    prisma.usuario.findUnique.mockResolvedValue(USUARIO)
    const res = await app.inject({
      method: 'POST', url: '/usuarios/u1/favoritos', headers: auth,
      payload: { relatorioFixoId: UUID_RF, relatorioPersonalizadoId: UUID_PA },
    })
    expect(res.statusCode).toBe(400)
  })

  it('POST /usuarios/:usuarioId/favoritos retorna 201 para relatório fixo', async () => {
    prisma.usuario.findUnique.mockResolvedValue(USUARIO)
    prisma.relatorioFixo.findUnique.mockResolvedValue(FIXO)
    prisma.favoritoRelatorio.findFirst.mockResolvedValue(null)
    prisma.favoritoRelatorio.create.mockResolvedValue(FAVORITO)
    const res = await app.inject({
      method: 'POST', url: '/usuarios/u1/favoritos', headers: auth,
      payload: { relatorioFixoId: UUID_RF },
    })
    expect(res.statusCode).toBe(201)
  })

  it('POST /usuarios/:usuarioId/favoritos retorna 409 quando relatório já é favorito', async () => {
    prisma.usuario.findUnique.mockResolvedValue(USUARIO)
    prisma.relatorioFixo.findUnique.mockResolvedValue(FIXO)
    prisma.favoritoRelatorio.findFirst.mockResolvedValue(FAVORITO)
    const res = await app.inject({
      method: 'POST', url: '/usuarios/u1/favoritos', headers: auth,
      payload: { relatorioFixoId: UUID_RF },
    })
    expect(res.statusCode).toBe(409)
  })

  it('PUT /favoritos/:id retorna 404 quando não existe', async () => {
    prisma.favoritoRelatorio.findUnique.mockResolvedValue(null)
    const res = await app.inject({
      method: 'PUT', url: '/favoritos/fa1', headers: auth,
      payload: { pastaId: null },
    })
    expect(res.statusCode).toBe(404)
  })

  it('PUT /favoritos/:id move com sucesso', async () => {
    prisma.favoritoRelatorio.findUnique.mockResolvedValue(FAVORITO)
    prisma.favoritoRelatorio.update.mockResolvedValue({ ...FAVORITO, pastaId: 'pa2' })
    const res = await app.inject({
      method: 'PUT', url: '/favoritos/fa1', headers: auth,
      payload: { pastaId: 'pa2' },
    })
    expect(res.statusCode).toBe(200)
  })

  it('DELETE /favoritos/:id retorna 204', async () => {
    prisma.favoritoRelatorio.findUnique.mockResolvedValue(FAVORITO)
    prisma.favoritoRelatorio.delete.mockResolvedValue(FAVORITO)
    const res = await app.inject({ method: 'DELETE', url: '/favoritos/fa1', headers: auth })
    expect(res.statusCode).toBe(204)
  })
})
